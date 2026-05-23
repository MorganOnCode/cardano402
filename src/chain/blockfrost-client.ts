import { BlockFrostAPI, BlockfrostServerError } from '@blockfrost/blockfrost-js';
import type { FastifyBaseLogger } from 'fastify';

import type { ChainConfig } from './config.js';
import { ChainConnectionError, ChainRateLimitedError } from './errors.js';
import type { CardanoNetwork } from './types.js';
import type { TxInfo } from '../settle/types.js';

// ---- Constants ----

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 20_000;

/** Status codes that warrant retry with backoff. */
const RETRYABLE_STATUS_CODES = new Set([425, 429, 500, 502, 503, 504]);

/** Network error codes that warrant retry. */
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ENETUNREACH',
]);

// ---- Retry helpers ----

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Determine whether an error is retryable.
 *
 * Retryable errors include Blockfrost server errors with certain status codes
 * (425, 429, 500, 502, 503, 504) and network-level errors (ECONNREFUSED, etc.).
 */
function isRetryableError(error: unknown): boolean {
  // Blockfrost server error with retryable status code
  if (error instanceof BlockfrostServerError) {
    return RETRYABLE_STATUS_CODES.has(error.status_code);
  }

  // Network-level error with recognizable code
  if (error instanceof Error && 'code' in error) {
    const code = (error as Error & { code: string }).code;
    return RETRYABLE_NETWORK_CODES.has(code);
  }

  return false;
}

/**
 * Determine whether an error is a rate-limit response (HTTP 429).
 */
function isRateLimitError(error: unknown): boolean {
  return error instanceof BlockfrostServerError && error.status_code === 429;
}

/**
 * Determine whether an error is a network/connection error.
 */
function isNetworkError(error: unknown): boolean {
  if (error instanceof Error && 'code' in error) {
    const code = (error as Error & { code: string }).code;
    return RETRYABLE_NETWORK_CODES.has(code);
  }
  // Server errors 500-504 that exhaust retries are treated as connection issues
  if (error instanceof BlockfrostServerError) {
    return [500, 502, 503, 504].includes(error.status_code);
  }
  return false;
}

// ---- Public API ----

/**
 * Execute an async function with exponential backoff retry.
 *
 * Retry schedule: 500ms, 1000ms, 2000ms (base * 2^attempt).
 * Retries on: 425, 429, 500, 502, 503, 504, and network errors.
 * Non-retryable errors are thrown immediately.
 *
 * After retry exhaustion:
 * - 429 errors throw ChainRateLimitedError
 * - Network errors throw ChainConnectionError
 * - Other retryable errors throw ChainConnectionError
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  log: FastifyBaseLogger
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Non-retryable errors are thrown immediately
      if (!isRetryableError(error)) {
        throw error;
      }

      // If we've exhausted retries, break out to throw mapped error
      if (attempt >= MAX_RETRIES) {
        break;
      }

      const delay = BASE_DELAY_MS * 2 ** attempt;
      log.warn(
        { attempt: attempt + 1, delay, label },
        'Retrying Blockfrost request after transient error'
      );

      await sleep(delay);
    }
  }

  // Map exhausted error to domain error
  if (isRateLimitError(lastError)) {
    throw new ChainRateLimitedError(label);
  }

  if (isNetworkError(lastError)) {
    throw new ChainConnectionError(label);
  }

  // Fallback: re-throw the last error (should not reach here for retryable errors)
  throw lastError;
}

// ---- BlockfrostClient ----

interface BlockfrostClientOptions {
  projectId: string;
  network: CardanoNetwork;
  logger: FastifyBaseLogger;
}

/**
 * Blockfrost API client with built-in exponential backoff retry logic.
 *
 * Wraps `@blockfrost/blockfrost-js` BlockFrostAPI with:
 * - Exponential backoff (500ms, 1000ms, 2000ms) on retryable errors
 * - Rate limit exhaustion mapped to ChainRateLimitedError
 * - Network errors mapped to ChainConnectionError
 * - 404 on unused addresses returns empty array (getAddressUtxos)
 * - 404 on unconfirmed transactions returns null (getTransaction)
 *
 * SECURITY: The projectId (API key) is never stored as a public property,
 * never included in error messages, and never logged.
 */
export class BlockfrostClient {
  /** @internal */
  private readonly api: BlockFrostAPI;
  /** @internal */
  private readonly log: FastifyBaseLogger;

  constructor(options: BlockfrostClientOptions) {
    this.log = options.logger;
    this.api = new BlockFrostAPI({
      projectId: options.projectId,
      rateLimiter: true,
      requestTimeout: REQUEST_TIMEOUT_MS,
    });
  }

  /** Fetch the latest block on chain. */
  async getLatestBlock(): Promise<unknown> {
    return withRetry(() => this.api.blocksLatest(), 'getLatestBlock', this.log);
  }

  /**
   * Fetch the height of the latest block. Convenience accessor used by
   * settlement confirmation-depth gating (Ouroboros Praos has probabilistic
   * finality; a single-block sighting can be rolled back at depth 1).
   */
  async getLatestBlockHeight(): Promise<number> {
    const block = (await this.getLatestBlock()) as { height?: number | null };
    if (typeof block.height !== 'number') {
      throw new Error('Blockfrost blocksLatest returned no height');
    }
    return block.height;
  }

  /** Fetch current epoch protocol parameters. */
  async getEpochParameters(): Promise<unknown> {
    return withRetry(() => this.api.epochsLatestParameters(), 'getEpochParameters', this.log);
  }

  /**
   * Fetch UTxOs for an address.
   * Returns empty array for unused addresses (Blockfrost returns 404).
   */
  async getAddressUtxos(address: string): Promise<unknown[]> {
    try {
      return await withRetry(() => this.api.addressesUtxos(address), 'getAddressUtxos', this.log);
    } catch (error) {
      // Blockfrost returns 404 for addresses with no UTxOs
      if (error instanceof BlockfrostServerError && error.status_code === 404) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Submit a signed transaction to Blockfrost.
   *
   * Delegates to `this.api.txSubmit()` with retry on transient errors
   * (425 mempool full, 429, 500-504). A 400 (invalid transaction) is NOT
   * retried -- the caller must catch and map to a user-friendly reason.
   */
  async submitTransaction(cborBytes: Uint8Array): Promise<string> {
    return withRetry(() => this.api.txSubmit(cborBytes), 'submitTransaction', this.log);
  }

  /**
   * Fetch transaction details by hash.
   * Returns null if the transaction is not yet confirmed (404).
   * Follows the same 404-as-null pattern as getAddressUtxos.
   */
  async getTransaction(txHash: string): Promise<TxInfo | null> {
    try {
      return await withRetry(
        () => this.api.txs(txHash) as Promise<TxInfo>,
        'getTransaction',
        this.log
      );
    } catch (error) {
      if (error instanceof BlockfrostServerError && error.status_code === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Determine whether the UTXO at txHash#index is unspent in the current
   * on-chain UTXO set.
   *
   * Strategy: fetch the producing transaction's UTXOs (`txsUtxos(txHash)`),
   * locate the output at `index`, then ask Blockfrost for the UTxOs at that
   * output's address (`addressesUtxos(addr)`) and check whether any of them
   * carry the same `tx_hash + output_index`.
   *
   * Returns:
   *   - true  if the UTXO exists and is currently unspent
   *   - false if the producing tx exists but the output is missing or already spent
   *
   * Throws:
   *   - if the producing tx itself is not found on-chain (404)
   *   - on any non-404 Blockfrost error
   *
   * Spec: x402 Cardano scheme — facilitator MUST verify nonce UTXO is unspent.
   */
  async isUtxoUnspent(txHash: string, index: number): Promise<boolean> {
    let txUtxos: { outputs?: { address: string; output_index: number }[] };
    try {
      txUtxos = await withRetry(
        () =>
          this.api.txsUtxos(txHash) as Promise<{
            outputs: { address: string; output_index: number }[];
          }>,
        'isUtxoUnspent.txsUtxos',
        this.log
      );
    } catch (error) {
      if (error instanceof BlockfrostServerError && error.status_code === 404) {
        // Producing tx not found at all: cannot be a valid unspent UTXO.
        return false;
      }
      throw error;
    }

    const target = (txUtxos.outputs ?? []).find((o) => o.output_index === index);
    if (!target) {
      // Output index does not exist on the producing tx.
      return false;
    }

    // Pull the UTxOs at the holding address and look for our (txHash, index).
    let addrUtxos: { tx_hash: string; output_index: number }[];
    try {
      addrUtxos = (await withRetry(
        () => this.api.addressesUtxos(target.address),
        'isUtxoUnspent.addressesUtxos',
        this.log
      )) as { tx_hash: string; output_index: number }[];
    } catch (error) {
      if (error instanceof BlockfrostServerError && error.status_code === 404) {
        // Address has no UTxOs at all -> our target is definitely spent.
        return false;
      }
      throw error;
    }

    return addrUtxos.some((u) => u.tx_hash === txHash && u.output_index === index);
  }
}

/**
 * Create a BlockfrostClient from the application's chain configuration.
 */
export function createBlockfrostClient(
  config: ChainConfig,
  logger: FastifyBaseLogger
): BlockfrostClient {
  return new BlockfrostClient({
    projectId: config.blockfrost.projectId,
    network: config.network as CardanoNetwork,
    logger,
  });
}
