import { describe, it, expect } from 'vitest';

import { buildPaymentRequired } from '../../../src/sdk/payment-required.js';
import type { PaymentRequiredOptions } from '../../../src/sdk/payment-required.js';
import type { PaymentRequiredResponse } from '../../../src/sdk/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function decodePaymentRequired(base64: string): PaymentRequiredResponse {
  return JSON.parse(Buffer.from(base64, 'base64').toString('utf-8')) as PaymentRequiredResponse;
}

const defaultOptions = {
  network: 'cardano:preview',
  amount: '2000000',
  payTo:
    'addr_test1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwqfjkjv7',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildPaymentRequired', () => {
  it('should return a valid base64 string', () => {
    const result = buildPaymentRequired(defaultOptions);
    // Verify it's valid base64 by round-tripping
    const decoded = Buffer.from(result, 'base64').toString('base64');
    expect(decoded).toBe(result);
  });

  it('should decode to JSON with x402Version: 2', () => {
    const result = buildPaymentRequired(defaultOptions);
    const decoded = decodePaymentRequired(result);
    expect(decoded.x402Version).toBe(2);
  });

  it('should have correct accepts array with scheme, network, amount, payTo, asset', () => {
    const result = buildPaymentRequired(defaultOptions);
    const decoded = decodePaymentRequired(result);

    expect(decoded.accepts).toHaveLength(1);
    const accept = decoded.accepts[0];
    expect(accept.scheme).toBe('exact');
    expect(accept.network).toBe('cardano:preview');
    expect(accept.amount).toBe('2000000');
    expect(accept.payTo).toBe(defaultOptions.payTo);
    expect(accept.asset).toBe('lovelace');
  });

  it('should default scheme to "exact" when not provided', () => {
    const result = buildPaymentRequired(defaultOptions);
    const decoded = decodePaymentRequired(result);
    expect(decoded.accepts[0].scheme).toBe('exact');
  });

  it('should default asset to "lovelace" when not provided', () => {
    const result = buildPaymentRequired(defaultOptions);
    const decoded = decodePaymentRequired(result);
    expect(decoded.accepts[0].asset).toBe('lovelace');
  });

  it('should default maxTimeoutSeconds to 300 when not provided', () => {
    const result = buildPaymentRequired(defaultOptions);
    const decoded = decodePaymentRequired(result);
    expect(decoded.accepts[0].maxTimeoutSeconds).toBe(300);
  });

  it('should include error field when provided', () => {
    const result = buildPaymentRequired({
      ...defaultOptions,
      error: 'Payment expired',
    });
    const decoded = decodePaymentRequired(result);
    expect(decoded.error).toBe('Payment expired');
  });

  it('should support custom mimeType and description', () => {
    const result = buildPaymentRequired({
      ...defaultOptions,
      description: 'Access to premium content',
      mimeType: 'text/html',
    });
    const decoded = decodePaymentRequired(result);
    expect(decoded.resource.description).toBe('Access to premium content');
    expect(decoded.resource.mimeType).toBe('text/html');
  });

  it('should use provided asset instead of default', () => {
    const result = buildPaymentRequired({
      ...defaultOptions,
      asset: `${'c'.repeat(56)}.0014df105553444d`,
    });
    const decoded = decodePaymentRequired(result);
    expect(decoded.accepts[0].asset).toBe(`${'c'.repeat(56)}.0014df105553444d`);
  });

  it.each([
    ['custom scheme', { scheme: 'custom' }],
    ['malformed network', { network: 'cardano-mainnet' }],
    ['non-decimal amount', { amount: '1e6' }],
    ['negative amount', { amount: '-1' }],
    ['over-uint64 amount', { amount: '18446744073709551616' }],
    ['address with whitespace', { payTo: 'addr_test1 bad' }],
    ['address with control characters', { payTo: `${defaultOptions.payTo}\n` }],
    ['empty asset', { asset: '' }],
    ['malformed asset identifier', { asset: 'policyId.assetName' }],
    ['over-policy timeout', { maxTimeoutSeconds: 3601 }],
  ])('rejects quotes with %s before encoding Payment-Required', (_label, patch) => {
    expect(() =>
      buildPaymentRequired({
        ...defaultOptions,
        ...(patch as Partial<PaymentRequiredOptions>),
      })
    ).toThrow();
  });
});
