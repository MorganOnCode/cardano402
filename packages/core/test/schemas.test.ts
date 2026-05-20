import { describe, expect, it } from 'vitest';

import {
  AssetTransferMethodSchema,
  CardanoAddressSchema,
  LovelaceAmountSchema,
  NetworkSchema,
  PaymentPayloadSchema,
  PaymentRequirementsSchema,
  SchemeSchema,
  SettleResponseSchema,
  SettlementStatusSchema,
  StatusResponseSchema,
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
  it('accepts base-10 digit strings of any length', () => {
    expect(LovelaceAmountSchema.safeParse('0').success).toBe(true);
    expect(LovelaceAmountSchema.safeParse('2000000').success).toBe(true);
    expect(LovelaceAmountSchema.safeParse('18446744073709551615').success).toBe(true);
  });

  it('rejects empty, decimal, negative, scientific, hex', () => {
    expect(LovelaceAmountSchema.safeParse('').success).toBe(false);
    expect(LovelaceAmountSchema.safeParse('2.0').success).toBe(false);
    expect(LovelaceAmountSchema.safeParse('-1').success).toBe(false);
    expect(LovelaceAmountSchema.safeParse('1e6').success).toBe(false);
    expect(LovelaceAmountSchema.safeParse('0x10').success).toBe(false);
  });
});

describe('CardanoAddressSchema', () => {
  it('accepts non-empty string, rejects empty', () => {
    expect(CardanoAddressSchema.safeParse('addr_test1abc').success).toBe(true);
    expect(CardanoAddressSchema.safeParse('').success).toBe(false);
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
