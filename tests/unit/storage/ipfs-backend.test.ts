import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { IpfsBackend } from '../../../src/storage/ipfs-backend.js';

describe('IpfsBackend', () => {
  let backend: IpfsBackend;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    backend = new IpfsBackend('http://localhost:5001');
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('put()', () => {
    it('should call POST /api/v0/add and return the Hash', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ Hash: 'QmTestCid123', Size: '42' }), { status: 200 })
      );

      const result = await backend.put(Buffer.from('test data'));

      expect(result).toBe('QmTestCid123');
      expect(fetchSpy).toHaveBeenCalledOnce();

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:5001/api/v0/add');
      expect(init.method).toBe('POST');
    });

    it('should throw when IPFS returns non-200', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' })
      );

      await expect(backend.put(Buffer.from('fail'))).rejects.toThrow(
        'IPFS add failed: 500 Internal Server Error'
      );
    });
  });

  describe('get()', () => {
    it('should call POST /api/v0/cat and return Buffer', async () => {
      const content = 'hello from ipfs';
      fetchSpy.mockResolvedValueOnce(new Response(content, { status: 200 }));

      const result = await backend.get('QmTestCid123');

      expect(result).toEqual(Buffer.from(content));
      expect(fetchSpy).toHaveBeenCalledOnce();

      const [url] = fetchSpy.mock.calls[0] as [string];
      expect(url).toBe('http://localhost:5001/api/v0/cat?arg=QmTestCid123');
    });

    it('should return null when IPFS returns non-200', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

      const result = await backend.get('QmNonExistent');
      expect(result).toBeNull();
    });
  });

  describe('has()', () => {
    it('should return true when /api/v0/object/stat returns 200', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));

      expect(await backend.has('QmTestCid123')).toBe(true);

      const [url] = fetchSpy.mock.calls[0] as [string];
      expect(url).toBe('http://localhost:5001/api/v0/object/stat?arg=QmTestCid123');
    });

    it('should return false when /api/v0/object/stat returns non-200', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

      expect(await backend.has('QmNonExistent')).toBe(false);
    });
  });

  describe('healthy()', () => {
    it('should return true when /api/v0/id returns 200', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));

      expect(await backend.healthy()).toBe(true);

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:5001/api/v0/id');
      expect(init.method).toBe('POST');
    });

    it('should return false when fetch throws', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Connection refused'));

      expect(await backend.healthy()).toBe(false);
    });
  });

  describe('constructor', () => {
    it('should strip trailing slashes from API URL', async () => {
      const backendWithSlash = new IpfsBackend('http://localhost:5001///');
      fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));

      await backendWithSlash.healthy();

      const [url] = fetchSpy.mock.calls[0] as [string];
      expect(url).toBe('http://localhost:5001/api/v0/id');
    });
  });
});
