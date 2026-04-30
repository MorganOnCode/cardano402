// Unit tests for nonce parser/formatter helpers.

import { describe, expect, it } from 'vitest';

import { formatNonce, parseNonce } from '../../../src/verify/nonce.js';

describe('parseNonce', () => {
  const validHash = 'a'.repeat(64);

  it('parses a well-formed nonce', () => {
    expect(parseNonce(`${validHash}#0`)).toEqual({ txHash: validHash, index: 0 });
    expect(parseNonce(`${validHash}#42`)).toEqual({ txHash: validHash, index: 42 });
  });

  it('rejects empty string', () => {
    expect(parseNonce('')).toBeNull();
  });

  it('rejects missing #', () => {
    expect(parseNonce(validHash)).toBeNull();
  });

  it('rejects non-hex hash', () => {
    expect(parseNonce(`${'g'.repeat(64)}#0`)).toBeNull();
  });

  it('rejects uppercase hex (spec says lowercase)', () => {
    expect(parseNonce(`${'A'.repeat(64)}#0`)).toBeNull();
  });

  it('rejects short hash', () => {
    expect(parseNonce(`${'a'.repeat(63)}#0`)).toBeNull();
  });

  it('rejects long hash', () => {
    expect(parseNonce(`${'a'.repeat(65)}#0`)).toBeNull();
  });

  it('rejects non-numeric index', () => {
    expect(parseNonce(`${validHash}#abc`)).toBeNull();
    expect(parseNonce(`${validHash}#-1`)).toBeNull();
  });

  it('rejects unsafe-integer index', () => {
    // Number larger than Number.MAX_SAFE_INTEGER -> rejected.
    const huge = '9'.repeat(20);
    expect(parseNonce(`${validHash}#${huge}`)).toBeNull();
  });
});

describe('formatNonce', () => {
  it('round-trips with parseNonce', () => {
    const validHash = 'a'.repeat(64);
    const original = { txHash: validHash, index: 7 };
    expect(parseNonce(formatNonce(original))).toEqual(original);
  });
});
