/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ChainProvider } from '../../../src/chain/provider.js';

// Mock Lucid Evolution modules to prevent native module loading (libsodium)
vi.mock('@lucid-evolution/lucid', () => ({
  Lucid: vi.fn(),
}));

vi.mock('@lucid-evolution/provider', () => ({
  Blockfrost: vi.fn(),
}));

// Mock lucid-provider to avoid transitive Lucid Evolution imports
vi.mock('../../../src/chain/lucid-provider.js', () => ({
  createLucidInstance: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: 'info',
    silent: vi.fn(),
  } as any;
}

function createMockBlockfrost() {
  return {
    getAddressUtxos: vi.fn(),
    getLatestBlock: vi.fn(),
    getEpochParameters: vi.fn(),
  } as any;
}

function createMockCache() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    invalidate: vi.fn(),
    invalidateAll: vi.fn(),
  } as any;
}

function createMockReservation() {
  return {
    reserve: vi.fn(),
    release: vi.fn(),
    releaseAll: vi.fn(),
    isReserved: vi.fn(),
    getActiveCount: vi.fn(),
    getReservation: vi.fn(),
    loadFromRedis: vi.fn(),
  } as any;
}

function createMockLucid() {
  return {
    selectWallet: {
      fromSeed: vi.fn(),
      fromPrivateKey: vi.fn(),
    },
    newTx: vi.fn(),
  } as any;
}

const defaultConfig = {
  network: 'Preview' as const,
  blockfrost: { projectId: 'test-project-id', tier: 'free' as const },
  facilitator: { seedPhrase: 'test seed' },
  cache: { utxoTtlSeconds: 60 },
  reservation: { ttlSeconds: 120, maxConcurrent: 20 },
  redis: { host: '127.0.0.1', port: 6379, db: 0 },
  verification: {
    graceBufferSeconds: 30,
    maxTimeoutSeconds: 300,
    feeMinLovelace: 150000,
    feeMaxLovelace: 5000000,
    requireNonce: false,
    confirmationMode: 'confirmed_only' as const,
    minConfirmations: 1,
  },
};

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleBlockfrostUtxos = [
  {
    tx_hash: 'abc123',
    output_index: 0,
    address: 'addr_test1qz...',
    amount: [
      { unit: 'lovelace', quantity: '5000000' },
      { unit: 'policyId.assetName', quantity: '100' },
    ],
    data_hash: null,
  },
  {
    tx_hash: 'def456',
    output_index: 1,
    address: 'addr_test1qz...',
    amount: [{ unit: 'lovelace', quantity: '3000000' }],
    data_hash: 'datumhash123',
  },
];

const sampleCachedUtxos = [
  {
    txHash: 'abc123',
    outputIndex: 0,
    address: 'addr_test1qz...',
    lovelace: 5_000_000n,
    assets: { 'policyId.assetName': 100n },
  },
  {
    txHash: 'def456',
    outputIndex: 1,
    address: 'addr_test1qz...',
    lovelace: 3_000_000n,
    assets: {},
    datumHash: 'datumhash123',
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChainProvider', () => {
  let provider: ChainProvider;
  let mockBlockfrost: ReturnType<typeof createMockBlockfrost>;
  let mockCache: ReturnType<typeof createMockCache>;
  let mockReservation: ReturnType<typeof createMockReservation>;
  let mockLucid: ReturnType<typeof createMockLucid>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockBlockfrost = createMockBlockfrost();
    mockCache = createMockCache();
    mockReservation = createMockReservation();
    mockLucid = createMockLucid();
    mockLogger = createMockLogger();

    provider = new ChainProvider({
      blockfrost: mockBlockfrost,
      cache: mockCache,
      reservation: mockReservation,
      lucid: mockLucid,
      config: defaultConfig,
      logger: mockLogger,
    } as any);
  });

  describe('getUtxos()', () => {
    it('should return from cache on hit (no Blockfrost call)', async () => {
      mockCache.get.mockResolvedValue(sampleCachedUtxos);

      const result = await provider.getUtxos('addr_test1qz...');

      expect(result).toEqual(sampleCachedUtxos);
      expect(mockCache.get).toHaveBeenCalledWith('addr_test1qz...');
      expect(mockBlockfrost.getAddressUtxos).not.toHaveBeenCalled();
    });

    it('should query Blockfrost on cache miss and cache result', async () => {
      mockCache.get.mockResolvedValue(null);
      mockBlockfrost.getAddressUtxos.mockResolvedValue(sampleBlockfrostUtxos);
      mockCache.set.mockResolvedValue(undefined);

      const result = await provider.getUtxos('addr_test1qz...');

      expect(mockBlockfrost.getAddressUtxos).toHaveBeenCalledWith('addr_test1qz...');
      expect(mockCache.set).toHaveBeenCalledWith('addr_test1qz...', result);
      expect(result).toHaveLength(2);
      expect(result[0].txHash).toBe('abc123');
      expect(result[0].lovelace).toBe(5_000_000n);
      expect(result[0].assets).toEqual({ 'policyId.assetName': 100n });
      expect(result[1].datumHash).toBe('datumhash123');
    });
  });

  describe('getAvailableUtxos()', () => {
    it('should filter out reserved UTXOs', async () => {
      mockCache.get.mockResolvedValue(sampleCachedUtxos);
      // First UTXO is reserved, second is not
      mockReservation.isReserved.mockReturnValueOnce(true).mockReturnValueOnce(false);

      const result = await provider.getAvailableUtxos('addr_test1qz...', 'req-1');

      expect(result).toHaveLength(1);
      expect(result[0].txHash).toBe('def456');
      expect(mockReservation.isReserved).toHaveBeenCalledWith('abc123#0');
      expect(mockReservation.isReserved).toHaveBeenCalledWith('def456#1');
    });
  });

  describe('getBalance()', () => {
    it('should sum lovelace across UTXOs correctly with BigInt', async () => {
      mockCache.get.mockResolvedValue(sampleCachedUtxos);

      const balance = await provider.getBalance('addr_test1qz...');

      expect(balance).toBe(8_000_000n);
      expect(typeof balance).toBe('bigint');
    });
  });

  describe('reserveUtxo()', () => {
    it('should delegate to reservation system', () => {
      mockReservation.reserve.mockReturnValue(true);

      const result = provider.reserveUtxo('abc123#0', 'req-1');

      expect(result).toBe(true);
      expect(mockReservation.reserve).toHaveBeenCalledWith('abc123#0', 'req-1');
    });
  });

  describe('releaseUtxo()', () => {
    it('should delegate to reservation system', () => {
      provider.releaseUtxo('abc123#0');

      expect(mockReservation.release).toHaveBeenCalledWith('abc123#0');
    });
  });

  describe('releaseAll()', () => {
    it('should delegate to reservation system', () => {
      provider.releaseAll('req-1');

      expect(mockReservation.releaseAll).toHaveBeenCalledWith('req-1');
    });
  });

  describe('invalidateCache()', () => {
    it('should delegate to cache', () => {
      provider.invalidateCache('addr_test1qz...');

      expect(mockCache.invalidate).toHaveBeenCalledWith('addr_test1qz...');
    });
  });

  describe('getCurrentSlot()', () => {
    it('should return slot from latest block', async () => {
      mockBlockfrost.getLatestBlock.mockResolvedValue({ slot: 12345 });

      const slot = await provider.getCurrentSlot();

      expect(slot).toBe(12345);
      expect(mockBlockfrost.getLatestBlock).toHaveBeenCalled();
    });
  });

  describe('getLucid()', () => {
    it('should return the Lucid instance', () => {
      const lucid = provider.getLucid();

      expect(lucid).toBe(mockLucid);
    });
  });

  describe('getMinUtxoLovelace()', () => {
    it('should return a bigint value based on protocol parameters', async () => {
      mockBlockfrost.getEpochParameters.mockResolvedValue({
        coins_per_utxo_byte: '4310',
      });

      const minLovelace = await provider.getMinUtxoLovelace();

      expect(typeof minLovelace).toBe('bigint');
      // (160 + 2) * 4310 = 698,220 lovelace, but floor is 1_000_000
      expect(minLovelace).toBe(1_000_000n);
    });

    it('should return calculated value when above 1 ADA floor', async () => {
      mockBlockfrost.getEpochParameters.mockResolvedValue({
        coins_per_utxo_byte: '4310',
      });

      // With 10 assets: (160 + 2 + 28*10) * 4310 = 442 * 4310 = 1,905,020
      const minLovelace = await provider.getMinUtxoLovelace(10);

      expect(minLovelace).toBe(1_905_020n);
    });

    it('should cache protocol parameters for subsequent calls', async () => {
      mockBlockfrost.getEpochParameters.mockResolvedValue({
        coins_per_utxo_byte: '4310',
      });

      await provider.getMinUtxoLovelace();
      await provider.getMinUtxoLovelace();

      // Should only call Blockfrost once due to caching
      expect(mockBlockfrost.getEpochParameters).toHaveBeenCalledTimes(1);
    });
  });

  describe('getReservationStatus()', () => {
    it('should return active count and max', () => {
      mockReservation.getActiveCount.mockReturnValue(5);

      const status = provider.getReservationStatus();

      expect(status).toEqual({ active: 5, max: 20 });
    });
  });
});
