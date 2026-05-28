// Settlement orchestrator for x402 transaction submission and confirmation.
//
// Orchestrates the full settlement flow:
// 1. Re-verify the transaction (defense-in-depth)
// 2. Idempotency check via Redis SET NX (TOCTOU prevention)
// 3. Submit raw CBOR to Blockfrost
// 4. Poll for on-chain confirmation
// 5. Return typed SettleResult (V2 aligned)

import { BlockfrostServerError } from '@blockfrost/blockfrost-js';
import type { FastifyBaseLogger } from 'fastify';

import type { SettlementRecord, SettleResult } from './types.js';
import type { BlockfrostClient } from '../chain/blockfrost-client.js';
import type { VerifyContext } from '../verify/types.js';
import { verifyPayment } from '../verify/verify-payment.js';

// ---------------------------------------------------------------------------
// Constants (hardcoded per research recommendation)
// ---------------------------------------------------------------------------

/** Interval between confirmation polls (milliseconds). */
const POLL_INTERVAL_MS = 5_000;

/**
 * Base poll budget (milliseconds) — covers the typical first-block sighting.
 * The effective deadline is `max(POLL_TIMEOUT_MS_BASE, minConfirmations * MS_PER_BLOCK_BUDGET)`
 * so depth-gated polling has enough time to accumulate confirmations.
 */
const POLL_TIMEOUT_MS_BASE = 120_000;

/**
 * Per-confirmation budget (milliseconds). 30s is a generous bound on
 * Cardano's typical ~20s slot time so a momentarily-slow chain tip doesn't
 * cause spurious timeouts.
 */
const MS_PER_CONFIRMATION_BUDGET = 30_000;

/** Compute the effective poll timeout for the requested confirmation depth. */
function pollTimeoutMs(minConfirmations: number): number {
  return Math.max(POLL_TIMEOUT_MS_BASE, minConfirmations * MS_PER_CONFIRMATION_BUDGET);
}

/** Dedup record TTL in Redis (seconds). 24 hours. */
const DEDUP_TTL_SECONDS = 86_400;
const TX_HASH_HEX = /^[0-9a-f]{64}$/u;

// ---------------------------------------------------------------------------
// Redis interface (minimal subset of ioredis)
// ---------------------------------------------------------------------------

export interface RedisLike {
  set(...args: unknown[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute a dedup key for idempotency checking.
 * Returns `settle:<txHash>` keyed on the Cardano transaction body hash.
 *
 * Witnesses are not part of the on-chain tx hash, so any witness-mutation
 * variant of the same transaction body deterministically collides on this
 * key. Keying on raw CBOR bytes would let a witness reorder bypass dedup.
 */
export function computeDedupKey(txHash: string): string {
  return `settle:${txHash}`;
}

function isTxHash(value: unknown): value is string {
  return typeof value === 'string' && TX_HASH_HEX.test(value);
}

/**
 * Compute on-chain confirmation count: a tx in block N at chain tip
 * (latest=N) has 1 confirmation, not 0 — standard depth convention.
 * Returns 0 when the tx hasn't appeared yet or the latest height is below
 * the tx's block (transient chain-tip lag).
 */
function confirmationDepth(txBlockHeight: number, latestBlockHeight: number): number {
  if (latestBlockHeight < txBlockHeight) return 0;
  return latestBlockHeight - txBlockHeight + 1;
}

/**
 * Poll Blockfrost for transaction confirmation at the requested depth.
 *
 * Cardano Ouroboros Praos has probabilistic finality — a single-block
 * sighting CAN be rolled back at depth 1. This loop only returns
 * `confirmed: true` once the tx is at least `minConfirmations` deep.
 *
 * @param txHash - Transaction hash to poll for
 * @param blockfrost - BlockfrostClient with getTransaction + getLatestBlockHeight
 * @param minConfirmations - Required confirmation depth (>= 1)
 * @param timeoutMs - Maximum time to poll (milliseconds)
 * @param intervalMs - Time between polls (milliseconds)
 * @param logger - Fastify logger for debug output
 * @returns `{ confirmed: true, blockHeight, confirmations }` once depth is reached,
 *          else `{ confirmed: false }` on timeout
 */
export async function pollConfirmation(
  txHash: string,
  blockfrost: BlockfrostClient,
  minConfirmations: number,
  timeoutMs: number,
  intervalMs: number,
  logger: FastifyBaseLogger
): Promise<{ confirmed: boolean; blockHeight?: number; confirmations?: number }> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const txInfo = await blockfrost.getTransaction(txHash);
    if (txInfo !== null) {
      const latestHeight = await blockfrost.getLatestBlockHeight();
      const depth = confirmationDepth(txInfo.block_height, latestHeight);
      if (depth >= minConfirmations) {
        logger.info(
          { txHash, blockHeight: txInfo.block_height, confirmations: depth },
          'Transaction confirmed on-chain'
        );
        return { confirmed: true, blockHeight: txInfo.block_height, confirmations: depth };
      }
      logger.debug(
        { txHash, blockHeight: txInfo.block_height, confirmations: depth, minConfirmations },
        'Transaction seen but below confirmation depth; continuing to poll'
      );
    }

    // Check if we'll exceed deadline after sleeping
    if (Date.now() + intervalMs >= deadline) {
      break;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }

  return { confirmed: false };
}

// ---------------------------------------------------------------------------
// Settlement orchestrator
// ---------------------------------------------------------------------------

export interface SettlePaymentOptions {
  /**
   * Whether the operator has opted into emitting `extensions.status: "mempool"`
   * for transactions that submit but do not confirm before timeout.
   * Default false (per x402 Cardano spec recommendation).
   */
  allowMempool?: boolean;

  /**
   * Required on-chain confirmation depth before reporting `confirmed`.
   * Default 1 keeps the pre-PR-8 behavior (first sighting = confirmed) for
   * callers that don't pass it; the route handler always passes the value
   * from `chain.verification.minConfirmations` (default 6).
   */
  minConfirmations?: number;
}

/**
 * Settle a payment by re-verifying, deduplicating, submitting, and polling.
 *
 * Full flow:
 * 1. Re-verify the transaction via verifyPayment() (defense-in-depth)
 * 2. Derive tx-hash dedup key from verifyPayment's result; claim via Redis
 *    SET NX with the txHash already populated in the initial record (so a
 *    concurrent racing request can poll Blockfrost directly instead of
 *    being stuck on an empty txHash — audit C6)
 * 3. If dedup hit: check existing record status and return appropriately
 * 4. Submit raw CBOR to Blockfrost; assert returned hash matches local
 * 5. Poll for on-chain confirmation
 * 6. Return typed SettleResult (V2 aligned), including `extensions.status`
 *
 * @param ctx - Verification context (same shape as /verify)
 * @param cborBytes - Raw CBOR bytes of the signed transaction
 * @param blockfrost - BlockfrostClient for submission and confirmation
 * @param redis - Redis client for idempotency dedup
 * @param network - CAIP-2 chain ID (e.g. "cardano:preview")
 * @param logger - Fastify logger
 * @param options - Optional settlement-time switches (e.g. allowMempool)
 * @returns SettleResult with V2-aligned fields
 */
export async function settlePayment(
  ctx: VerifyContext,
  cborBytes: Uint8Array,
  blockfrost: BlockfrostClient,
  redis: RedisLike,
  network: string,
  logger: FastifyBaseLogger,
  options: SettlePaymentOptions = {}
): Promise<SettleResult> {
  const allowMempool = options.allowMempool ?? false;
  const minConfirmations = options.minConfirmations ?? 1;
  const payer = ctx.payerAddress;

  // ---- 1. Re-verify ----
  const verifyResult = await verifyPayment(ctx, logger);
  if (!verifyResult.isValid) {
    logger.info({ reason: verifyResult.invalidReason }, 'Settlement rejected: verification failed');
    return {
      success: false,
      transaction: '',
      network,
      payer,
      errorReason: 'verification_failed',
      errorMessage: verifyResult.invalidMessage ?? 'Payment verification failed',
    };
  }

  // ---- 2. Idempotency / dedup check ----
  // Key on the body-only tx hash, NOT the raw CBOR bytes: witness reordering
  // mutates CBOR but never the on-chain tx hash, so raw-bytes keying would
  // let trivially-mutated CBOR variants bypass dedup.
  const verifiedTxHash = verifyResult.extensions?.txHash;
  if (!isTxHash(verifiedTxHash)) {
    logger.error(
      { extensions: verifyResult.extensions },
      'Settlement aborted: verifyPayment returned isValid but no txHash'
    );
    return {
      success: false,
      transaction: '',
      network,
      payer,
      errorReason: 'internal_error',
      errorMessage: 'Verification result is missing transaction hash',
    };
  }
  const dedupKey = computeDedupKey(verifiedTxHash);
  // Pre-populate txHash with the body hash we just computed via CML.
  // Blockfrost submits return the same body hash, so a concurrent racing
  // request that hits handleExistingRecord can immediately poll for
  // confirmation instead of seeing an empty txHash and falling through to
  // a 24h-stuck `confirmation_timeout` with `transaction: ''` (audit C6).
  const initialRecord: SettlementRecord = {
    txHash: verifiedTxHash,
    status: 'submitted',
    submittedAt: Date.now(),
  };

  const didClaim = await redis.set(
    dedupKey,
    JSON.stringify(initialRecord),
    'EX',
    DEDUP_TTL_SECONDS,
    'NX'
  );

  if (didClaim === null) {
    // Key already exists -- handle existing record
    return handleExistingRecord(
      dedupKey,
      blockfrost,
      redis,
      network,
      payer,
      minConfirmations,
      logger
    );
  }

  // ---- 3. Submit to Blockfrost ----
  let txHash: string;
  try {
    txHash = await blockfrost.submitTransaction(cborBytes);
    // Sanity: the body hash Blockfrost reports MUST match the one we
    // computed locally via CML. A mismatch means CML and the chain
    // disagree on canonical hashing — fail loud, the dedup invariants
    // and PR #67's witness-mutation guard both rest on this equality.
    if (txHash !== verifiedTxHash) {
      logger.error(
        { verifiedTxHash, blockfrostTxHash: txHash },
        'Settlement aborted: Blockfrost returned a different tx hash than the local CML body hash'
      );
      return {
        success: false,
        transaction: txHash,
        network,
        payer,
        errorReason: 'internal_error',
        errorMessage: 'Local and chain tx-hash disagree (CML/Blockfrost mismatch)',
      };
    }
  } catch (error) {
    if (error instanceof BlockfrostServerError && error.status_code === 400) {
      // Update dedup record to failed
      const failedRecord: SettlementRecord = {
        ...initialRecord,
        status: 'failed',
        reason: 'invalid_transaction',
      };
      await redis.set(dedupKey, JSON.stringify(failedRecord), 'EX', DEDUP_TTL_SECONDS);
      return {
        success: false,
        transaction: '',
        network,
        payer,
        errorReason: 'invalid_transaction',
        errorMessage: 'Transaction rejected by the blockchain',
      };
    }

    // Other errors: update dedup record to failed
    const failedRecord: SettlementRecord = {
      ...initialRecord,
      status: 'failed',
      reason: 'submission_rejected',
    };
    await redis.set(dedupKey, JSON.stringify(failedRecord), 'EX', DEDUP_TTL_SECONDS);
    logger.error({ err: error }, 'Transaction submission failed');
    return {
      success: false,
      transaction: '',
      network,
      payer,
      errorReason: 'submission_rejected',
      errorMessage: 'Transaction submission to blockchain failed',
    };
  }

  // ---- 4. Re-affirm the dedup record (txHash already populated pre-submit) ----
  // We extend the TTL by re-writing the record, so the 24h dedup window
  // starts from "submit confirmed", not from "Redis claim acquired".
  const submittedRecord: SettlementRecord = initialRecord;
  await redis.set(dedupKey, JSON.stringify(submittedRecord), 'EX', DEDUP_TTL_SECONDS);

  // ---- 5. Poll for confirmation ----
  const pollResult = await pollConfirmation(
    txHash,
    blockfrost,
    minConfirmations,
    pollTimeoutMs(minConfirmations),
    POLL_INTERVAL_MS,
    logger
  );

  if (pollResult.confirmed) {
    // Update dedup record to confirmed
    const confirmedRecord: SettlementRecord = {
      ...submittedRecord,
      status: 'confirmed',
      confirmedAt: Date.now(),
    };
    await redis.set(dedupKey, JSON.stringify(confirmedRecord), 'EX', DEDUP_TTL_SECONDS);
    return {
      success: true,
      transaction: txHash,
      network,
      payer,
      extensions: { status: 'confirmed' },
    };
  }

  // Timeout: update dedup record
  const timeoutRecord: SettlementRecord = {
    ...submittedRecord,
    status: 'timeout',
  };
  await redis.set(dedupKey, JSON.stringify(timeoutRecord), 'EX', DEDUP_TTL_SECONDS);

  if (allowMempool) {
    // Operator opt-in: return success with status: "mempool". Spec
    // strongly discourages this for resources of real value because
    // Cardano's Ouroboros Praos has probabilistic finality.
    return {
      success: true,
      transaction: txHash,
      network,
      payer,
      extensions: { status: 'mempool' },
    };
  }

  return {
    success: false,
    transaction: txHash,
    network,
    payer,
    errorReason: 'confirmation_timeout',
    errorMessage: 'Transaction submitted but confirmation timed out',
  };
}

// ---------------------------------------------------------------------------
// Dedup record handler
// ---------------------------------------------------------------------------

/**
 * Handle an existing dedup record found during SET NX.
 * Checks the current status of the record and returns the appropriate result.
 * Re-runs the confirmation-depth gate so a tx that hadn't reached
 * `minConfirmations` on the first attempt isn't returned as `confirmed` here.
 */
async function handleExistingRecord(
  dedupKey: string,
  blockfrost: BlockfrostClient,
  redis: RedisLike,
  network: string,
  payer: string | undefined,
  minConfirmations: number,
  logger: FastifyBaseLogger
): Promise<SettleResult> {
  const raw = await redis.get(dedupKey);
  if (!raw) {
    // Record expired between SET NX and GET -- treat as internal error
    return {
      success: false,
      transaction: '',
      network,
      payer,
      errorReason: 'internal_error',
      errorMessage: 'Settlement record expired unexpectedly',
    };
  }

  let record: SettlementRecord;
  try {
    record = JSON.parse(raw) as SettlementRecord;
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), dedupKey },
      'Settlement dedup record is not valid JSON'
    );
    return {
      success: false,
      transaction: '',
      network,
      payer,
      errorReason: 'internal_error',
      errorMessage: 'Settlement record is corrupt',
    };
  }

  // Safety net for the audit-C6 transition: records written by the pre-fix
  // code path could land here with an empty txHash. Without this branch a
  // duplicate retry would query Blockfrost for '' (404), return
  // confirmation_timeout, and the record would sit empty-txHash for the
  // remaining 24h TTL. Surface it as a transient internal_error so the
  // client can retry — by then the original submitter has either written
  // the real txHash or the failed status. This branch becomes dead code
  // 24h after deployment of this PR.
  if (
    (record.status === 'submitted' || record.status === 'timeout') &&
    (!record.txHash || record.txHash.length === 0)
  ) {
    logger.warn(
      { dedupKey, submittedAt: record.submittedAt },
      'Duplicate submission found a legacy empty-txHash record; returning transient error'
    );
    return {
      success: false,
      transaction: '',
      network,
      payer,
      errorReason: 'internal_error',
      errorMessage: 'Settlement is in flight; please retry shortly',
    };
  }

  if (!isTxHash(record.txHash)) {
    logger.error({ dedupKey, status: record.status }, 'Settlement dedup record has invalid txHash');
    return {
      success: false,
      transaction: '',
      network,
      payer,
      errorReason: 'internal_error',
      errorMessage: 'Settlement record is corrupt',
    };
  }

  switch (record.status) {
    case 'confirmed':
      logger.info({ txHash: record.txHash }, 'Duplicate submission: already confirmed');
      return {
        success: true,
        transaction: record.txHash,
        network,
        payer,
        extensions: { status: 'confirmed' },
      };

    case 'submitted':
    case 'timeout': {
      // Check if it's deeply enough confirmed now
      const txInfo = await blockfrost.getTransaction(record.txHash);
      if (txInfo !== null) {
        const latestHeight = await blockfrost.getLatestBlockHeight();
        const depth = confirmationDepth(txInfo.block_height, latestHeight);
        if (depth >= minConfirmations) {
          const confirmedRecord: SettlementRecord = {
            ...record,
            status: 'confirmed',
            confirmedAt: Date.now(),
          };
          await redis.set(dedupKey, JSON.stringify(confirmedRecord), 'EX', DEDUP_TTL_SECONDS);
          logger.info(
            { txHash: record.txHash, confirmations: depth },
            'Duplicate submission: now confirmed on-chain'
          );
          return {
            success: true,
            transaction: record.txHash,
            network,
            payer,
            extensions: { status: 'confirmed' },
          };
        }
        logger.debug(
          { txHash: record.txHash, confirmations: depth, minConfirmations },
          'Duplicate submission: seen but still below confirmation depth'
        );
      }
      // Either still not seen, or seen but below minConfirmations
      return {
        success: false,
        transaction: record.txHash,
        network,
        payer,
        errorReason: 'confirmation_timeout',
        errorMessage: 'Transaction submitted but confirmation timed out',
      };
    }

    case 'failed':
      return {
        success: false,
        transaction: '',
        network,
        payer,
        errorReason: record.reason ?? 'internal_error',
        errorMessage: 'Previous settlement attempt failed',
      };

    default:
      return {
        success: false,
        transaction: '',
        network,
        payer,
        errorReason: 'internal_error',
        errorMessage: 'Unknown settlement record status',
      };
  }
}
