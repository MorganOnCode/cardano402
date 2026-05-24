import { describe, it, expect } from 'vitest';

import { Cardano402ValidationError } from '@cardano402/core';

import { assertPublicUrl, assertSafePath } from '../src/catalog.js';

describe('assertPublicUrl', () => {
  it('accepts a routable HTTPS URL', () => {
    expect(() =>
      assertPublicUrl('https://api.example.com/.well-known/x402.json', 'catalogUrl')
    ).not.toThrow();
  });

  it.each([
    'http://127.0.0.1:3000/x',
    'http://localhost/x',
    'http://[::1]/x',
    'http://10.0.0.5/x',
    'http://172.16.5.5/x',
    'http://192.168.0.1/x',
    'http://169.254.169.254/latest/meta-data', // AWS IMDS
    'http://100.64.1.1/x', // CGNAT
    'http://0.0.0.0/x',
    'http://224.0.0.1/x', // multicast
  ])('rejects private/loopback/reserved address %s', (url) => {
    expect(() => assertPublicUrl(url, 'serverUrl')).toThrow(Cardano402ValidationError);
  });

  it.each([
    'http://[fc00::1]/x', // RFC4193 unique local
    'http://[fd00::1]/x',
    'http://[fe80::1]/x', // link-local IPv6
    'http://[::ffff:127.0.0.1]/x', // IPv4-mapped loopback
    'http://[::ffff:10.0.0.1]/x', // IPv4-mapped RFC1918
  ])('rejects reserved IPv6 form %s', (url) => {
    expect(() => assertPublicUrl(url, 'serverUrl')).toThrow(Cardano402ValidationError);
  });

  it('rejects non-http(s) protocols', () => {
    expect(() => assertPublicUrl('file:///etc/passwd', 'serverUrl')).toThrow(
      Cardano402ValidationError
    );
    expect(() => assertPublicUrl('gopher://x/', 'serverUrl')).toThrow(
      Cardano402ValidationError
    );
  });

  it('rejects clearly malformed URLs', () => {
    expect(() => assertPublicUrl('not a url', 'serverUrl')).toThrow(
      Cardano402ValidationError
    );
  });
});

describe('assertSafePath', () => {
  it('accepts a normal slash-rooted path', () => {
    expect(() => assertSafePath('/api/analyze')).not.toThrow();
  });

  it('accepts a path-without-leading-slash (joinUrl will normalise it)', () => {
    expect(() => assertSafePath('api/analyze')).not.toThrow();
  });

  it.each([
    '/api/../etc/passwd',
    '../../etc/passwd',
    '/api/..',
    '..',
  ])('rejects parent-directory traversal %s', (p) => {
    expect(() => assertSafePath(p)).toThrow(Cardano402ValidationError);
  });

  it('rejects absolute URLs in the path slot', () => {
    expect(() => assertSafePath('https://attacker.example/x')).toThrow(
      Cardano402ValidationError
    );
    expect(() => assertSafePath('http://attacker.example/x')).toThrow(
      Cardano402ValidationError
    );
  });

  it('rejects protocol-relative paths', () => {
    expect(() => assertSafePath('//attacker.example/x')).toThrow(
      Cardano402ValidationError
    );
  });

  it('rejects NUL bytes and CR/LF', () => {
    expect(() => assertSafePath('/api/\0evil')).toThrow(Cardano402ValidationError);
    expect(() => assertSafePath('/api/x\nX-Injected: 1')).toThrow(
      Cardano402ValidationError
    );
    expect(() => assertSafePath('/api/x\r\nX-Injected: 1')).toThrow(
      Cardano402ValidationError
    );
  });

  it('rejects empty path', () => {
    expect(() => assertSafePath('')).toThrow(Cardano402ValidationError);
  });
});
