import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  AssetIdentifierSchema,
  AssetTransferMethodSchema,
  CardanoAddressSchema,
  LovelaceAmountSchema,
  NetworkSchema,
  PaymentAcceptSchema,
  PaymentPayloadSchema,
  PaymentRequiredResponseSchema,
  PaymentRequirementsSchema,
  PaymentSignaturePayloadSchema,
  ResourceInfoSchema,
  SchemeSchema,
  SettleResponseSchema,
  SettlementStatusSchema,
  StatusResponseSchema,
  StatusRequestSchema,
  SupportedResponseSchema,
  UtxoRefSchema,
  VerifyErrorReasonSchema,
  VerifyResponseSchema,
  X402VersionSchema,
} from '../src/schemas.js';

const sampleRequirements = {
  scheme: 'exact' as const,
  network: 'cardano:preview',
  asset: 'lovelace',
  amount: '2000000',
  payTo: 'addr_test1abc',
  maxTimeoutSeconds: 300,
};

const sampleTxHash = 'a'.repeat(64);

describe('NetworkSchema', () => {
  it('accepts CAIP-2 colon-form ids', () => {
    expect(NetworkSchema.safeParse('cardano:preview').success).toBe(true);
    expect(NetworkSchema.safeParse('cardano:preprod').success).toBe(true);
    expect(NetworkSchema.safeParse('cardano:mainnet').success).toBe(true);
    expect(NetworkSchema.safeParse('eip155:1').success).toBe(true);
  });

  it('rejects hyphen form, missing parts, uppercase, empty', () => {
    expect(NetworkSchema.safeParse('cardano-mainnet').success).toBe(false);
    expect(NetworkSchema.safeParse('cardano:').success).toBe(false);
    expect(NetworkSchema.safeParse('CARDANO:preview').success).toBe(false);
    expect(NetworkSchema.safeParse('').success).toBe(false);
  });
});

describe('X402VersionSchema', () => {
  it('accepts 2 and rejects anything else', () => {
    expect(X402VersionSchema.safeParse(2).success).toBe(true);
    expect(X402VersionSchema.safeParse(1).success).toBe(false);
    expect(X402VersionSchema.safeParse('2').success).toBe(false);
    expect(X402VersionSchema.safeParse(null).success).toBe(false);
  });
});

describe('SchemeSchema', () => {
  it('accepts "exact" and nothing else', () => {
    expect(SchemeSchema.safeParse('exact').success).toBe(true);
    expect(SchemeSchema.safeParse('sub').success).toBe(false);
    expect(SchemeSchema.safeParse('').success).toBe(false);
  });
});

describe('LovelaceAmountSchema', () => {
  it('accepts base-10 digit strings up to uint64 max', () => {
    expect(LovelaceAmountSchema.safeParse('0').success).toBe(true);
    expect(LovelaceAmountSchema.safeParse('2000000').success).toBe(true);
    expect(LovelaceAmountSchema.safeParse('18446744073709551615').success).toBe(true);
  });

  it('rejects empty, decimal, negative, scientific, hex, and over-uint64 values', () => {
    expect(LovelaceAmountSchema.safeParse('').success).toBe(false);
    expect(LovelaceAmountSchema.safeParse('2.0').success).toBe(false);
    expect(LovelaceAmountSchema.safeParse('-1').success).toBe(false);
    expect(LovelaceAmountSchema.safeParse('1e6').success).toBe(false);
    expect(LovelaceAmountSchema.safeParse('0x10').success).toBe(false);
    expect(LovelaceAmountSchema.safeParse('18446744073709551616').success).toBe(false);
    expect(LovelaceAmountSchema.safeParse('1'.repeat(256)).success).toBe(false);
  });
});

describe('CardanoAddressSchema', () => {
  it('accepts non-empty string, rejects empty', () => {
    expect(CardanoAddressSchema.safeParse('addr_test1abc').success).toBe(true);
    expect(CardanoAddressSchema.safeParse('').success).toBe(false);
  });

  it('rejects CRLF, NUL, TAB, DEL and other control characters', () => {
    expect(CardanoAddressSchema.safeParse('addr_test1abc\r\n').success).toBe(false);
    expect(CardanoAddressSchema.safeParse('addr_test1abc\n').success).toBe(false);
    expect(CardanoAddressSchema.safeParse('addr_test1abc\x00').success).toBe(false);
    expect(CardanoAddressSchema.safeParse('addr_test1abc\t').success).toBe(false);
    expect(CardanoAddressSchema.safeParse('addr_test1abc\x7f').success).toBe(false);
    expect(CardanoAddressSchema.safeParse('addr_test1abc\x1f').success).toBe(false);
  });

  it('rejects strings containing spaces', () => {
    expect(CardanoAddressSchema.safeParse('addr test1abc').success).toBe(false);
    expect(CardanoAddressSchema.safeParse(' addr_test1abc').success).toBe(false);
    expect(CardanoAddressSchema.safeParse('addr_test1abc ').success).toBe(false);
  });

  it('rejects strings longer than 200 chars; accepts exactly 200', () => {
    expect(CardanoAddressSchema.safeParse('a'.repeat(201)).success).toBe(false);
    expect(CardanoAddressSchema.safeParse('a'.repeat(200)).success).toBe(true);
  });

  it('accepts realistic Cardano addresses', () => {
    // 103-char mainnet base address (bech32, lowercase a-z + 0-9).
    expect(
      CardanoAddressSchema.safeParse(
        'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj0vs2qd4a6v2yvd5pgvm6xqg'
      ).success
    ).toBe(true);
    // 108-char preview test address.
    expect(
      CardanoAddressSchema.safeParse(
        'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj0vs2qd4a6v2yvd5pgvm6xqg'
      ).success
    ).toBe(true);
    // Short synthetic addresses used across the test suite still pass.
    expect(CardanoAddressSchema.safeParse('addr_test1xxx').success).toBe(true);
  });

  it('property-based: Zod result agrees with /^[\\x21-\\x7e]{1,200}$/', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 200 }), (s: string) => {
        const zodOk = CardanoAddressSchema.safeParse(s).success;
        const regexOk = /^[\x21-\x7e]{1,200}$/.test(s);
        expect(zodOk).toBe(regexOk);
      }),
      { numRuns: 500 }
    );
  });
});

describe('AssetIdentifierSchema', () => {
  const policy = 'a'.repeat(56);

  it('accepts lovelace and lowercase policyId.assetNameHex native assets', () => {
    expect(AssetIdentifierSchema.safeParse('lovelace').success).toBe(true);
    expect(AssetIdentifierSchema.safeParse(`${policy}.00`).success).toBe(true);
    expect(AssetIdentifierSchema.safeParse(`${policy}.0014df105553444d`).success).toBe(true);
    expect(AssetIdentifierSchema.safeParse(`${policy}.${'b'.repeat(64)}`).success).toBe(true);
  });

  it('rejects malformed, uppercase, concatenated, empty, and odd-length asset names', () => {
    expect(AssetIdentifierSchema.safeParse('LOVELACE').success).toBe(false);
    expect(AssetIdentifierSchema.safeParse('').success).toBe(false);
    expect(AssetIdentifierSchema.safeParse(policy).success).toBe(false);
    expect(AssetIdentifierSchema.safeParse(`${policy}.`).success).toBe(false);
    expect(AssetIdentifierSchema.safeParse(`${policy}.0`).success).toBe(false);
    expect(AssetIdentifierSchema.safeParse(`${policy}.zz`).success).toBe(false);
    expect(AssetIdentifierSchema.safeParse(`${'a'.repeat(55)}.00`).success).toBe(false);
    expect(AssetIdentifierSchema.safeParse(`${policy}.${'b'.repeat(66)}`).success).toBe(false);
  });
});

describe('UtxoRefSchema', () => {
  it('accepts canonical txHash#index', () => {
    expect(UtxoRefSchema.safeParse(`${sampleTxHash}#0`).success).toBe(true);
    expect(UtxoRefSchema.safeParse(`${sampleTxHash}#42`).success).toBe(true);
  });

  it('rejects bad length, case, missing index, non-numeric index', () => {
    expect(UtxoRefSchema.safeParse(`${'a'.repeat(63)}#0`).success).toBe(false);
    expect(UtxoRefSchema.safeParse(`${'A'.repeat(64)}#0`).success).toBe(false);
    expect(UtxoRefSchema.safeParse(`${sampleTxHash}#`).success).toBe(false);
    expect(UtxoRefSchema.safeParse(`${sampleTxHash}#abc`).success).toBe(false);
  });
});

describe('AssetTransferMethodSchema', () => {
  it('accepts default / script', () => {
    expect(AssetTransferMethodSchema.safeParse('default').success).toBe(true);
    expect(AssetTransferMethodSchema.safeParse('script').success).toBe(true);
    expect(AssetTransferMethodSchema.safeParse('other').success).toBe(false);
  });
});

describe('SettlementStatusSchema', () => {
  it('accepts confirmed / mempool / failed (widened)', () => {
    expect(SettlementStatusSchema.safeParse('confirmed').success).toBe(true);
    expect(SettlementStatusSchema.safeParse('mempool').success).toBe(true);
    expect(SettlementStatusSchema.safeParse('failed').success).toBe(true);
    expect(SettlementStatusSchema.safeParse('pending').success).toBe(false);
  });
});

describe('VerifyErrorReasonSchema', () => {
  it('accepts non-empty strings, rejects empty', () => {
    expect(VerifyErrorReasonSchema.safeParse('amount_insufficient').success).toBe(true);
    expect(VerifyErrorReasonSchema.safeParse('').success).toBe(false);
  });
});

describe('PaymentRequirementsSchema', () => {
  it('round-trips a representative object and keeps unknown keys via passthrough', () => {
    const input = { ...sampleRequirements, customExtra: 'visible' };
    const parsed = PaymentRequirementsSchema.parse(input);
    expect(parsed.amount).toBe('2000000');
    expect((parsed as Record<string, unknown>).customExtra).toBe('visible');
  });

  it('rejects bad network and missing payTo', () => {
    expect(
      PaymentRequirementsSchema.safeParse({ ...sampleRequirements, network: 'cardano-mainnet' })
        .success
    ).toBe(false);
    const { payTo: _omit, ...withoutPayTo } = sampleRequirements;
    expect(PaymentRequirementsSchema.safeParse(withoutPayTo).success).toBe(false);
  });

  it('rejects malformed asset identifiers', () => {
    expect(PaymentRequirementsSchema.safeParse({ ...sampleRequirements, asset: '' }).success).toBe(
      false
    );
    expect(
      PaymentRequirementsSchema.safeParse({ ...sampleRequirements, asset: 'policyId.assetName' })
        .success
    ).toBe(false);
  });
});

describe('PaymentPayloadSchema', () => {
  const basePayload = {
    x402Version: 2,
    accepted: sampleRequirements,
    payload: { transaction: 'tx-bytes' },
  };

  it('parses with and without optional resource / extensions', () => {
    expect(PaymentPayloadSchema.safeParse(basePayload).success).toBe(true);
    expect(
      PaymentPayloadSchema.safeParse({
        ...basePayload,
        resource: { url: 'https://example.com/r' },
        extensions: { foo: 'bar' },
      }).success
    ).toBe(true);
  });

  it('rejects x402Version !== 2', () => {
    expect(
      PaymentPayloadSchema.safeParse({ ...basePayload, x402Version: 1 }).success
    ).toBe(false);
  });
});

describe('VerifyResponseSchema', () => {
  it('parses both success and failure branches', () => {
    expect(VerifyResponseSchema.safeParse({ isValid: true }).success).toBe(true);
    expect(
      VerifyResponseSchema.safeParse({
        isValid: false,
        invalidReason: 'amount_insufficient',
        invalidMessage: 'too small',
      }).success
    ).toBe(true);
  });
});

describe('SettleResponseSchema', () => {
  it('parses extensions.status for all enum values', () => {
    for (const status of ['confirmed', 'mempool', 'failed'] as const) {
      const parsed = SettleResponseSchema.safeParse({
        success: status !== 'failed',
        transaction: status === 'failed' ? '' : 'txhash',
        network: 'cardano:preview',
        extensions: { status },
      });
      expect(parsed.success).toBe(true);
    }
  });

  it('rejects unknown extensions.status', () => {
    expect(
      SettleResponseSchema.safeParse({
        success: true,
        transaction: 'tx',
        network: 'cardano:preview',
        extensions: { status: 'pending' },
      }).success
    ).toBe(false);
  });
});

describe('StatusResponseSchema', () => {
  it('parses confirmed / pending / not_found and rejects unknown', () => {
    for (const status of ['confirmed', 'pending', 'not_found']) {
      expect(StatusResponseSchema.safeParse({ status, transaction: 'tx' }).success).toBe(true);
    }
    expect(StatusResponseSchema.safeParse({ status: 'failed', transaction: 'tx' }).success).toBe(
      false
    );
  });
});

describe('StatusRequestSchema', () => {
  it('accepts lowercase hex transaction hashes only', () => {
    expect(
      StatusRequestSchema.safeParse({
        transaction: sampleTxHash,
        paymentRequirements: sampleRequirements,
      }).success
    ).toBe(true);
    expect(
      StatusRequestSchema.safeParse({
        transaction: 'g'.repeat(64),
        paymentRequirements: sampleRequirements,
      }).success
    ).toBe(false);
    expect(
      StatusRequestSchema.safeParse({
        transaction: 'A'.repeat(64),
        paymentRequirements: sampleRequirements,
      }).success
    ).toBe(false);
  });
});

describe('SupportedResponseSchema', () => {
  it('parses an example with one kind and empty extensions', () => {
    const parsed = SupportedResponseSchema.safeParse({
      kinds: [
        {
          x402Version: 2,
          scheme: 'exact',
          network: 'cardano:preview',
        },
      ],
      extensions: [],
      signers: { 'cardano:preview': ['addr_test1xxx'] },
    });
    expect(parsed.success).toBe(true);
  });
});

// --- 402 envelope (client-side schemas; new in v0.2.0) ---

const sampleAccept = {
  network: 'cardano:preview',
  amount: '1000000',
  payTo: 'addr_test1abc',
};

const sampleResource = {
  description: 'weather forecast',
  url: 'https://api.example.com/weather',
};

describe('PaymentAcceptSchema', () => {
  it('applies defaults for scheme / maxTimeoutSeconds / asset / extra', () => {
    const parsed = PaymentAcceptSchema.parse(sampleAccept);
    expect(parsed.scheme).toBe('exact');
    expect(parsed.maxTimeoutSeconds).toBe(300);
    expect(parsed.asset).toBe('lovelace');
    expect(parsed.extra).toBeNull();
  });

  it('rejects missing required fields (network / amount / payTo)', () => {
    const { network: _net, ...withoutNetwork } = sampleAccept;
    const { amount: _amt, ...withoutAmount } = sampleAccept;
    const { payTo: _pay, ...withoutPayTo } = sampleAccept;
    expect(PaymentAcceptSchema.safeParse(withoutNetwork).success).toBe(false);
    expect(PaymentAcceptSchema.safeParse(withoutAmount).success).toBe(false);
    expect(PaymentAcceptSchema.safeParse(withoutPayTo).success).toBe(false);
  });

  it('rejects malformed asset identifiers', () => {
    expect(PaymentAcceptSchema.safeParse({ ...sampleAccept, asset: '' }).success).toBe(false);
    expect(PaymentAcceptSchema.safeParse({ ...sampleAccept, asset: 'bad.asset' }).success).toBe(
      false
    );
  });
});

describe('ResourceInfoSchema', () => {
  it('defaults mimeType to application/json', () => {
    const parsed = ResourceInfoSchema.parse(sampleResource);
    expect(parsed.mimeType).toBe('application/json');
  });

  it('rejects missing description or url', () => {
    expect(ResourceInfoSchema.safeParse({ url: 'https://x' }).success).toBe(false);
    expect(ResourceInfoSchema.safeParse({ description: 'd' }).success).toBe(false);
  });
});

describe('PaymentRequiredResponseSchema', () => {
  const baseEnvelope = {
    x402Version: 2 as const,
    error: null,
    resource: sampleResource,
    accepts: [sampleAccept],
  };

  it('parses a minimal valid envelope', () => {
    expect(PaymentRequiredResponseSchema.safeParse(baseEnvelope).success).toBe(true);
  });

  it('rejects x402Version other than 2', () => {
    expect(
      PaymentRequiredResponseSchema.safeParse({ ...baseEnvelope, x402Version: 1 }).success
    ).toBe(false);
  });

  it('round-trips through JSON.stringify -> JSON.parse', () => {
    const parsed = PaymentRequiredResponseSchema.parse(baseEnvelope);
    const json = JSON.stringify(parsed);
    const restored = PaymentRequiredResponseSchema.parse(JSON.parse(json));
    expect(restored).toEqual(parsed);
  });

  it('property-based: any well-formed envelope round-trips encode/decode', () => {
    const acceptArb = fc.record({
      network: fc.constantFrom('cardano:preview', 'cardano:preprod', 'cardano:mainnet'),
      amount: fc
        .bigInt({ min: 1n, max: 45_000_000_000_000_000n })
        .map((n: bigint) => n.toString()),
      payTo: fc
        .string({ minLength: 10, maxLength: 100 })
        .filter((s: string) => /^[\x21-\x7e]+$/.test(s) && s.length > 0)
        .map((s: string) => `addr_test1${s.slice(0, 90)}`),
      maxTimeoutSeconds: fc.integer({ min: 1, max: 3600 }),
      asset: fc.constantFrom('lovelace'),
      extra: fc.constant(null),
      scheme: fc.constant('exact'),
    });
    fc.assert(
      fc.property(
        fc.record({
          x402Version: fc.constant(2 as const),
          error: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 50 })),
          resource: fc.record({
            description: fc.string({ minLength: 1, maxLength: 100 }),
            mimeType: fc.constantFrom('application/json', 'text/plain'),
            url: fc.webUrl(),
          }),
          accepts: fc.array(acceptArb, { minLength: 1, maxLength: 4 }),
        }),
        (env) => {
          const parsed = PaymentRequiredResponseSchema.parse(env);
          const restored = PaymentRequiredResponseSchema.parse(
            JSON.parse(JSON.stringify(parsed))
          );
          expect(restored).toEqual(parsed);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('PaymentSignaturePayloadSchema', () => {
  const basePayload = {
    x402Version: 2 as const,
    accepted: sampleAccept,
    payload: { transaction: 'tx-bytes-hex' },
    resource: sampleResource,
  };

  it('parses a minimal valid payload', () => {
    expect(PaymentSignaturePayloadSchema.safeParse(basePayload).success).toBe(true);
  });

  it('rejects missing accepted / payload / resource', () => {
    const { accepted: _a, ...withoutAccepted } = basePayload;
    const { payload: _p, ...withoutPayload } = basePayload;
    const { resource: _r, ...withoutResource } = basePayload;
    expect(PaymentSignaturePayloadSchema.safeParse(withoutAccepted).success).toBe(false);
    expect(PaymentSignaturePayloadSchema.safeParse(withoutPayload).success).toBe(false);
    expect(PaymentSignaturePayloadSchema.safeParse(withoutResource).success).toBe(false);
  });
});
