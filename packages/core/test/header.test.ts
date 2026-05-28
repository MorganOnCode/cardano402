import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

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
  MAX_PAYMENT_HEADER_LENGTH,
  decodePaymentHeader,
  decodePaymentRequiredHeader,
  decodePaymentSignatureHeader,
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

const sampleSignaturePayload = {
  x402Version: 2,
  accepted: { ...sampleRequirements, extra: null },
  payload: { transaction: 'tx-bytes' },
  resource: {
    description: 'Test resource',
    mimeType: 'application/json',
    url: 'https://example.test/paid',
  },
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

  it('decodes the client-side payment signature envelope through the strict codec', () => {
    const encoded = Buffer.from(JSON.stringify(sampleSignaturePayload)).toString('base64');
    const decoded = decodePaymentSignatureHeader(encoded);

    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepted.extra).toBeNull();
    expect(decoded.payload.transaction).toBe('tx-bytes');
    expect(decoded.resource.url).toBe('https://example.test/paid');
  });

  it('decodes the Payment-Required response envelope through the strict codec', () => {
    const paymentRequired = {
      x402Version: 2,
      error: null,
      resource: {
        description: 'Test resource',
        mimeType: 'application/json',
        url: 'https://example.test/paid',
      },
      accepts: [{ ...sampleRequirements, extra: null }],
    };
    const encoded = Buffer.from(JSON.stringify(paymentRequired)).toString('base64');
    const decoded = decodePaymentRequiredHeader(encoded);

    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepts[0].payTo).toBe('addr_test1abc');
    expect(decoded.resource.url).toBe('https://example.test/paid');
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
  it('throws Cardano402DecodeError on an empty header value', () => {
    expect(() => decodePaymentHeader('')).toThrow(Cardano402DecodeError);
  });

  it('throws Cardano402DecodeError on invalid base64', () => {
    expect(() => decodePaymentHeader('###')).toThrow(Cardano402DecodeError);
  });

  it('throws Cardano402DecodeError on invalid base64 padding', () => {
    expect(() => decodePaymentHeader('abcd=ef')).toThrow(Cardano402DecodeError);
    expect(() => decodePaymentHeader('AAAA=')).toThrow(Cardano402DecodeError);
  });

  it('throws Cardano402DecodeError on oversized payment headers', () => {
    const oversized = 'A'.repeat(MAX_PAYMENT_HEADER_LENGTH + 1);
    expect(() => decodePaymentHeader(oversized)).toThrow(Cardano402DecodeError);
  });

  it('applies strict base64 checks to Payment-Required headers', () => {
    expect(() => decodePaymentRequiredHeader('!!!not-base64!!!')).toThrow(
      Cardano402DecodeError
    );
    expect(() => decodePaymentRequiredHeader('A'.repeat(MAX_PAYMENT_HEADER_LENGTH + 1))).toThrow(
      Cardano402DecodeError
    );
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

describe('decodePaymentHeader prototype pollution defense', () => {
  it('strips __proto__ from decoded payload at every nesting level', () => {
    // Hand-craft the JSON because object-literal __proto__ would mutate
    // the source object's prototype, not produce an own key in JSON.
    const json =
      '{"x402Version":2,' +
      '"__proto__":{"polluted":"top"},' +
      '"accepted":{"scheme":"exact","network":"cardano:preview","asset":"lovelace","amount":"2000000","payTo":"addr_test1abc","maxTimeoutSeconds":300,' +
      '"__proto__":{"polluted":"accepted"}},' +
      '"payload":{"transaction":"tx-bytes",' +
      '"__proto__":{"polluted":"payload"}}}';
    const b64 = Buffer.from(json, 'utf-8').toString('base64');
    const decoded = decodePaymentHeader(b64);

    expect(decoded.x402Version).toBe(2);
    expect(decoded.payload.transaction).toBe('tx-bytes');

    // The decoded object's prototype chain must be untouched — exactly
    // Object.prototype, no injected layer carrying the attacker's keys.
    // Without the reviver, Zod's passthrough copy uses [[Set]] which
    // routes the JSON.parse-produced own __proto__ key through the
    // prototype mutator, replacing the output's prototype with the
    // attacker-controlled object. `decoded.polluted` would then resolve
    // to 'top' via prototype lookup.
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(decoded.accepted)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(decoded.payload)).toBe(Object.prototype);

    expect((decoded as unknown as { polluted?: string }).polluted).toBeUndefined();
    expect(
      (decoded.accepted as unknown as { polluted?: string }).polluted
    ).toBeUndefined();
    expect(
      (decoded.payload as unknown as { polluted?: string }).polluted
    ).toBeUndefined();

    // Defensive: confirm no global prototype pollution leaked.
    expect(({} as unknown as { polluted?: string }).polluted).toBeUndefined();
  });

  it('strips constructor and prototype keys from decoded payload', () => {
    const json = JSON.stringify({
      x402Version: 2,
      accepted: sampleRequirements,
      payload: { transaction: 'tx-bytes' },
      constructor: { evil: 1 },
      prototype: { evil: 2 },
    });
    const b64 = Buffer.from(json, 'utf-8').toString('base64');
    const decoded = decodePaymentHeader(b64);
    expect((decoded as unknown as { constructor?: unknown }).constructor).toBe(Object);
    expect((decoded as unknown as { prototype?: unknown }).prototype).toBeUndefined();
    // Spot-check that the schema-validated portion is intact.
    expect(decoded.payload.transaction).toBe('tx-bytes');
  });

  it('property-based: any decoded output has no inherited polluted key', () => {
    fc.assert(
      fc.property(fc.json({ maxDepth: 4 }), (j: string) => {
        const b64 = Buffer.from(j, 'utf-8').toString('base64');
        try {
          const decoded = decodePaymentHeader(b64);
          // If decoding succeeded the schema accepted it; verify no
          // attacker-controlled key 'polluted' leaked into Object.prototype.
          expect(({} as unknown as { polluted?: unknown }).polluted).toBeUndefined();
          // And the decoded object itself has no own __proto__ key.
          expect(Object.prototype.hasOwnProperty.call(decoded, '__proto__')).toBe(false);
        } catch (err) {
          // Decode failures are acceptable — we only care about pollution.
          expect(
            err instanceof Cardano402DecodeError ||
              err instanceof Cardano402ValidationError
          ).toBe(true);
        }
      }),
      { numRuns: 200 }
    );
  });
});

describe('encode/decode round-trip (property-based)', () => {
  const arbAddress = fc.stringMatching(/^[\x21-\x7e]{1,80}$/);
  const arbAmount = fc
    .bigInt({ min: 1n, max: 45_000_000_000_000_000n })
    .map((n) => n.toString());
  const arbNetwork = fc.constantFrom('cardano:preview', 'cardano:preprod', 'cardano:mainnet');
  const arbUtxoRef = fc
    .tuple(
      fc.stringMatching(/^[0-9a-f]{64}$/),
      fc.integer({ min: 0, max: 1024 })
    )
    .map(([h, i]) => `${h}#${i}`);

  const arbRequirements = fc.record({
    scheme: fc.constant('exact' as const),
    network: arbNetwork,
    asset: fc.constant('lovelace'),
    amount: arbAmount,
    payTo: arbAddress,
    maxTimeoutSeconds: fc.integer({ min: 1, max: 86_400 }),
  });

  const arbPayload = fc.record({
    x402Version: fc.constant(2 as const),
    accepted: arbRequirements,
    payload: fc.record({
      transaction: fc.string({ minLength: 1, maxLength: 64 }),
      nonce: arbUtxoRef,
      payer: arbAddress,
    }),
  });

  it('decode(encode(p)) deep-equals p for arbitrary valid PaymentPayloads', () => {
    fc.assert(
      fc.property(arbPayload, (p: PaymentPayload) => {
        const encoded = encodePaymentHeader(p);
        const decoded = decodePaymentHeader(encoded);
        // Compare structurally; both sides should be identical.
        expect(decoded).toEqual(p);
      }),
      { numRuns: 100 }
    );
  });

  it('round-trips Unicode in resource fields byte-identically', () => {
    const p: PaymentPayload = {
      x402Version: 2,
      resource: {
        url: 'https://example.com/日本語',
        description: '日本語 ✓ 𝕏 emoji 🎉',
        mimeType: 'application/json',
      },
      accepted: sampleRequirements,
      payload: { transaction: 'tx-bytes' },
    };
    const decoded = decodePaymentHeader(encodePaymentHeader(p));
    expect(decoded.resource?.url).toBe(p.resource!.url);
    expect(decoded.resource?.description).toBe(p.resource!.description);
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
