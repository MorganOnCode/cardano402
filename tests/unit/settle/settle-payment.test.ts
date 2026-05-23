// Unit tests for settlePayment() settlement orchestrator
//
// Tests the full settlement state machine: re-verify -> dedup -> submit -> poll -> result.
// All external dependencies (verifyPayment, blockfrost, redis) are mocked.

import { BlockfrostServerError } from '@blockfrost/blockfrost-js';
import type { FastifyBaseLogger } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockfrostClient } from '../../../src/chain/blockfrost-client.js';
import type { SettlementRecord, SettleResult, TxInfo } from '../../../src/settle/types.js';
import type { VerifyContext, VerifyResponse } from '../../../src/verify/types.js';

// ---------------------------------------------------------------------------
// Mock verifyPayment
// ---------------------------------------------------------------------------

const mockVerifyPayment =
  vi.fn<(ctx: VerifyContext, logger?: FastifyBaseLogger) => Promise<VerifyResponse>>();

vi.mock('../../../src/verify/verify-payment.js', () => ({
  verifyPayment: (...args: unknown[]) =>
    mockVerifyPayment(...(args as [VerifyContext, FastifyBaseLogger?])),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLogger(): FastifyBaseLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
    silent: vi.fn(),
    level: 'info',
  } as unknown as FastifyBaseLogger;
}

function createMockBlockfrost(): {
  submitTransaction: ReturnType<typeof vi.fn>;
  getTransaction: ReturnType<typeof vi.fn>;
} {
  return {
    submitTransaction: vi.fn(),
    getTransaction: vi.fn(),
  };
}

function createMockRedis(): {
  set: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
} {
  return {
    set: vi.fn(),
    get: vi.fn(),
  };
}

function createMinimalCtx(): VerifyContext {
  return {
    scheme: 'exact',
    network: 'cardano:preprod',
    payTo: 'addr_test1qz...',
    requiredAmount: 2_000_000n,
    maxTimeoutSeconds: 300,
    transactionCbor: 'AAAA', // valid base64
    requestedAt: Date.now(),
    getCurrentSlot: vi.fn().mockResolvedValue(1000),
    configuredNetwork: 'cardano:preprod',
    feeMin: 100_000n,
    feeMax: 5_000_000n,
  };
}

const TX_HASH = 'a'.repeat(64);
const CBOR_BYTES = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
const NETWORK = 'cardano:preprod';

function makeTxInfo(overrides: Partial<TxInfo> = {}): TxInfo {
  return {
    hash: TX_HASH,
    block: 'b'.repeat(64),
    block_height: 12345,
    block_time: 1700000000,
    slot: 67890,
    index: 0,
    fees: '200000',
    valid_contract: true,
    ...overrides,
  };
}

function makeBlockfrostServerError(statusCode: number): BlockfrostServerError {
  return new BlockfrostServerError({
    status_code: statusCode,
    message: `Error ${statusCode}`,
    error: `HTTP ${statusCode}`,
    url: 'https://cardano-preview.blockfrost.io/api/v0/tx/submit',
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('settlePayment', () => {
  let logger: FastifyBaseLogger;
  let blockfrost: ReturnType<typeof createMockBlockfrost>;
  let redis: ReturnType<typeof createMockRedis>;
  let ctx: VerifyContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let settlePayment: (...args: any[]) => Promise<SettleResult>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-06T12:00:00Z'));
    logger = createMockLogger();
    blockfrost = createMockBlockfrost();
    redis = createMockRedis();
    ctx = createMinimalCtx();
    mockVerifyPayment.mockReset();

    // Dynamic import to pick up the mock
    const mod = await import('../../../src/settle/settle-payment.js');
    settlePayment = mod.settlePayment;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Test 1: Happy path
  it('returns success when verify passes, submit succeeds, and poll confirms', async () => {
    mockVerifyPayment.mockResolvedValue({ isValid: true, extensions: { txHash: TX_HASH } });
    redis.set.mockResolvedValue('OK'); // SET NX succeeds (key didn't exist)
    blockfrost.submitTransaction.mockResolvedValue(TX_HASH);
    blockfrost.getTransaction.mockResolvedValue(makeTxInfo());

    const result = await settlePayment(
      ctx,
      CBOR_BYTES,
      blockfrost as unknown as BlockfrostClient,
      redis,
      NETWORK,
      logger
    );

    expect(result).toMatchObject({
      success: true,
      transaction: TX_HASH,
      network: NETWORK,
    });
    expect(mockVerifyPayment).toHaveBeenCalledOnce();
    expect(blockfrost.submitTransaction).toHaveBeenCalledWith(CBOR_BYTES);
    expect(blockfrost.getTransaction).toHaveBeenCalledWith(TX_HASH);
  });

  // Test 2: Verification failure
  it('returns verification_failed when re-verify fails', async () => {
    mockVerifyPayment.mockResolvedValue({
      isValid: false,
      invalidReason: 'amount_insufficient',
    });

    const result = await settlePayment(
      ctx,
      CBOR_BYTES,
      blockfrost as unknown as BlockfrostClient,
      redis,
      NETWORK,
      logger
    );

    expect(result).toMatchObject({
      success: false,
      errorReason: 'verification_failed',
    });
    expect(blockfrost.submitTransaction).not.toHaveBeenCalled();
  });

  // Test 3: Dedup hit - already confirmed
  it('returns success without resubmission when dedup record is confirmed', async () => {
    mockVerifyPayment.mockResolvedValue({ isValid: true, extensions: { txHash: TX_HASH } });
    redis.set.mockResolvedValue(null); // SET NX fails (key exists)
    const confirmedRecord: SettlementRecord = {
      txHash: TX_HASH,
      status: 'confirmed',
      submittedAt: Date.now() - 60_000,
      confirmedAt: Date.now() - 30_000,
    };
    redis.get.mockResolvedValue(JSON.stringify(confirmedRecord));

    const result = await settlePayment(
      ctx,
      CBOR_BYTES,
      blockfrost as unknown as BlockfrostClient,
      redis,
      NETWORK,
      logger
    );

    expect(result).toMatchObject({
      success: true,
      transaction: TX_HASH,
      network: NETWORK,
    });
    expect(blockfrost.submitTransaction).not.toHaveBeenCalled();
  });

  // Test 4: Dedup hit - still pending, now confirmed on-chain
  it('returns success when dedup record is submitted and tx is now confirmed', async () => {
    mockVerifyPayment.mockResolvedValue({ isValid: true, extensions: { txHash: TX_HASH } });
    redis.set.mockResolvedValue(null); // SET NX fails
    const submittedRecord: SettlementRecord = {
      txHash: TX_HASH,
      status: 'submitted',
      submittedAt: Date.now() - 60_000,
    };
    redis.get.mockResolvedValue(JSON.stringify(submittedRecord));
    blockfrost.getTransaction.mockResolvedValue(makeTxInfo());

    const result = await settlePayment(
      ctx,
      CBOR_BYTES,
      blockfrost as unknown as BlockfrostClient,
      redis,
      NETWORK,
      logger
    );

    expect(result).toMatchObject({
      success: true,
      transaction: TX_HASH,
      network: NETWORK,
    });
    expect(blockfrost.submitTransaction).not.toHaveBeenCalled();
    // Should have updated Redis record to confirmed
    expect(redis.set).toHaveBeenCalledTimes(2); // initial NX + update to confirmed
  });

  // Test 5: Dedup hit - still pending, not confirmed on-chain
  it('returns timeout when dedup record is submitted and tx is still unconfirmed', async () => {
    mockVerifyPayment.mockResolvedValue({ isValid: true, extensions: { txHash: TX_HASH } });
    redis.set.mockResolvedValue(null); // SET NX fails
    const submittedRecord: SettlementRecord = {
      txHash: TX_HASH,
      status: 'submitted',
      submittedAt: Date.now() - 60_000,
    };
    redis.get.mockResolvedValue(JSON.stringify(submittedRecord));
    blockfrost.getTransaction.mockResolvedValue(null); // not confirmed

    const result = await settlePayment(
      ctx,
      CBOR_BYTES,
      blockfrost as unknown as BlockfrostClient,
      redis,
      NETWORK,
      logger
    );

    expect(result).toMatchObject({
      success: false,
      errorReason: 'confirmation_timeout',
      transaction: TX_HASH,
    });
    expect(blockfrost.submitTransaction).not.toHaveBeenCalled();
  });

  // Test 6: Submit 400 error (invalid transaction)
  it('returns invalid_transaction when Blockfrost returns 400', async () => {
    mockVerifyPayment.mockResolvedValue({ isValid: true, extensions: { txHash: TX_HASH } });
    redis.set.mockResolvedValue('OK');
    blockfrost.submitTransaction.mockRejectedValue(makeBlockfrostServerError(400));

    const result = await settlePayment(
      ctx,
      CBOR_BYTES,
      blockfrost as unknown as BlockfrostClient,
      redis,
      NETWORK,
      logger
    );

    expect(result).toMatchObject({
      success: false,
      errorReason: 'invalid_transaction',
    });
  });

  // Test 7: Submit other error (non-400)
  it('returns submission_rejected when submit throws non-400 error', async () => {
    mockVerifyPayment.mockResolvedValue({ isValid: true, extensions: { txHash: TX_HASH } });
    redis.set.mockResolvedValue('OK');
    blockfrost.submitTransaction.mockRejectedValue(new Error('Network failure'));

    const result = await settlePayment(
      ctx,
      CBOR_BYTES,
      blockfrost as unknown as BlockfrostClient,
      redis,
      NETWORK,
      logger
    );

    expect(result).toMatchObject({
      success: false,
      errorReason: 'submission_rejected',
    });
  });

  // Test 8: Poll timeout
  it('returns confirmation_timeout when poll exhausts timeout', async () => {
    mockVerifyPayment.mockResolvedValue({ isValid: true, extensions: { txHash: TX_HASH } });
    redis.set.mockResolvedValue('OK');
    blockfrost.submitTransaction.mockResolvedValue(TX_HASH);
    blockfrost.getTransaction.mockResolvedValue(null); // never confirms

    // Start the settlement but let timers advance
    const resultPromise = settlePayment(
      ctx,
      CBOR_BYTES,
      blockfrost as unknown as BlockfrostClient,
      redis,
      NETWORK,
      logger
    );

    // Advance past the 120s timeout in poll loop
    // Each poll iteration: getTransaction + 5s sleep
    // We need enough advances to exceed the deadline
    for (let i = 0; i < 25; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
    }

    const result = await resultPromise;

    expect(result).toMatchObject({
      success: false,
      errorReason: 'confirmation_timeout',
      transaction: TX_HASH,
    });
  });

  // Test 9: Poll confirms on second attempt
  it('returns success when poll confirms on second attempt', async () => {
    mockVerifyPayment.mockResolvedValue({ isValid: true, extensions: { txHash: TX_HASH } });
    redis.set.mockResolvedValue('OK');
    blockfrost.submitTransaction.mockResolvedValue(TX_HASH);
    blockfrost.getTransaction
      .mockResolvedValueOnce(null) // first poll: not confirmed
      .mockResolvedValueOnce(makeTxInfo()); // second poll: confirmed

    const resultPromise = settlePayment(
      ctx,
      CBOR_BYTES,
      blockfrost as unknown as BlockfrostClient,
      redis,
      NETWORK,
      logger
    );

    // Advance past first poll interval
    await vi.advanceTimersByTimeAsync(5_000);

    const result = await resultPromise;

    expect(result).toMatchObject({
      success: true,
      transaction: TX_HASH,
      network: NETWORK,
    });
    expect(blockfrost.getTransaction).toHaveBeenCalledTimes(2);
  });

  // Test 10: Dedup hit - failed record
  it('returns failure with stored reason when dedup record is failed', async () => {
    mockVerifyPayment.mockResolvedValue({ isValid: true, extensions: { txHash: TX_HASH } });
    redis.set.mockResolvedValue(null); // SET NX fails
    const failedRecord: SettlementRecord = {
      txHash: TX_HASH,
      status: 'failed',
      submittedAt: Date.now() - 60_000,
      reason: 'invalid_transaction',
    };
    redis.get.mockResolvedValue(JSON.stringify(failedRecord));

    const result = await settlePayment(
      ctx,
      CBOR_BYTES,
      blockfrost as unknown as BlockfrostClient,
      redis,
      NETWORK,
      logger
    );

    expect(result).toMatchObject({
      success: false,
      errorReason: 'invalid_transaction',
    });
    expect(blockfrost.submitTransaction).not.toHaveBeenCalled();
  });

  // Test 11: Redis SET NX uses tx-hash-keyed dedup
  it('keys the dedup record on the verified tx hash, not the raw CBOR bytes', async () => {
    mockVerifyPayment.mockResolvedValue({ isValid: true, extensions: { txHash: TX_HASH } });
    redis.set.mockResolvedValue('OK');
    blockfrost.submitTransaction.mockResolvedValue(TX_HASH);
    blockfrost.getTransaction.mockResolvedValue(makeTxInfo());

    await settlePayment(
      ctx,
      CBOR_BYTES,
      blockfrost as unknown as BlockfrostClient,
      redis,
      NETWORK,
      logger
    );

    // First redis.set call should be the NX dedup claim, keyed on tx hash
    const firstSetCall = redis.set.mock.calls[0];
    expect(firstSetCall[0]).toBe(`settle:${TX_HASH}`);
    expect(firstSetCall).toContain('NX'); // SET NX
    expect(firstSetCall).toContain('EX'); // With TTL
  });

  // Test 11b: Witness-mutation invariant. Same tx body (= same txHash) ⇒ same
  // dedup key regardless of which CBOR encoding the caller submits. This is
  // the C2 contract: witness reordering MUST NOT bypass dedup.
  it('produces the same dedup key for any CBOR encoding of the same tx body', async () => {
    mockVerifyPayment.mockResolvedValue({ isValid: true, extensions: { txHash: TX_HASH } });
    redis.set.mockResolvedValue('OK');
    blockfrost.submitTransaction.mockResolvedValue(TX_HASH);
    blockfrost.getTransaction.mockResolvedValue(makeTxInfo());

    // Two distinct CBOR byte sequences (e.g. raw bytes vs. witness-reordered
    // bytes) that decode to the same on-chain transaction.
    const cborVariantA = new Uint8Array([0xa1, 0xa2, 0xa3, 0xa4]);
    const cborVariantB = new Uint8Array([0xb1, 0xb2, 0xb3, 0xb4, 0xb5]);

    await settlePayment(
      ctx,
      cborVariantA,
      blockfrost as unknown as BlockfrostClient,
      redis,
      NETWORK,
      logger
    );
    const keyForA = redis.set.mock.calls[0][0];

    redis.set.mockClear();
    redis.set.mockResolvedValue('OK');

    await settlePayment(
      ctx,
      cborVariantB,
      blockfrost as unknown as BlockfrostClient,
      redis,
      NETWORK,
      logger
    );
    const keyForB = redis.set.mock.calls[0][0];

    expect(keyForA).toBe(keyForB);
    expect(keyForA).toBe(`settle:${TX_HASH}`);
  });

  // Test 11c: Different tx bodies (= different txHash) ⇒ different dedup keys.
  it('produces distinct dedup keys for distinct tx hashes', async () => {
    const txHashA = 'a'.repeat(64);
    const txHashB = 'b'.repeat(64);

    mockVerifyPayment.mockResolvedValue({ isValid: true, extensions: { txHash: txHashA } });
    redis.set.mockResolvedValue('OK');
    blockfrost.submitTransaction.mockResolvedValue(txHashA);
    blockfrost.getTransaction.mockResolvedValue(makeTxInfo({ hash: txHashA }));

    await settlePayment(
      ctx,
      CBOR_BYTES,
      blockfrost as unknown as BlockfrostClient,
      redis,
      NETWORK,
      logger
    );
    const keyForA = redis.set.mock.calls[0][0];

    redis.set.mockClear();
    redis.set.mockResolvedValue('OK');
    mockVerifyPayment.mockResolvedValue({ isValid: true, extensions: { txHash: txHashB } });
    blockfrost.submitTransaction.mockResolvedValue(txHashB);
    blockfrost.getTransaction.mockResolvedValue(makeTxInfo({ hash: txHashB }));

    await settlePayment(
      ctx,
      CBOR_BYTES,
      blockfrost as unknown as BlockfrostClient,
      redis,
      NETWORK,
      logger
    );
    const keyForB = redis.set.mock.calls[0][0];

    expect(keyForA).not.toBe(keyForB);
    expect(keyForA).toBe(`settle:${txHashA}`);
    expect(keyForB).toBe(`settle:${txHashB}`);
  });

  // Test 11d: When verifyPayment returns isValid but no txHash, settle must
  // refuse rather than fall back to a degenerate dedup key.
  it('returns internal_error when verifyPayment is missing extensions.txHash', async () => {
    mockVerifyPayment.mockResolvedValue({ isValid: true }); // no extensions
    redis.set.mockResolvedValue('OK');

    const result = await settlePayment(
      ctx,
      CBOR_BYTES,
      blockfrost as unknown as BlockfrostClient,
      redis,
      NETWORK,
      logger
    );

    expect(result).toMatchObject({
      success: false,
      errorReason: 'internal_error',
    });
    expect(redis.set).not.toHaveBeenCalled();
    expect(blockfrost.submitTransaction).not.toHaveBeenCalled();
  });

  // Test 12: Dedup hit - timeout record, now confirmed
  it('returns success when dedup record is timeout but tx is now confirmed', async () => {
    mockVerifyPayment.mockResolvedValue({ isValid: true, extensions: { txHash: TX_HASH } });
    redis.set.mockResolvedValue(null); // SET NX fails
    const timeoutRecord: SettlementRecord = {
      txHash: TX_HASH,
      status: 'timeout',
      submittedAt: Date.now() - 120_000,
    };
    redis.get.mockResolvedValue(JSON.stringify(timeoutRecord));
    blockfrost.getTransaction.mockResolvedValue(makeTxInfo());

    const result = await settlePayment(
      ctx,
      CBOR_BYTES,
      blockfrost as unknown as BlockfrostClient,
      redis,
      NETWORK,
      logger
    );

    expect(result).toMatchObject({
      success: true,
      transaction: TX_HASH,
      network: NETWORK,
    });
    expect(blockfrost.submitTransaction).not.toHaveBeenCalled();
  });
});
