import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { FsBackend } from '../../../src/storage/fs-backend.js';

describe('FsBackend', () => {
  let testDir: string;
  let backend: FsBackend;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'x402-fs-test-'));
    backend = new FsBackend(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('put()', () => {
    it('should return a 64-character hex string (SHA-256 hash)', async () => {
      const data = Buffer.from('hello world');
      const hash = await backend.put(data);

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should return the same hash for the same data (content-addressed)', async () => {
      const data = Buffer.from('deterministic content');
      const hash1 = await backend.put(data);
      const hash2 = await backend.put(data);

      expect(hash1).toBe(hash2);
    });
  });

  describe('get()', () => {
    it('should return stored data correctly', async () => {
      const data = Buffer.from('retrieve me');
      const hash = await backend.put(data);

      const result = await backend.get(hash);
      expect(result).toEqual(data);
    });

    it('should return null for non-existent CID', async () => {
      const fakeCid = 'a'.repeat(64);
      const result = await backend.get(fakeCid);

      expect(result).toBeNull();
    });

    it('should return null for invalid CID format (path traversal protection)', async () => {
      const malicious = '../../../etc/passwd';
      const result = await backend.get(malicious);

      expect(result).toBeNull();
    });

    it('should return null for CID with uppercase hex', async () => {
      const upperCid = 'A'.repeat(64);
      const result = await backend.get(upperCid);

      expect(result).toBeNull();
    });
  });

  describe('has()', () => {
    it('should return true for stored content', async () => {
      const data = Buffer.from('exists');
      const hash = await backend.put(data);

      expect(await backend.has(hash)).toBe(true);
    });

    it('should return false for non-existent CID', async () => {
      const fakeCid = 'b'.repeat(64);
      expect(await backend.has(fakeCid)).toBe(false);
    });

    it('should return false for invalid CID format', async () => {
      expect(await backend.has('../escape')).toBe(false);
    });
  });

  describe('healthy()', () => {
    it('should return true when data directory is accessible', async () => {
      expect(await backend.healthy()).toBe(true);
    });
  });
});
