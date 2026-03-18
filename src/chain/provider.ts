// ChainProvider orchestrator combining cache, reservation, Blockfrost, and Lucid

import type { FastifyBaseLogger } from 'fastify';
import type Redis from 'ioredis';

import { createBlockfrostClient } from './blockfrost-client.js';
import type { BlockfrostClient } from './blockfrost-client.js';
import type { ChainConfig } from './config.js';
import { createLucidInstance } from './lucid-provider.js';
import type { LucidInstance } from './lucid-provider.js';
import type { CachedUtxo } from './types.js';
import { utxoRefToString } from './types.js';
import { createUtxoCache } from './utxo-cache.js';
import type { UtxoCache } from './utxo-cache.js';
import { createUtxoReservation } from './utxo-reservation.js';
import type { UtxoReservation } from './utxo-reservation.js';

// ---------------------------------------------------------------------------
// Protocol parameter cache (in-memory, 5-minute TTL)
// ---------------------------------------------------------------------------

interface ProtocolParamsCache {
  coinsPerUtxoByte: bigint;
  cachedAt: number;
}

const PROTOCOL_PARAMS_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Blockfrost UTXO mapping
// ---------------------------------------------------------------------------

interface BlockfrostAmount {
  unit: string;
  quantity: string;
}

interface BlockfrostUtxo {
  tx_hash: string;
  output_index: number;
  address: string;
  amount: BlockfrostAmount[];
  data_hash?: string | null;
}

/**
 * Map a raw Blockfrost UTXO response to our CachedUtxo format.
 * Extracts lovelace as bigint and native assets keyed by unit.
 */
function mapBlockfrostUtxo(raw: BlockfrostUtxo): CachedUtxo {
  let lovelace = 0n;
  const assets: Record<string, bigint> = {};

  for (const entry of raw.amount) {
    if (entry.unit === 'lovelace') {
      lovelace = BigInt(entry.quantity);
    } else {
      assets[entry.unit] = BigInt(entry.quantity);
    }
  }

  return {
    txHash: raw.tx_hash,
    outputIndex: raw.output_index,
    address: raw.address,
    lovelace,
    assets,
    ...(raw.data_hash ? { datumHash: raw.data_hash } : {}),
  };
}

// ---------------------------------------------------------------------------
// ChainProvider
// ---------------------------------------------------------------------------

interface ChainProviderDeps {
  blockfrost: BlockfrostClient;
  cache: UtxoCache;
  reservation: UtxoReservation;
  lucid: LucidInstance;
  config: ChainConfig;
  logger: FastifyBaseLogger;
}

/**
 * ChainProvider orchestrates all chain components into a unified interface.
 *
 * Provides:
 * - Cache-first UTXO queries (cache -> Blockfrost on miss)
 * - UTXO reservation management (prevent double-spend)
 * - Current slot from latest block
 * - ADA balance calculation
 * - Minimum UTXO lovelace calculation from protocol parameters
 * - Access to Lucid instance for transaction building
 */
export class ChainProvider {
  private readonly blockfrost: BlockfrostClient;
  private readonly cache: UtxoCache;
  private readonly reservation: UtxoReservation;
  private readonly lucid: LucidInstance;
  private readonly config: ChainConfig;
  private readonly logger: FastifyBaseLogger;
  private protocolParamsCache: ProtocolParamsCache | null = null;

  constructor(deps: ChainProviderDeps) {
    this.blockfrost = deps.blockfrost;
    this.cache = deps.cache;
    this.reservation = deps.reservation;
    this.lucid = deps.lucid;
    this.config = deps.config;
    this.logger = deps.logger;
  }

  /**
   * Public accessor for the BlockfrostClient instance.
   * Used by settle/status routes for transaction submission and queries.
   */
  get blockfrostClient(): BlockfrostClient {
    return this.blockfrost;
  }

  /**
   * Get UTXOs for an address with cache-first strategy.
   * Checks cache first; on miss, queries Blockfrost and caches the result.
   */
  async getUtxos(address: string): Promise<CachedUtxo[]> {
    // Check cache first
    const cached = await this.cache.get(address);
    if (cached !== null) {
      return cached;
    }

    // Cache miss - query Blockfrost
    const rawUtxos = await this.blockfrost.getAddressUtxos(address);
    const utxos = (rawUtxos as BlockfrostUtxo[]).map(mapBlockfrostUtxo);

    // Write to cache (fire-and-forget)
    await this.cache.set(address, utxos);

    return utxos;
  }

  /**
   * Get available (unreserved) UTXOs for an address.
   * Filters out UTXOs that are currently reserved by any request.
   */
  async getAvailableUtxos(address: string, _requestId: string): Promise<CachedUtxo[]> {
    const utxos = await this.getUtxos(address);
    return utxos.filter(
      (utxo) =>
        !this.reservation.isReserved(
          utxoRefToString({ txHash: utxo.txHash, outputIndex: utxo.outputIndex })
        )
    );
  }

  /**
   * Reserve a UTXO for exclusive use during transaction construction.
   */
  reserveUtxo(utxoRef: string, requestId: string): boolean {
    return this.reservation.reserve(utxoRef, requestId);
  }

  /**
   * Release a single UTXO reservation.
   */
  releaseUtxo(utxoRef: string): void {
    this.reservation.release(utxoRef);
  }

  /**
   * Release all reservations for a given request ID.
   * Used when a transaction fails and all its UTXOs should be freed.
   */
  releaseAll(requestId: string): void {
    this.reservation.releaseAll(requestId);
  }

  /**
   * Get the current slot number from the latest block.
   */
  async getCurrentSlot(): Promise<number> {
    const block = (await this.blockfrost.getLatestBlock()) as { slot: number };
    return block.slot;
  }

  /**
   * Get the total ADA balance for an address (sum of all UTXO lovelace).
   */
  async getBalance(address: string): Promise<bigint> {
    const utxos = await this.getUtxos(address);
    let total = 0n;
    for (const utxo of utxos) {
      total += utxo.lovelace;
    }
    return total;
  }

  /**
   * Invalidate cached UTXOs for an address.
   * Forces the next query to fetch fresh data from Blockfrost.
   */
  invalidateCache(address: string): void {
    this.cache.invalidate(address);
  }

  /**
   * Get the Lucid Evolution instance for transaction building.
   */
  getLucid(): LucidInstance {
    return this.lucid;
  }

  /**
   * Get the facilitator wallet's bech32 address.
   * Derived from the Lucid wallet (configured via seed phrase or private key).
   * Used by /supported endpoint to report signer addresses.
   */
  async getAddress(): Promise<string> {
    return await this.lucid.wallet().address();
  }

  /**
   * Calculate minimum UTXO lovelace for a basic output.
   *
   * Queries protocol parameters (cached for 5 minutes) and calculates
   * the minimum ADA required for a transaction output.
   *
   * Formula: max(coinsPerUtxoByte * (utxoEntrySizeWithoutVal + 160 + 28 * numAssets), 1_000_000n)
   * For basic outputs (no tokens, no datum): (160 + 2) * coinsPerUtxoByte
   * Minimum floor of 1 ADA (1_000_000 lovelace).
   *
   * NOTE: Lucid's .complete() handles min UTXO automatically during tx building,
   * but this method is needed for pre-validation.
   */
  async getMinUtxoLovelace(numAssets = 0): Promise<bigint> {
    const coinsPerUtxoByte = await this.getCoinsPerUtxoByte();

    // utxoEntrySizeWithoutVal = 160 bytes (constant overhead)
    // Basic value size = 2 bytes (just lovelace, no assets)
    // Each additional asset adds ~28 bytes
    const utxoSize = 160n + 2n + 28n * BigInt(numAssets);
    const calculated = coinsPerUtxoByte * utxoSize;

    // Floor at 1 ADA (1_000_000 lovelace)
    return calculated > 1_000_000n ? calculated : 1_000_000n;
  }

  /**
   * Get reservation status for monitoring/health checks.
   */
  getReservationStatus(): { active: number; max: number } {
    return {
      active: this.reservation.getActiveCount(),
      max: this.config.reservation.maxConcurrent,
    };
  }

  // ---- Private helpers ----

  /**
   * Get coins_per_utxo_size from protocol parameters with 5-minute cache.
   */
  private async getCoinsPerUtxoByte(): Promise<bigint> {
    const now = Date.now();

    if (
      this.protocolParamsCache &&
      now - this.protocolParamsCache.cachedAt < PROTOCOL_PARAMS_TTL_MS
    ) {
      return this.protocolParamsCache.coinsPerUtxoByte;
    }

    const params = (await this.blockfrost.getEpochParameters()) as {
      coins_per_utxo_size: string | null;
      coins_per_utxo_byte: string | null;
    };

    // Blockfrost API uses coins_per_utxo_size (Babbage/Conway era).
    // Fall back to coins_per_utxo_byte for older responses.
    const rawValue = params.coins_per_utxo_size ?? params.coins_per_utxo_byte;
    if (!rawValue) {
      throw new Error('Protocol parameters missing coins_per_utxo_size');
    }
    const coinsPerUtxoByte = BigInt(rawValue);

    this.protocolParamsCache = {
      coinsPerUtxoByte,
      cachedAt: now,
    };

    this.logger.debug(
      { coinsPerUtxoByte: coinsPerUtxoByte.toString() },
      'Protocol parameters cached'
    );

    return coinsPerUtxoByte;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a fully-initialized ChainProvider.
 *
 * - Creates BlockfrostClient for chain queries
 * - Creates UtxoCache (two-layer: in-memory + Redis)
 * - Creates UtxoReservation and loads persisted state from Redis
 * - Initializes Lucid Evolution with Blockfrost provider
 * - Returns orchestrated ChainProvider instance
 *
 * @param config - Chain configuration
 * @param redis - Connected Redis client
 * @param logger - Fastify logger
 */
export async function createChainProvider(
  config: ChainConfig,
  redis: Redis,
  logger: FastifyBaseLogger
): Promise<ChainProvider> {
  const blockfrost = createBlockfrostClient(config, logger);
  const cache = createUtxoCache(redis, config, logger);
  const reservation = createUtxoReservation(redis, config, logger);

  // Recover persisted reservations from Redis
  await reservation.loadFromRedis();

  // Initialize Lucid Evolution
  const lucid = await createLucidInstance(config, logger);

  return new ChainProvider({
    blockfrost,
    cache,
    reservation,
    lucid,
    config,
    logger,
  });
}
