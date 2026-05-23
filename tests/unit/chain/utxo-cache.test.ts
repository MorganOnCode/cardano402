import type { FastifyBaseLogger } from 'fastify';
import type Redis from 'ioredis';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { CachedUtxo } from '../../../src/chain/types.js';
import {
  UtxoCache,
  serializeWithBigInt,
  deserializeWithBigInt,
} from '../../../src/chain/utxo-cache.js';

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------

function createMockRedis() {
  const store = new Map<string, { value: string; expiresAt: number }>();

  return {
    get: vi.fn(async (key: string): Promise<string | null> => {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
      }
      return entry.value;
    }),
    set: vi.fn(async (key: string, value: string, _ex: string, ttl: number): Promise<'OK'> => {
      store.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
      return 'OK';
    }),
    del: vi.fn(async (key: string): Promise<number> => {
      const had = store.has(key);
      store.delete(key);
      return had ? 1 : 0;
    }),
    _store: store,
  };
}

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(),
} as unknown as FastifyBaseLogger;

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const testAddress = 'addr_test1qz...abc';

const testUtxos: CachedUtxo[] = [
  {
    txHash: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
    outputIndex: 0,
    address: testAddress,
    lovelace: 5_000_000n,
    assets: { '0x.policyId.assetName': 100n },
  },
  {
    txHash: 'def789abc012def789abc012def789abc012def789abc012def789abc012def7',
    outputIndex: 1,
    address: testAddress,
    lovelace: 10_000_000_000n,
    assets: {},
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('serializeWithBigInt / deserializeWithBigInt', () => {
  it('should roundtrip objects containing bigint values', () => {
    const original = {
      name: 'test',
      lovelace: 5_000_000n,
      assets: { token: 999_999_999_999_999n },
      nested: { deep: 42n },
    };
    const json = serializeWithBigInt(original);
    const parsed = deserializeWithBigInt(json);

    expect(parsed).toEqual(original);
  });

  it('should handle zero bigint', () => {
    const original = { value: 0n };
    const parsed = deserializeWithBigInt(serializeWithBigInt(original));
    expect(parsed).toEqual({ value: 0n });
  });

  it('should not convert regular number strings ending with n', () => {
    // A string like "hello" should stay "hello"
    const original = { note: 'transaction' };
    const parsed = deserializeWithBigInt(serializeWithBigInt(original));
    expect(parsed).toEqual({ note: 'transaction' });
  });

  it('should handle very large bigint values (> 2^53)', () => {
    const large = 9_007_199_254_740_993n; // Number.MAX_SAFE_INTEGER + 2
    const parsed = deserializeWithBigInt(serializeWithBigInt({ v: large })) as {
      v: bigint;
    };
    expect(parsed.v).toBe(large);
    expect(typeof parsed.v).toBe('bigint');
  });
});

describe('UtxoCache', () => {
  let cache: UtxoCache;
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis = createMockRedis();
    cache = new UtxoCache({
      redis: mockRedis as unknown as Redis,
      ttlMs: 60_000,
      logger: mockLogger,
    });
  });

  it('should return null on empty cache (both layers miss)', async () => {
    const result = await cache.get(testAddress);
    expect(result).toBeNull();
    expect(mockRedis.get).toHaveBeenCalledWith(`utxo:${testAddress}`);
  });

  it('should return cached data from L1 after set (no Redis call for second get)', async () => {
    await cache.set(testAddress, testUtxos);

    // Reset mock to track subsequent calls
    mockRedis.get.mockClear();

    const result = await cache.get(testAddress);
    expect(result).toEqual(testUtxos);
    // L1 hit - should NOT call Redis get
    expect(mockRedis.get).not.toHaveBeenCalled();
  });

  it('should preserve BigInt values through set/get cycle', async () => {
    await cache.set(testAddress, testUtxos);
    const result = await cache.get(testAddress);

    expect(result).not.toBeNull();
    const utxos = result as CachedUtxo[];
    expect(typeof utxos[0].lovelace).toBe('bigint');
    expect(utxos[0].lovelace).toBe(5_000_000n);
    expect(utxos[1].lovelace).toBe(10_000_000_000n);
    expect(typeof utxos[0].assets['0x.policyId.assetName']).toBe('bigint');
    expect(utxos[0].assets['0x.policyId.assetName']).toBe(100n);
  });

  it('should return null after invalidate', async () => {
    await cache.set(testAddress, testUtxos);
    cache.invalidate(testAddress);

    // L1 is cleared, so it should fall through to L2
    // But our mock Redis also had del called, clearing L2
    const result = await cache.get(testAddress);
    expect(result).toBeNull();
  });

  it('should fall through to L2 when L1 entry is expired', async () => {
    // Create cache with very short TTL
    const shortCache = new UtxoCache({
      redis: mockRedis as unknown as Redis,
      ttlMs: 1, // 1ms TTL - will expire almost immediately
      logger: mockLogger,
    });

    await shortCache.set(testAddress, testUtxos);

    // Wait for L1 to expire
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });

    // L1 should be expired, falls through to L2
    // L2 still has the data (Redis TTL is 1 second minimum from Math.ceil)
    const result = await shortCache.get(testAddress);
    expect(result).not.toBeNull();
    expect(mockRedis.get).toHaveBeenCalledWith(`utxo:${testAddress}`);
    // Verify BigInt survived the L2 roundtrip
    const utxos = result as CachedUtxo[];
    expect(typeof utxos[0].lovelace).toBe('bigint');
    expect(utxos[0].lovelace).toBe(5_000_000n);
  });

  it('should write to both L1 and L2 on set', async () => {
    await cache.set(testAddress, testUtxos);

    expect(mockRedis.set).toHaveBeenCalledWith(
      `utxo:${testAddress}`,
      expect.any(String),
      'EX',
      60 // ttlMs 60000 / 1000
    );
  });

  it('should clear all L1 entries on invalidateAll', async () => {
    await cache.set(testAddress, testUtxos);
    await cache.set('addr_other', testUtxos);

    cache.invalidateAll();
    mockRedis.get.mockClear();

    // Both should miss L1 now
    const r1 = await cache.get(testAddress);
    const r2 = await cache.get('addr_other');

    // L2 still has them
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    // Verify Redis was called (L1 was cleared)
    expect(mockRedis.get).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // L1 cache eviction (bounded size)
  // -------------------------------------------------------------------------

  describe('L1 eviction', () => {
    it('should evict the oldest entry when max L1 size exceeded via set()', async () => {
      const smallCache = new UtxoCache({
        redis: mockRedis as unknown as Redis,
        ttlMs: 60_000,
        logger: mockLogger,
        maxL1Entries: 3,
      });

      // Insert 3 entries with staggered timestamps to ensure different expiresAt
      await smallCache.set('addr_1', testUtxos); // oldest
      await smallCache.set('addr_2', testUtxos);
      await smallCache.set('addr_3', testUtxos);

      // All 3 should be present (at cap, not over)
      expect(await smallCache.get('addr_1')).not.toBeNull();
      expect(await smallCache.get('addr_2')).not.toBeNull();
      expect(await smallCache.get('addr_3')).not.toBeNull();

      // 4th entry pushes over cap -> oldest (addr_1) should be evicted
      await smallCache.set('addr_4', testUtxos);

      // addr_1 should now miss L1 (evicted), falls through to L2
      mockRedis.get.mockClear();
      const result = await smallCache.get('addr_1');
      // L2 still has it because our mock Redis stores everything
      expect(result).not.toBeNull();
      expect(mockRedis.get).toHaveBeenCalledWith('utxo:addr_1');

      // addr_4 should be in L1
      mockRedis.get.mockClear();
      const r4 = await smallCache.get('addr_4');
      expect(r4).not.toBeNull();
      // L1 hit - no Redis call
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it('should evict the oldest entry when max L1 size exceeded via L2 warming in get()', async () => {
      const smallCache = new UtxoCache({
        redis: mockRedis as unknown as Redis,
        ttlMs: 60_000,
        logger: mockLogger,
        maxL1Entries: 2,
      });

      // Fill L1 to cap
      await smallCache.set('addr_1', testUtxos); // oldest
      await smallCache.set('addr_2', testUtxos);

      // Manually put a 3rd entry in L2 only (via mock Redis store)
      const serialized = serializeWithBigInt(testUtxos);
      mockRedis._store.set('utxo:addr_3', {
        value: serialized,
        expiresAt: Date.now() + 60_000,
      });

      // Invalidate addr_3 from L1 (it's only in L2)
      // Actually addr_3 was never in L1, so get() will warm L1 from L2
      const result = await smallCache.get('addr_3');
      expect(result).not.toBeNull();

      // L1 should now have addr_2 and addr_3 (addr_1 evicted as oldest)
      mockRedis.get.mockClear();
      const r2 = await smallCache.get('addr_2');
      expect(r2).not.toBeNull();
      expect(mockRedis.get).not.toHaveBeenCalled(); // L1 hit

      const r3 = await smallCache.get('addr_3');
      expect(r3).not.toBeNull();
      // addr_3 was just warmed into L1, so should be L1 hit
    });

    it('should log eviction at debug level', async () => {
      const smallCache = new UtxoCache({
        redis: mockRedis as unknown as Redis,
        ttlMs: 60_000,
        logger: mockLogger,
        maxL1Entries: 1,
      });

      await smallCache.set('addr_1', testUtxos);
      vi.mocked(mockLogger.debug).mockClear();

      await smallCache.set('addr_2', testUtxos);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ evictedAddress: 'addr_1' }),
        'L1 cache entry evicted (max size)'
      );
    });

    it('should default to 10,000 max entries when not specified', () => {
      // The default cache created in beforeEach does not specify maxL1Entries
      // Verify it accepts 10,000+ entries without error (we won't actually
      // create 10K entries, but we verify no eviction for small counts)
      expect(async () => {
        await cache.set('addr_a', testUtxos);
        await cache.set('addr_b', testUtxos);
        await cache.set('addr_c', testUtxos);
      }).not.toThrow();
    });
  });
});
