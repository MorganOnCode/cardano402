import type { FastifyBaseLogger } from 'fastify';
import type Redis from 'ioredis';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { UtxoReservation, createUtxoReservation } from '../../../src/chain/utxo-reservation.js';

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------

function createMockRedis() {
  const store = new Map<string, string>();

  return {
    set: vi.fn(async (key: string, value: string, _px: string, _ttl: number): Promise<'OK'> => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string): Promise<number> => {
      const had = store.has(key);
      store.delete(key);
      return had ? 1 : 0;
    }),
    keys: vi.fn(async (pattern: string): Promise<string[]> => {
      const result: string[] = [];
      for (const key of store.keys()) {
        // Simple glob match for "reservation:*"
        if (pattern === 'reservation:*' && key.startsWith('reservation:')) {
          result.push(key);
        }
      }
      return result;
    }),
    mget: vi.fn(async (...keys: string[]): Promise<(string | null)[]> => {
      // ioredis mget accepts array or spread args
      const flatKeys = Array.isArray(keys[0]) ? (keys[0] as string[]) : keys;
      return flatKeys.map((k) => store.get(k) ?? null);
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
// Tests
// ---------------------------------------------------------------------------

describe('UtxoReservation', () => {
  let reservation: UtxoReservation;
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T00:00:00Z'));
    vi.clearAllMocks();
    mockRedis = createMockRedis();
    reservation = new UtxoReservation({
      redis: mockRedis as unknown as Redis,
      ttlMs: 120_000,
      maxConcurrent: 20,
      logger: mockLogger,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // reserve()
  // -------------------------------------------------------------------------

  describe('reserve()', () => {
    it('should return true when reserving an available UTXO', () => {
      const result = reservation.reserve('txA#0', 'req1');
      expect(result).toBe(true);
    });

    it('should return false when reserving an already-reserved UTXO', () => {
      reservation.reserve('txA#0', 'req1');
      const result = reservation.reserve('txA#0', 'req2');
      expect(result).toBe(false);
    });

    it('should persist reservation to Redis with PX TTL', () => {
      reservation.reserve('txA#0', 'req1');

      expect(mockRedis.set).toHaveBeenCalledWith(
        'reservation:txA#0',
        expect.any(String),
        'PX',
        120_000
      );
    });

    it('should store correct reservation data', () => {
      reservation.reserve('txA#0', 'req1');

      const stored = reservation.getReservation('txA#0');
      expect(stored).toBeDefined();
      expect(stored?.utxoRef).toBe('txA#0');
      expect(stored?.requestId).toBe('req1');
      expect(stored?.reservedAt).toBe(Date.now());
      expect(stored?.expiresAt).toBe(Date.now() + 120_000);
    });

    it('should return false when max concurrent reservations reached', () => {
      // Reserve 20 UTXOs
      for (let i = 0; i < 20; i++) {
        const ok = reservation.reserve(`tx${i}#0`, `req${i}`);
        expect(ok).toBe(true);
      }

      // 21st should be rejected
      const result = reservation.reserve('txOverflow#0', 'reqOverflow');
      expect(result).toBe(false);
    });

    it('should allow reservation after expired one is cleaned', () => {
      reservation.reserve('txA#0', 'req1');

      // Advance past TTL
      vi.advanceTimersByTime(120_001);

      // Should auto-clean the expired reservation and allow new one
      const result = reservation.reserve('txA#0', 'req2');
      expect(result).toBe(true);
    });

    it('should allow reservation after cap clears due to expiry', () => {
      // Fill up all 20 slots
      for (let i = 0; i < 20; i++) {
        reservation.reserve(`tx${i}#0`, `req${i}`);
      }

      // Advance past TTL so all expire
      vi.advanceTimersByTime(120_001);

      // Should succeed after cleanup
      const result = reservation.reserve('txNew#0', 'reqNew');
      expect(result).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // release()
  // -------------------------------------------------------------------------

  describe('release()', () => {
    it('should make UTXO available for re-reservation', () => {
      reservation.reserve('txA#0', 'req1');
      reservation.release('txA#0');

      const result = reservation.reserve('txA#0', 'req2');
      expect(result).toBe(true);
    });

    it('should delete from Redis on release', () => {
      reservation.reserve('txA#0', 'req1');
      reservation.release('txA#0');

      expect(mockRedis.del).toHaveBeenCalledWith('reservation:txA#0');
    });

    it('should log at debug level', () => {
      reservation.reserve('txA#0', 'req1');
      reservation.release('txA#0');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ utxoRef: 'txA#0' }),
        expect.any(String)
      );
    });

    it('should handle releasing non-existent reservation gracefully', () => {
      // Should not throw
      expect(() => reservation.release('nonexistent#0')).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // releaseAll()
  // -------------------------------------------------------------------------

  describe('releaseAll()', () => {
    it('should release all reservations matching a requestId', () => {
      reservation.reserve('txA#0', 'req1');
      reservation.reserve('txB#0', 'req1');
      reservation.reserve('txC#0', 'req2');

      reservation.releaseAll('req1');

      expect(reservation.isReserved('txA#0')).toBe(false);
      expect(reservation.isReserved('txB#0')).toBe(false);
      expect(reservation.isReserved('txC#0')).toBe(true);
    });

    it('should delete matching reservations from Redis', () => {
      reservation.reserve('txA#0', 'req1');
      reservation.reserve('txB#0', 'req1');

      mockRedis.del.mockClear();
      reservation.releaseAll('req1');

      expect(mockRedis.del).toHaveBeenCalledWith('reservation:txA#0');
      expect(mockRedis.del).toHaveBeenCalledWith('reservation:txB#0');
    });

    it('should not affect reservations with different requestId', () => {
      reservation.reserve('txA#0', 'req1');
      reservation.reserve('txB#0', 'req2');

      reservation.releaseAll('req1');

      expect(reservation.getActiveCount()).toBe(1);
      expect(reservation.isReserved('txB#0')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // isReserved()
  // -------------------------------------------------------------------------

  describe('isReserved()', () => {
    it('should return true for an active reservation', () => {
      reservation.reserve('txA#0', 'req1');
      expect(reservation.isReserved('txA#0')).toBe(true);
    });

    it('should return false for unreserved UTXO', () => {
      expect(reservation.isReserved('txA#0')).toBe(false);
    });

    it('should return false for expired reservation', () => {
      reservation.reserve('txA#0', 'req1');
      vi.advanceTimersByTime(120_001);
      expect(reservation.isReserved('txA#0')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getActiveCount()
  // -------------------------------------------------------------------------

  describe('getActiveCount()', () => {
    it('should return 0 initially', () => {
      expect(reservation.getActiveCount()).toBe(0);
    });

    it('should return correct count after reserves and releases', () => {
      reservation.reserve('txA#0', 'req1');
      reservation.reserve('txB#0', 'req2');
      reservation.reserve('txC#0', 'req3');
      reservation.release('txB#0');

      expect(reservation.getActiveCount()).toBe(2);
    });

    it('should exclude expired reservations from count', () => {
      reservation.reserve('txA#0', 'req1');
      reservation.reserve('txB#0', 'req2');

      vi.advanceTimersByTime(120_001);

      expect(reservation.getActiveCount()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // getReservation()
  // -------------------------------------------------------------------------

  describe('getReservation()', () => {
    it('should return reservation object for active reservation', () => {
      reservation.reserve('txA#0', 'req1');
      const r = reservation.getReservation('txA#0');

      expect(r).toBeDefined();
      expect(r?.utxoRef).toBe('txA#0');
      expect(r?.requestId).toBe('req1');
    });

    it('should return undefined for non-existent reservation', () => {
      expect(reservation.getReservation('txA#0')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // loadFromRedis()
  // -------------------------------------------------------------------------

  describe('loadFromRedis()', () => {
    it('should recover reservations from Redis', async () => {
      const now = Date.now();
      const reservationData = JSON.stringify({
        utxoRef: 'txRecovered#0',
        reservedAt: now,
        expiresAt: now + 60_000, // still valid
        requestId: 'reqRecovered',
      });

      mockRedis._store.set('reservation:txRecovered#0', reservationData);

      await reservation.loadFromRedis();

      expect(reservation.isReserved('txRecovered#0')).toBe(true);
      expect(reservation.getActiveCount()).toBe(1);
    });

    it('should skip expired reservations during recovery', async () => {
      const now = Date.now();
      const expired = JSON.stringify({
        utxoRef: 'txExpired#0',
        reservedAt: now - 200_000,
        expiresAt: now - 80_000, // already expired
        requestId: 'reqExpired',
      });

      mockRedis._store.set('reservation:txExpired#0', expired);

      await reservation.loadFromRedis();

      expect(reservation.isReserved('txExpired#0')).toBe(false);
      expect(reservation.getActiveCount()).toBe(0);
    });

    it('should load multiple valid reservations', async () => {
      const now = Date.now();
      for (let i = 0; i < 3; i++) {
        const data = JSON.stringify({
          utxoRef: `tx${i}#0`,
          reservedAt: now,
          expiresAt: now + 60_000,
          requestId: `req${i}`,
        });
        mockRedis._store.set(`reservation:tx${i}#0`, data);
      }

      await reservation.loadFromRedis();

      expect(reservation.getActiveCount()).toBe(3);
    });

    it('should handle empty Redis (no reservations)', async () => {
      await reservation.loadFromRedis();
      expect(reservation.getActiveCount()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // createUtxoReservation() factory
  // -------------------------------------------------------------------------

  describe('createUtxoReservation()', () => {
    it('should create UtxoReservation from config', () => {
      const config = {
        reservation: { ttlSeconds: 120, maxConcurrent: 20 },
      };

      const instance = createUtxoReservation(
        mockRedis as unknown as Redis,
        config as Parameters<typeof createUtxoReservation>[1],
        mockLogger
      );

      expect(instance).toBeInstanceOf(UtxoReservation);
    });
  });
});
