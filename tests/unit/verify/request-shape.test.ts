// Tests for the body-shape normaliser that lets /verify and /settle accept
// either the cardano402-native paymentPayload shape or the base x402
// paymentHeader (base64) shape.

import { MAX_PAYMENT_HEADER_LENGTH } from '@cardano402/core';
import { describe, expect, it } from 'vitest';

import {
  FacilitatorRequestEnvelopeSchema,
  normaliseFacilitatorRequest,
} from '../../../src/verify/request-shape.js';

const validHash = 'a'.repeat(64);

const samplePaymentRequirements = {
  scheme: 'exact' as const,
  network: 'cardano:preview',
  asset: 'lovelace',
  amount: '2000000',
  payTo:
    'addr_test1qz424242424242424242424242424242424242424242424mhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwasmdp8x6',
  maxTimeoutSeconds: 600,
};

const samplePaymentPayload = {
  x402Version: 2 as const,
  accepted: samplePaymentRequirements,
  payload: {
    transaction: 'AAAA',
    nonce: `${validHash}#0`,
  },
};

describe('FacilitatorRequestEnvelopeSchema', () => {
  it('accepts paymentPayload (object) form', () => {
    const result = FacilitatorRequestEnvelopeSchema.safeParse({
      x402Version: 2,
      paymentPayload: samplePaymentPayload,
      paymentRequirements: samplePaymentRequirements,
    });
    expect(result.success).toBe(true);
  });

  it('accepts paymentHeader (base64 string) form', () => {
    const headerBase64 = Buffer.from(JSON.stringify(samplePaymentPayload)).toString('base64');
    const result = FacilitatorRequestEnvelopeSchema.safeParse({
      x402Version: 2,
      paymentHeader: headerBase64,
      paymentRequirements: samplePaymentRequirements,
    });
    expect(result.success).toBe(true);
  });

  it('rejects oversized paymentHeader body fields at the envelope boundary', () => {
    const result = FacilitatorRequestEnvelopeSchema.safeParse({
      x402Version: 2,
      paymentHeader: 'A'.repeat(MAX_PAYMENT_HEADER_LENGTH + 1),
      paymentRequirements: samplePaymentRequirements,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing x402Version', () => {
    const result = FacilitatorRequestEnvelopeSchema.safeParse({
      paymentPayload: samplePaymentPayload,
      paymentRequirements: samplePaymentRequirements,
    });
    expect(result.success).toBe(false);
  });
});

describe('normaliseFacilitatorRequest', () => {
  it('returns the parsed object form unchanged when paymentPayload is supplied', () => {
    const result = normaliseFacilitatorRequest({
      x402Version: 2,
      paymentPayload: samplePaymentPayload,
      paymentRequirements: samplePaymentRequirements,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.paymentPayload.payload.nonce).toBe(`${validHash}#0`);
    }
  });

  it('decodes paymentHeader base64 into a paymentPayload object', () => {
    const headerBase64 = Buffer.from(JSON.stringify(samplePaymentPayload)).toString('base64');
    const result = normaliseFacilitatorRequest({
      x402Version: 2,
      paymentHeader: headerBase64,
      paymentRequirements: samplePaymentRequirements,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.paymentPayload.payload.nonce).toBe(`${validHash}#0`);
    }
  });

  it('returns missing_payload when neither shape is supplied', () => {
    const result = normaliseFacilitatorRequest({
      x402Version: 2,
      paymentRequirements: samplePaymentRequirements,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('missing_payload');
    }
  });

  it('returns invalid_json when paymentHeader does not decode to JSON', () => {
    const garbage = Buffer.from('not-valid-json').toString('base64');
    const result = normaliseFacilitatorRequest({
      x402Version: 2,
      paymentHeader: garbage,
      paymentRequirements: samplePaymentRequirements,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid_json');
    }
  });

  it('returns invalid_base64 when paymentHeader contains invalid base64', () => {
    const result = normaliseFacilitatorRequest({
      x402Version: 2,
      paymentHeader: '!!!not-base64!!!',
      paymentRequirements: samplePaymentRequirements,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid_base64');
    }
  });

  it('returns invalid_base64 when paymentHeader exceeds the strict header limit', () => {
    const result = normaliseFacilitatorRequest({
      x402Version: 2,
      paymentHeader: 'A'.repeat(MAX_PAYMENT_HEADER_LENGTH + 1),
      paymentRequirements: samplePaymentRequirements,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid_base64');
    }
  });

  it('returns invalid_payload when decoded JSON does not match the schema', () => {
    const headerBase64 = Buffer.from(JSON.stringify({ wrong: 'shape' })).toString('base64');
    const result = normaliseFacilitatorRequest({
      x402Version: 2,
      paymentHeader: headerBase64,
      paymentRequirements: samplePaymentRequirements,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid_payload');
    }
  });

  it('prefers paymentPayload over paymentHeader when both are present', () => {
    const headerBase64 = Buffer.from(
      JSON.stringify({
        ...samplePaymentPayload,
        payload: { ...samplePaymentPayload.payload, nonce: `${'b'.repeat(64)}#9` },
      })
    ).toString('base64');
    const result = normaliseFacilitatorRequest({
      x402Version: 2,
      paymentPayload: samplePaymentPayload,
      paymentHeader: headerBase64,
      paymentRequirements: samplePaymentRequirements,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The object form wins.
      expect(result.data.paymentPayload.payload.nonce).toBe(`${validHash}#0`);
    }
  });
});
