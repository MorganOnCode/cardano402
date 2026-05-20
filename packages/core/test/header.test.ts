import { describe, expect, it } from 'vitest';

import {
  Cardano402DecodeError,
  Cardano402ValidationError,
} from '../src/errors.js';
import {
  PAYMENT_REQUEST_HEADER,
  PAYMENT_REQUEST_HEADER_ALIAS,
  PAYMENT_REQUEST_HEADER_NAMES,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_RESPONSE_HEADER_ALIAS,
  PAYMENT_RESPONSE_HEADER_NAMES,
  decodePaymentHeader,
  encodePaymentHeader,
  findPaymentHeader,
} from '../src/header.js';
import type { PaymentPayload } from '../src/schemas.js';

const sampleRequirements = {
  scheme: 'exact' as const,
  network: 'cardano:preview',
  asset: 'lovelace',
  amount: '2000000',
  payTo: 'addr_test1abc',
  maxTimeoutSeconds: 300,
};

const samplePayload: PaymentPayload = {
  x402Version: 2,
  accepted: sampleRequirements,
  payload: { transaction: 'tx-bytes' },
};

describe('header constants', () => {
  it('exports canonical names and aliases', () => {
    expect(PAYMENT_REQUEST_HEADER).toBe('Payment-Signature');
    expect(PAYMENT_REQUEST_HEADER_ALIAS).toBe('X-PAYMENT');
    expect(PAYMENT_REQUEST_HEADER_NAMES).toEqual(['Payment-Signature', 'X-PAYMENT']);
    expect(PAYMENT_REQUIRED_HEADER).toBe('Payment-Required');
    expect(PAYMENT_RESPONSE_HEADER).toBe('X-Payment-Response');
    expect(PAYMENT_RESPONSE_HEADER_ALIAS).toBe('PAYMENT-RESPONSE');
    expect(PAYMENT_RESPONSE_HEADER_NAMES).toEqual(['X-Payment-Response', 'PAYMENT-RESPONSE']);
  });
});

describe('encode/decode round-trip', () => {
  it('round-trips a PaymentPayload through base64-encoded JSON', () => {
    const encoded = encodePaymentHeader(samplePayload);
    const decoded = decodePaymentHeader(encoded);
    expect(decoded.x402Version).toBe(2);
    expect(decoded.payload.transaction).toBe('tx-bytes');
    expect(decoded.accepted.amount).toBe('2000000');
  });
});

describe('encodePaymentHeader errors', () => {
  it('throws Cardano402ValidationError for malformed payload', () => {
    const bad = { ...samplePayload, x402Version: 1 } as unknown as PaymentPayload;
    let caught: unknown;
    try {
      encodePaymentHeader(bad);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Cardano402ValidationError);
    expect((caught as Cardano402ValidationError).issues.length).toBeGreaterThan(0);
  });
});

describe('decodePaymentHeader errors', () => {
  it('throws Cardano402DecodeError on invalid base64', () => {
    expect(() => decodePaymentHeader('###')).toThrow(Cardano402DecodeError);
  });

  it('throws Cardano402DecodeError on base64 of invalid JSON', () => {
    const garbageB64 = Buffer.from('not json at all', 'utf-8').toString('base64');
    expect(() => decodePaymentHeader(garbageB64)).toThrow(Cardano402DecodeError);
  });

  it('throws Cardano402ValidationError on base64 of shape-mismatch JSON', () => {
    const emptyObjB64 = Buffer.from('{}', 'utf-8').toString('base64');
    expect(() => decodePaymentHeader(emptyObjB64)).toThrow(Cardano402ValidationError);
  });
});

describe('findPaymentHeader', () => {
  it('finds canonical Payment-Signature on a plain object', () => {
    expect(findPaymentHeader({ 'Payment-Signature': 'hdr-1' })).toBe('hdr-1');
  });

  it('finds the X-PAYMENT alias on a plain object', () => {
    expect(findPaymentHeader({ 'X-PAYMENT': 'hdr-2' })).toBe('hdr-2');
  });

  it('case-insensitively matches header name', () => {
    expect(findPaymentHeader({ 'payment-signature': 'hdr-3' })).toBe('hdr-3');
    expect(findPaymentHeader({ 'x-payment': 'hdr-4' })).toBe('hdr-4');
  });

  it('works on a fetch Headers instance', () => {
    const h = new Headers();
    h.set('Payment-Signature', 'hdr-5');
    expect(findPaymentHeader(h)).toBe('hdr-5');
  });

  it('handles Node-style array values', () => {
    expect(findPaymentHeader({ 'payment-signature': ['arr-0', 'arr-1'] })).toBe('arr-0');
  });

  it('returns null when no payment header is present', () => {
    expect(findPaymentHeader({ Authorization: 'Bearer xyz' })).toBeNull();
    expect(findPaymentHeader(new Headers())).toBeNull();
  });
});
