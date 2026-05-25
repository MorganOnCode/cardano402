// Unit tests for all eight verification check functions
//
// Each check is tested independently using mock DeserializedTx objects
// on ctx._parsedTx, isolating check logic from CML.

import { describe, expect, it, vi } from 'vitest';

import type { DeserializedTx } from '../../../src/verify/cbor.js';
import {
  checkAmount,
  checkCborValid,
  checkFee,
  checkMinUtxo,
  checkNetwork,
  checkNonce,
  checkRecipient,
  checkScheme,
  checkTokenSupported,
  checkTtl,
  checkWitnessPresent,
  VERIFICATION_CHECKS,
} from '../../../src/verify/checks.js';
import type { VerifyContext } from '../../../src/verify/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal VerifyContext with sensible defaults. */
function makeCtx(overrides: Partial<VerifyContext> = {}): VerifyContext {
  return {
    scheme: 'exact',
    network: 'cardano:preview',
    payTo:
      'addr_test1qz424242424242424242424242424242424242424242424mhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwasmdp8x6',
    requiredAmount: 2_000_000n,
    maxTimeoutSeconds: 300,
    transactionCbor: 'dummybase64',
    requestedAt: Date.now(),
    getCurrentSlot: vi.fn().mockResolvedValue(1000),
    configuredNetwork: 'cardano:preview',
    feeMin: 150_000n,
    feeMax: 5_000_000n,
    ...overrides,
  };
}

/** Create a minimal mock DeserializedTx. */
function makeParsedTx(overrides: Partial<DeserializedTx> = {}): DeserializedTx {
  return {
    cborHex: 'deadbeef',
    body: {
      inputs: [{ txHash: 'a'.repeat(64), index: 0n }],
      outputs: [
        {
          addressHex: '00' + 'aa'.repeat(28) + 'bb'.repeat(28),
          addressBech32:
            'addr_test1qz424242424242424242424242424242424242424242424mhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwasmdp8x6',
          lovelace: 2_000_000n,
          assets: {},
          networkId: 0,
        },
      ],
      fee: 200_000n,
      ttl: undefined,
      networkId: 0,
    },
    hasWitnesses: true,
    txHash: 'a'.repeat(64),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// checkCborValid
// ---------------------------------------------------------------------------

describe('checkCborValid', () => {
  it('passes on valid CBOR transaction and sets ctx._parsedTx', async () => {
    // Use a real base64 CBOR fixture built from CML in the cbor.test.ts helpers
    // For unit tests, we test via the actual deserialize path
    const { CML } = await import('@lucid-evolution/lucid');
    const keyHash = CML.Ed25519KeyHash.from_hex('a'.repeat(56));
    const stakeKeyHash = CML.Ed25519KeyHash.from_hex('b'.repeat(56));
    const addr = CML.BaseAddress.new(
      0,
      CML.Credential.new_pub_key(keyHash),
      CML.Credential.new_pub_key(stakeKeyHash)
    ).to_address();

    const inputList = CML.TransactionInputList.new();
    inputList.add(CML.TransactionInput.new(CML.TransactionHash.from_hex('a'.repeat(64)), 0n));
    const outputList = CML.TransactionOutputList.new();
    outputList.add(CML.TransactionOutput.new(addr, CML.Value.from_coin(2_000_000n)));
    const txBody = CML.TransactionBody.new(inputList, outputList, 200_000n);
    const ws = CML.TransactionWitnessSet.new();
    const tx = CML.Transaction.new(txBody, ws, true);
    const base64 = Buffer.from(tx.to_cbor_hex(), 'hex').toString('base64');
    tx.free();

    const ctx = makeCtx({ transactionCbor: base64 });
    const result = checkCborValid(ctx);

    expect(result.check).toBe('cbor_valid');
    expect(result.passed).toBe(true);
    expect(ctx._parsedTx).toBeDefined();
    expect(ctx._parsedTx!.body.fee).toBe(200_000n);
  });

  it('fails with invalid_base64 on bad base64', () => {
    const ctx = makeCtx({ transactionCbor: 'not-valid-base64!!!' });
    const result = checkCborValid(ctx);

    expect(result.check).toBe('cbor_valid');
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('invalid_base64');
  });

  it('fails with invalid_cbor on garbage hex', () => {
    // Valid base64 but not valid CBOR
    const ctx = makeCtx({
      transactionCbor: Buffer.from('deadbeef', 'hex').toString('base64'),
    });
    const result = checkCborValid(ctx);

    expect(result.check).toBe('cbor_valid');
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('invalid_cbor');
    expect(result.details).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------
// checkScheme
// ---------------------------------------------------------------------------

describe('checkScheme', () => {
  it('passes when scheme is exact', () => {
    const ctx = makeCtx({ scheme: 'exact' });
    const result = checkScheme(ctx);
    expect(result.check).toBe('scheme');
    expect(result.passed).toBe(true);
  });

  it('fails on unsupported scheme', () => {
    const ctx = makeCtx({ scheme: 'threshold' });
    const result = checkScheme(ctx);
    expect(result.check).toBe('scheme');
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('unsupported_scheme');
    expect(result.details).toEqual({ scheme: 'threshold' });
  });
});

// ---------------------------------------------------------------------------
// checkNetwork
// ---------------------------------------------------------------------------

describe('checkNetwork', () => {
  it('passes when networks match (testnet)', () => {
    const ctx = makeCtx({
      network: 'cardano:preview',
      configuredNetwork: 'cardano:preview',
    });
    ctx._parsedTx = makeParsedTx({ body: { ...makeParsedTx().body, networkId: 0 } });
    const result = checkNetwork(ctx);
    expect(result.check).toBe('network');
    expect(result.passed).toBe(true);
  });

  it('fails when CAIP-2 networks mismatch', () => {
    const ctx = makeCtx({
      network: 'cardano:mainnet',
      configuredNetwork: 'cardano:preview',
    });
    ctx._parsedTx = makeParsedTx();
    const result = checkNetwork(ctx);
    expect(result.check).toBe('network');
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('network_mismatch');
  });

  it('fails when tx output addresses have wrong network ID', () => {
    const ctx = makeCtx({
      network: 'cardano:mainnet',
      configuredNetwork: 'cardano:mainnet',
    });
    // Tx has testnet addresses (networkId 0) but configured for mainnet
    ctx._parsedTx = makeParsedTx({ body: { ...makeParsedTx().body, networkId: 0 } });
    const result = checkNetwork(ctx);
    expect(result.check).toBe('network');
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('network_mismatch');
  });

  it('returns cbor_required when _parsedTx is missing', () => {
    const ctx = makeCtx();
    // ctx._parsedTx is undefined
    const result = checkNetwork(ctx);
    expect(result.check).toBe('network');
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('cbor_required');
  });
});

// ---------------------------------------------------------------------------
// checkTokenSupported
// ---------------------------------------------------------------------------

describe('checkTokenSupported', () => {
  const MOCK_POLICY_ID = 'aa'.repeat(28); // 56-char hex
  const MOCK_ASSET_NAME = 'bbccdd';
  const MOCK_ASSET_DOT = MOCK_POLICY_ID + '.' + MOCK_ASSET_NAME; // API format

  // Real token dot-separated API formats (for integration-style registry tests)
  const USDM_DOT = 'c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad.0014df105553444d';
  const DJED_DOT =
    '8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd61.446a65644d6963726f555344';
  const IUSD_DOT = 'f66d78b4a3cb3d37afa0ec36461e51ecbde00f26c8f0a68f94b69880.69555344';

  it('passes for ADA payment (lovelace)', () => {
    const ctx = makeCtx({ asset: 'lovelace' });
    const result = checkTokenSupported(ctx);
    expect(result.check).toBe('token_supported');
    expect(result.passed).toBe(true);
  });

  it('passes for USDM (real registry entry)', () => {
    const ctx = makeCtx({ asset: USDM_DOT });
    const result = checkTokenSupported(ctx);
    expect(result.check).toBe('token_supported');
    expect(result.passed).toBe(true);
  });

  it('passes for DJED (real registry entry)', () => {
    const ctx = makeCtx({ asset: DJED_DOT });
    const result = checkTokenSupported(ctx);
    expect(result.check).toBe('token_supported');
    expect(result.passed).toBe(true);
  });

  it('passes for iUSD (real registry entry)', () => {
    const ctx = makeCtx({ asset: IUSD_DOT });
    const result = checkTokenSupported(ctx);
    expect(result.check).toBe('token_supported');
    expect(result.passed).toBe(true);
  });

  it('fails with unsupported_token for unknown token', () => {
    const ctx = makeCtx({ asset: MOCK_ASSET_DOT });
    const result = checkTokenSupported(ctx);
    expect(result.check).toBe('token_supported');
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('unsupported_token');
  });

  it('includes asset identifier in failure details', () => {
    const ctx = makeCtx({ asset: MOCK_ASSET_DOT });
    const result = checkTokenSupported(ctx);
    expect(result.passed).toBe(false);
    expect(result.details).toEqual({ asset: MOCK_ASSET_DOT });
  });

  it('check name is token_supported in all results', () => {
    const passCtx = makeCtx({ asset: 'lovelace' });
    const failCtx = makeCtx({ asset: MOCK_ASSET_DOT });
    expect(checkTokenSupported(passCtx).check).toBe('token_supported');
    expect(checkTokenSupported(failCtx).check).toBe('token_supported');
  });
});

// ---------------------------------------------------------------------------
// checkRecipient
// ---------------------------------------------------------------------------

describe('checkRecipient', () => {
  it('passes when matching output found', () => {
    const ctx = makeCtx({
      payTo:
        'addr_test1qz424242424242424242424242424242424242424242424mhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwasmdp8x6',
    });
    ctx._parsedTx = makeParsedTx();
    const result = checkRecipient(ctx);
    expect(result.check).toBe('recipient');
    expect(result.passed).toBe(true);
    expect(ctx._matchingOutputIndex).toBe(0);
    expect(ctx._matchingOutputAmount).toBe(2_000_000n);
  });

  it('fails when no matching output found', () => {
    const ctx = makeCtx({
      payTo:
        'addr_test1qrxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxven9mhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwasm2jhls',
    });
    ctx._parsedTx = makeParsedTx();
    const result = checkRecipient(ctx);
    expect(result.check).toBe('recipient');
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('recipient_mismatch');
  });

  it('finds matching output in multi-output transaction', () => {
    const ctx = makeCtx({
      payTo:
        'addr_test1qrxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxven9mhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwasm2jhls',
    });
    ctx._parsedTx = makeParsedTx({
      body: {
        ...makeParsedTx().body,
        outputs: [
          {
            // First output does NOT match
            addressHex: '00' + 'aa'.repeat(28) + 'bb'.repeat(28),
            addressBech32:
              'addr_test1qz424242424242424242424242424242424242424242424mhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwasmdp8x6',
            lovelace: 1_000_000n,
            assets: {},
            networkId: 0,
          },
          {
            // Second output DOES match
            addressHex: '00' + 'cc'.repeat(28) + 'bb'.repeat(28),
            addressBech32:
              'addr_test1qrxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxven9mhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwasm2jhls',
            lovelace: 3_000_000n,
            assets: {},
            networkId: 0,
          },
        ],
      },
    });
    const result = checkRecipient(ctx);
    expect(result.passed).toBe(true);
    expect(ctx._matchingOutputIndex).toBe(1);
    expect(ctx._matchingOutputAmount).toBe(3_000_000n);
  });

  it('returns cbor_required when _parsedTx is missing', () => {
    const ctx = makeCtx();
    const result = checkRecipient(ctx);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('cbor_required');
  });

  // ---- H1: multi-output payTo aggregation / selection ----

  it('sums lovelace across ALL outputs to payTo for the ADA branch', () => {
    // Two outputs to the recipient; total = 5_000_000 lovelace.
    const ctx = makeCtx({
      payTo:
        'addr_test1qrxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxven9mhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwasm2jhls',
      requiredAmount: 5_000_000n,
      asset: 'lovelace',
    });
    ctx._parsedTx = makeParsedTx({
      body: {
        ...makeParsedTx().body,
        outputs: [
          {
            addressHex: '00' + 'cc'.repeat(28) + 'bb'.repeat(28),
            addressBech32:
              'addr_test1qrxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxven9mhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwasm2jhls',
            lovelace: 2_000_000n,
            assets: {},
            networkId: 0,
          },
          {
            // Decoy: change-output back to a third party
            addressHex: '00' + 'aa'.repeat(28) + 'bb'.repeat(28),
            addressBech32: 'addr_test1qz...',
            lovelace: 50_000_000n,
            assets: {},
            networkId: 0,
          },
          {
            // Second output to payTo — only counted if we aggregate
            addressHex: '00' + 'cc'.repeat(28) + 'bb'.repeat(28),
            addressBech32:
              'addr_test1qrxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxven9mhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwasm2jhls',
            lovelace: 3_000_000n,
            assets: {},
            networkId: 0,
          },
        ],
      },
    });
    const result = checkRecipient(ctx);
    expect(result.passed).toBe(true);
    // _matchingOutputIndex points at the FIRST matching output for downstream
    // checks (min-utxo etc.); _matchingOutputAmount is the SUM across matches.
    expect(ctx._matchingOutputIndex).toBe(0);
    expect(ctx._matchingOutputAmount).toBe(5_000_000n);
  });

  it('neutralizes the spam-token output attack on the ADA branch', () => {
    // Audit H1 attack scenario: first output to payTo carries `requiredAmount`
    // lovelace + a spam NFT. Pre-fix the verifier credited only that single
    // output; recipient ended up with the dust amount and the unwanted token.
    // Post-fix the verifier sums across outputs.
    const ctx = makeCtx({
      payTo:
        'addr_test1qrxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxven9mhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwasm2jhls',
      requiredAmount: 5_000_000n,
      asset: 'lovelace',
    });
    ctx._parsedTx = makeParsedTx({
      body: {
        ...makeParsedTx().body,
        outputs: [
          {
            // Spam-decoy output: looks like it meets the threshold solo,
            // but carries an unwanted NFT.
            addressHex: '00' + 'cc'.repeat(28) + 'bb'.repeat(28),
            addressBech32:
              'addr_test1qrxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxven9mhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwasm2jhls',
            lovelace: 5_000_000n,
            assets: { ['ff'.repeat(28) + '4e4654']: 1n }, // 1 unit of a junk NFT
            networkId: 0,
          },
          {
            // Real intended payment routed elsewhere
            addressHex: '00' + 'aa'.repeat(28) + 'bb'.repeat(28),
            addressBech32: 'addr_test1qz...',
            lovelace: 10_000_000n,
            assets: {},
            networkId: 0,
          },
        ],
      },
    });
    const result = checkRecipient(ctx);
    // Passes recipient (there IS an output to payTo), but downstream
    // checkMinUtxo will be checked against the matched (spam) output. The
    // amount check uses the sum (only 5_000_000 in this attack — still
    // exactly the threshold), so this single-output attack alone doesn't
    // sneak through; it's the multi-payTo-output split case that does.
    expect(result.passed).toBe(true);
    expect(ctx._matchingOutputAmount).toBe(5_000_000n);
  });

  it('enumerates outputs to payTo for the TOKEN branch, picking one with enough asset', () => {
    const MOCK_UNIT = 'cc'.repeat(28) + 'ddee';
    const ctx = makeCtx({
      payTo:
        'addr_test1qrxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxven9mhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwasm2jhls',
      requiredAmount: 5_000_000n,
      asset: 'cc'.repeat(28) + '.ddee',
    });
    ctx._parsedTx = makeParsedTx({
      body: {
        ...makeParsedTx().body,
        outputs: [
          {
            // First output to payTo carries 0 tokens (the spam-decoy case
            // from the audit) — pre-fix this would lock onto index 0 and
            // checkAmount would fail.
            addressHex: '00' + 'cc'.repeat(28) + 'bb'.repeat(28),
            addressBech32:
              'addr_test1qrxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxven9mhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwasm2jhls',
            lovelace: 1_500_000n,
            assets: {},
            networkId: 0,
          },
          {
            // Second output to payTo has the real token payment
            addressHex: '00' + 'cc'.repeat(28) + 'bb'.repeat(28),
            addressBech32:
              'addr_test1qrxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxven9mhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwasm2jhls',
            lovelace: 2_000_000n,
            assets: { [MOCK_UNIT]: 6_000_000n },
            networkId: 0,
          },
        ],
      },
    });
    const result = checkRecipient(ctx);
    expect(result.passed).toBe(true);
    expect(ctx._matchingOutputIndex).toBe(1);
  });

  it('falls back to first matching output (TOKEN) when no output to payTo has enough asset', () => {
    const MOCK_UNIT = 'cc'.repeat(28) + 'ddee';
    const ctx = makeCtx({
      payTo:
        'addr_test1qrxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxven9mhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwasm2jhls',
      requiredAmount: 5_000_000n,
      asset: 'cc'.repeat(28) + '.ddee',
    });
    ctx._parsedTx = makeParsedTx({
      body: {
        ...makeParsedTx().body,
        outputs: [
          {
            addressHex: '00' + 'cc'.repeat(28) + 'bb'.repeat(28),
            addressBech32:
              'addr_test1qrxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxven9mhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwasm2jhls',
            lovelace: 2_000_000n,
            assets: { [MOCK_UNIT]: 1_000_000n }, // not enough
            networkId: 0,
          },
        ],
      },
    });
    const result = checkRecipient(ctx);
    // Recipient was matched; the downstream checkAmount call will fail with
    // amount_insufficient because the matched output's asset map is short.
    expect(result.passed).toBe(true);
    expect(ctx._matchingOutputIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// checkAmount
// ---------------------------------------------------------------------------

describe('checkAmount', () => {
  it('passes when exact amount matches', () => {
    const ctx = makeCtx({ requiredAmount: 2_000_000n });
    ctx._parsedTx = makeParsedTx();
    ctx._matchingOutputIndex = 0;
    ctx._matchingOutputAmount = 2_000_000n;
    const result = checkAmount(ctx);
    expect(result.check).toBe('amount');
    expect(result.passed).toBe(true);
  });

  it('passes when overpaid', () => {
    const ctx = makeCtx({ requiredAmount: 1_000_000n });
    ctx._matchingOutputIndex = 0;
    ctx._matchingOutputAmount = 2_000_000n;
    const result = checkAmount(ctx);
    expect(result.passed).toBe(true);
  });

  it('fails when insufficient', () => {
    const ctx = makeCtx({ requiredAmount: 5_000_000n });
    ctx._matchingOutputIndex = 0;
    ctx._matchingOutputAmount = 2_000_000n;
    const result = checkAmount(ctx);
    expect(result.check).toBe('amount');
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('amount_insufficient');
    expect(result.details).toHaveProperty('expected');
    expect(result.details).toHaveProperty('actual');
  });

  it('fails when no matching output was found', () => {
    const ctx = makeCtx();
    // _matchingOutputIndex and _matchingOutputAmount are undefined
    const result = checkAmount(ctx);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('amount_insufficient');
  });

  // Token branching tests
  const MOCK_TOKEN_UNIT = 'cc'.repeat(28) + 'ddee'; // concatenated for assets map key
  const MOCK_TOKEN_ASSET = 'cc'.repeat(28) + '.' + 'ddee'; // dot-separated API format

  it('passes when token amount meets required amount', () => {
    const ctx = makeCtx({ requiredAmount: 5_000_000n, asset: MOCK_TOKEN_ASSET });
    ctx._parsedTx = makeParsedTx({
      body: {
        ...makeParsedTx().body,
        outputs: [
          {
            addressHex: '00' + 'aa'.repeat(28) + 'bb'.repeat(28),
            addressBech32: 'addr_test1qz...',
            lovelace: 2_000_000n,
            assets: { [MOCK_TOKEN_UNIT]: 5_000_000n },
            networkId: 0,
          },
        ],
      },
    });
    ctx._matchingOutputIndex = 0;
    const result = checkAmount(ctx);
    expect(result.check).toBe('amount');
    expect(result.passed).toBe(true);
  });

  it('passes when token amount exceeds required (overpayment)', () => {
    const ctx = makeCtx({ requiredAmount: 5_000_000n, asset: MOCK_TOKEN_ASSET });
    ctx._parsedTx = makeParsedTx({
      body: {
        ...makeParsedTx().body,
        outputs: [
          {
            addressHex: '00' + 'aa'.repeat(28) + 'bb'.repeat(28),
            addressBech32: 'addr_test1qz...',
            lovelace: 2_000_000n,
            assets: { [MOCK_TOKEN_UNIT]: 10_000_000n },
            networkId: 0,
          },
        ],
      },
    });
    ctx._matchingOutputIndex = 0;
    const result = checkAmount(ctx);
    expect(result.passed).toBe(true);
  });

  it('fails with amount_insufficient when token amount is less than required', () => {
    const ctx = makeCtx({ requiredAmount: 5_000_000n, asset: MOCK_TOKEN_ASSET });
    ctx._parsedTx = makeParsedTx({
      body: {
        ...makeParsedTx().body,
        outputs: [
          {
            addressHex: '00' + 'aa'.repeat(28) + 'bb'.repeat(28),
            addressBech32: 'addr_test1qz...',
            lovelace: 2_000_000n,
            assets: { [MOCK_TOKEN_UNIT]: 1_000_000n },
            networkId: 0,
          },
        ],
      },
    });
    ctx._matchingOutputIndex = 0;
    const result = checkAmount(ctx);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('amount_insufficient');
  });

  it('fails with amount_insufficient when token is missing from output.assets', () => {
    const ctx = makeCtx({ requiredAmount: 5_000_000n, asset: MOCK_TOKEN_ASSET });
    ctx._parsedTx = makeParsedTx({
      body: {
        ...makeParsedTx().body,
        outputs: [
          {
            addressHex: '00' + 'aa'.repeat(28) + 'bb'.repeat(28),
            addressBech32: 'addr_test1qz...',
            lovelace: 2_000_000n,
            assets: {},
            networkId: 0,
          },
        ],
      },
    });
    ctx._matchingOutputIndex = 0;
    const result = checkAmount(ctx);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('amount_insufficient');
  });

  it('includes asset field in token failure details', () => {
    const ctx = makeCtx({ requiredAmount: 5_000_000n, asset: MOCK_TOKEN_ASSET });
    ctx._parsedTx = makeParsedTx({
      body: {
        ...makeParsedTx().body,
        outputs: [
          {
            addressHex: '00' + 'aa'.repeat(28) + 'bb'.repeat(28),
            addressBech32: 'addr_test1qz...',
            lovelace: 2_000_000n,
            assets: { [MOCK_TOKEN_UNIT]: 1_000_000n },
            networkId: 0,
          },
        ],
      },
    });
    ctx._matchingOutputIndex = 0;
    const result = checkAmount(ctx);
    expect(result.passed).toBe(false);
    expect(result.details).toHaveProperty('asset', MOCK_TOKEN_ASSET);
  });

  it('ADA payment (lovelace) still uses output.lovelace (regression)', () => {
    const ctx = makeCtx({ requiredAmount: 2_000_000n, asset: 'lovelace' });
    ctx._matchingOutputIndex = 0;
    ctx._matchingOutputAmount = 2_000_000n;
    const result = checkAmount(ctx);
    expect(result.check).toBe('amount');
    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkMinUtxo
// ---------------------------------------------------------------------------

describe('checkMinUtxo', () => {
  it('passes (skips) when getMinUtxoLovelace is not provided', async () => {
    const ctx = makeCtx(); // no getMinUtxoLovelace
    ctx._parsedTx = makeParsedTx();
    ctx._matchingOutputIndex = 0;
    const result = await checkMinUtxo(ctx);
    expect(result.check).toBe('min_utxo');
    expect(result.passed).toBe(true);
  });

  it('passes when output.lovelace >= min UTXO for ADA-only output', async () => {
    const ctx = makeCtx({
      asset: 'lovelace',
      getMinUtxoLovelace: vi.fn().mockResolvedValue(1_000_000n),
    });
    ctx._parsedTx = makeParsedTx({
      body: {
        ...makeParsedTx().body,
        outputs: [
          {
            addressHex: '00' + 'aa'.repeat(28) + 'bb'.repeat(28),
            addressBech32: 'addr_test1qz...',
            lovelace: 2_000_000n,
            assets: {},
            networkId: 0,
          },
        ],
      },
    });
    ctx._matchingOutputIndex = 0;
    const result = await checkMinUtxo(ctx);
    expect(result.check).toBe('min_utxo');
    expect(result.passed).toBe(true);
    expect(ctx.getMinUtxoLovelace).toHaveBeenCalledWith(0); // 0 assets
  });

  it('passes when output.lovelace >= min UTXO for token output', async () => {
    const tokenUnit = 'dd'.repeat(28) + 'eeff';
    const ctx = makeCtx({
      asset: 'dd'.repeat(28) + '.' + 'eeff',
      getMinUtxoLovelace: vi.fn().mockResolvedValue(1_200_000n),
    });
    ctx._parsedTx = makeParsedTx({
      body: {
        ...makeParsedTx().body,
        outputs: [
          {
            addressHex: '00' + 'aa'.repeat(28) + 'bb'.repeat(28),
            addressBech32: 'addr_test1qz...',
            lovelace: 2_000_000n,
            assets: { [tokenUnit]: 5_000_000n },
            networkId: 0,
          },
        ],
      },
    });
    ctx._matchingOutputIndex = 0;
    const result = await checkMinUtxo(ctx);
    expect(result.check).toBe('min_utxo');
    expect(result.passed).toBe(true);
    expect(ctx.getMinUtxoLovelace).toHaveBeenCalledWith(1); // 1 asset
  });

  it('fails with min_utxo_insufficient when output.lovelace < min UTXO', async () => {
    const ctx = makeCtx({
      asset: 'lovelace',
      getMinUtxoLovelace: vi.fn().mockResolvedValue(1_000_000n),
    });
    ctx._parsedTx = makeParsedTx({
      body: {
        ...makeParsedTx().body,
        outputs: [
          {
            addressHex: '00' + 'aa'.repeat(28) + 'bb'.repeat(28),
            addressBech32: 'addr_test1qz...',
            lovelace: 500_000n,
            assets: {},
            networkId: 0,
          },
        ],
      },
    });
    ctx._matchingOutputIndex = 0;
    const result = await checkMinUtxo(ctx);
    expect(result.check).toBe('min_utxo');
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('min_utxo_insufficient');
  });

  it('failure details include required and actual as strings', async () => {
    const ctx = makeCtx({
      asset: 'lovelace',
      getMinUtxoLovelace: vi.fn().mockResolvedValue(1_000_000n),
    });
    ctx._parsedTx = makeParsedTx({
      body: {
        ...makeParsedTx().body,
        outputs: [
          {
            addressHex: '00' + 'aa'.repeat(28) + 'bb'.repeat(28),
            addressBech32: 'addr_test1qz...',
            lovelace: 500_000n,
            assets: {},
            networkId: 0,
          },
        ],
      },
    });
    ctx._matchingOutputIndex = 0;
    const result = await checkMinUtxo(ctx);
    expect(result.details).toHaveProperty('required', '1000000');
    expect(result.details).toHaveProperty('actual', '500000');
  });

  it('failure details include human-readable message', async () => {
    const ctx = makeCtx({
      asset: 'lovelace',
      getMinUtxoLovelace: vi.fn().mockResolvedValue(1_000_000n),
    });
    ctx._parsedTx = makeParsedTx({
      body: {
        ...makeParsedTx().body,
        outputs: [
          {
            addressHex: '00' + 'aa'.repeat(28) + 'bb'.repeat(28),
            addressBech32: 'addr_test1qz...',
            lovelace: 500_000n,
            assets: {},
            networkId: 0,
          },
        ],
      },
    });
    ctx._matchingOutputIndex = 0;
    const result = await checkMinUtxo(ctx);
    expect(result.details).toHaveProperty(
      'message',
      'min UTXO requires 1000000 lovelace, got 500000'
    );
  });

  it('fails when _matchingOutputIndex is undefined (returns cbor_required)', async () => {
    const ctx = makeCtx({
      getMinUtxoLovelace: vi.fn().mockResolvedValue(1_000_000n),
    });
    ctx._parsedTx = makeParsedTx();
    // _matchingOutputIndex is undefined
    const result = await checkMinUtxo(ctx);
    expect(result.check).toBe('min_utxo');
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('cbor_required');
  });

  it('check name is min_utxo in all results', async () => {
    // Pass case
    const passCtx = makeCtx();
    passCtx._parsedTx = makeParsedTx();
    passCtx._matchingOutputIndex = 0;
    const passResult = await checkMinUtxo(passCtx);
    expect(passResult.check).toBe('min_utxo');

    // Fail case
    const failCtx = makeCtx({
      getMinUtxoLovelace: vi.fn().mockResolvedValue(1_000_000n),
    });
    failCtx._parsedTx = makeParsedTx({
      body: {
        ...makeParsedTx().body,
        outputs: [
          {
            addressHex: '00' + 'aa'.repeat(28) + 'bb'.repeat(28),
            addressBech32: 'addr_test1qz...',
            lovelace: 500_000n,
            assets: {},
            networkId: 0,
          },
        ],
      },
    });
    failCtx._matchingOutputIndex = 0;
    const failResult = await checkMinUtxo(failCtx);
    expect(failResult.check).toBe('min_utxo');
  });
});

// ---------------------------------------------------------------------------
// checkWitnessPresent (presence pre-filter — NOT cryptographic verification)
// ---------------------------------------------------------------------------

describe('checkWitnessPresent', () => {
  it('passes when witnesses are present', () => {
    const ctx = makeCtx();
    ctx._parsedTx = makeParsedTx({ hasWitnesses: true });
    const result = checkWitnessPresent(ctx);
    expect(result.check).toBe('witness');
    expect(result.passed).toBe(true);
  });

  it('fails when witnesses are absent', () => {
    const ctx = makeCtx();
    ctx._parsedTx = makeParsedTx({ hasWitnesses: false });
    const result = checkWitnessPresent(ctx);
    expect(result.check).toBe('witness');
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('missing_witness');
  });

  it('returns cbor_required when _parsedTx is missing', () => {
    const ctx = makeCtx();
    const result = checkWitnessPresent(ctx);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('cbor_required');
  });

  // ---- H3 contract lock-in ----

  // The function is INTENTIONALLY a presence-only pre-filter. It does NOT
  // verify that the witness bytes are a valid Ed25519 signature, that the
  // vkey hash matches any input address, or that the witness count covers
  // every required signer. Cardano nodes perform all of those when the tx
  // is submitted; duplicating that here would be both wasteful and a place
  // future bugs could let bad payments through "verified". This test exists
  // to make a future "improve witness check" PR have to consciously decide
  // whether to (a) implement real Ed25519 verification end-to-end, or
  // (b) leave the contract alone.
  it('passes when the witness slot is non-empty even if the inner bytes would not validate on-chain', () => {
    // hasWitnesses just reflects "vkeywitnesses array exists and is non-empty"
    // per src/verify/cbor.ts. The byte contents are not inspected.
    const ctx = makeCtx();
    ctx._parsedTx = makeParsedTx({
      hasWitnesses: true,
      // (other fields default to mock values — the point is that we don't
      // need a *real* signature for this check to pass.)
    });
    const result = checkWitnessPresent(ctx);
    expect(result.passed).toBe(true);
    // Document the contract in the assertion message so a grep for it
    // surfaces the design rationale:
    // "presence-only — chain submission rejects bad signatures"
  });
});

// ---------------------------------------------------------------------------
// checkTtl
// ---------------------------------------------------------------------------

describe('checkTtl', () => {
  it('fails when no TTL is set', async () => {
    const ctx = makeCtx();
    ctx._parsedTx = makeParsedTx({ body: { ...makeParsedTx().body, ttl: undefined } });
    const result = await checkTtl(ctx);
    expect(result.check).toBe('ttl');
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('ttl_required');
  });

  it('passes when TTL is in the bounded payment window', async () => {
    const ctx = makeCtx({
      getCurrentSlot: vi.fn().mockResolvedValue(1000),
      maxTimeoutSeconds: 300,
      ttlGraceBufferSeconds: 30,
    });
    ctx._parsedTx = makeParsedTx({ body: { ...makeParsedTx().body, ttl: 1300n } });
    const result = await checkTtl(ctx);
    expect(result.check).toBe('ttl');
    expect(result.passed).toBe(true);
  });

  it('fails when TTL is in the past', async () => {
    const ctx = makeCtx({
      getCurrentSlot: vi.fn().mockResolvedValue(5000),
    });
    ctx._parsedTx = makeParsedTx({ body: { ...makeParsedTx().body, ttl: 1000n } });
    const result = await checkTtl(ctx);
    expect(result.check).toBe('ttl');
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('transaction_expired');
    expect(result.details).toHaveProperty('ttl');
    expect(result.details).toHaveProperty('currentSlot');
  });

  it('fails when TTL is beyond maxTimeoutSeconds plus grace', async () => {
    const ctx = makeCtx({
      getCurrentSlot: vi.fn().mockResolvedValue(1000),
      maxTimeoutSeconds: 300,
      ttlGraceBufferSeconds: 30,
    });
    ctx._parsedTx = makeParsedTx({ body: { ...makeParsedTx().body, ttl: 1331n } });
    const result = await checkTtl(ctx);
    expect(result.check).toBe('ttl');
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('transaction_ttl_too_far');
    expect(result.details).toMatchObject({
      latestAllowedTtl: '1330',
      maxTimeoutSeconds: 300,
      graceBufferSeconds: 30,
    });
  });

  it('returns cbor_required when _parsedTx is missing', async () => {
    const ctx = makeCtx();
    const result = await checkTtl(ctx);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('cbor_required');
  });
});

// ---------------------------------------------------------------------------
// checkFee
// ---------------------------------------------------------------------------

describe('checkFee', () => {
  it('passes when fee is in range', () => {
    const ctx = makeCtx({ feeMin: 150_000n, feeMax: 5_000_000n });
    ctx._parsedTx = makeParsedTx({ body: { ...makeParsedTx().body, fee: 200_000n } });
    const result = checkFee(ctx);
    expect(result.check).toBe('fee');
    expect(result.passed).toBe(true);
  });

  it('fails when fee is too low', () => {
    const ctx = makeCtx({ feeMin: 150_000n, feeMax: 5_000_000n });
    ctx._parsedTx = makeParsedTx({ body: { ...makeParsedTx().body, fee: 100_000n } });
    const result = checkFee(ctx);
    expect(result.check).toBe('fee');
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('unreasonable_fee');
    expect(result.details).toHaveProperty('fee');
    expect(result.details).toHaveProperty('min');
    expect(result.details).toHaveProperty('max');
  });

  it('fails when fee is too high', () => {
    const ctx = makeCtx({ feeMin: 150_000n, feeMax: 5_000_000n });
    ctx._parsedTx = makeParsedTx({ body: { ...makeParsedTx().body, fee: 10_000_000n } });
    const result = checkFee(ctx);
    expect(result.check).toBe('fee');
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('unreasonable_fee');
  });

  it('returns cbor_required when _parsedTx is missing', () => {
    const ctx = makeCtx();
    const result = checkFee(ctx);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('cbor_required');
  });
});

// ---------------------------------------------------------------------------
// VERIFICATION_CHECKS array
// ---------------------------------------------------------------------------

describe('VERIFICATION_CHECKS', () => {
  it('exports an array of 11 check functions', () => {
    expect(VERIFICATION_CHECKS).toHaveLength(11);
  });

  it('has checks in the correct order', () => {
    expect(VERIFICATION_CHECKS[0]).toBe(checkCborValid);
    expect(VERIFICATION_CHECKS[1]).toBe(checkScheme);
    expect(VERIFICATION_CHECKS[2]).toBe(checkNetwork);
    expect(VERIFICATION_CHECKS[3]).toBe(checkTokenSupported);
    expect(VERIFICATION_CHECKS[4]).toBe(checkRecipient);
    expect(VERIFICATION_CHECKS[5]).toBe(checkAmount);
    expect(VERIFICATION_CHECKS[6]).toBe(checkMinUtxo);
    expect(VERIFICATION_CHECKS[7]).toBe(checkWitnessPresent);
    expect(VERIFICATION_CHECKS[8]).toBe(checkTtl);
    expect(VERIFICATION_CHECKS[9]).toBe(checkFee);
    expect(VERIFICATION_CHECKS[10]).toBe(checkNonce);
  });
});

// ---------------------------------------------------------------------------
// checkNonce (Track A1 — x402 Cardano spec mandate)
// ---------------------------------------------------------------------------

describe('checkNonce', () => {
  const txHash = 'a'.repeat(64);
  const otherHash = 'b'.repeat(64);

  it('passes when no nonce declared and requireNonce is false', async () => {
    const ctx = makeCtx({ requireNonce: false });
    ctx._parsedTx = makeParsedTx();
    const result = await checkNonce(ctx);
    expect(result.passed).toBe(true);
  });

  it('rejects when no nonce declared and requireNonce is true (default per spec)', async () => {
    const ctx = makeCtx();
    ctx._parsedTx = makeParsedTx();
    const result = await checkNonce(ctx);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('nonce_required');
  });

  it('rejects when declared nonce does not appear in tx inputs', async () => {
    const ctx = makeCtx({
      declaredNonce: { txHash: otherHash, index: 0 },
      isUtxoUnspent: vi.fn().mockResolvedValue(true),
    });
    ctx._parsedTx = makeParsedTx({
      body: {
        ...makeParsedTx().body,
        inputs: [{ txHash, index: 0n }],
      },
    });
    const result = await checkNonce(ctx);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('nonce_not_in_inputs');
  });

  it('rejects when declared nonce matches an input but UTXO is spent', async () => {
    const isUtxoUnspent = vi.fn().mockResolvedValue(false);
    const ctx = makeCtx({
      declaredNonce: { txHash, index: 0 },
      isUtxoUnspent,
    });
    ctx._parsedTx = makeParsedTx({
      body: {
        ...makeParsedTx().body,
        inputs: [{ txHash, index: 0n }],
      },
    });
    const result = await checkNonce(ctx);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('nonce_utxo_spent');
    expect(isUtxoUnspent).toHaveBeenCalledWith(txHash, 0);
  });

  it('passes when nonce matches an input and UTXO is unspent', async () => {
    const ctx = makeCtx({
      declaredNonce: { txHash, index: 0 },
      isUtxoUnspent: vi.fn().mockResolvedValue(true),
    });
    ctx._parsedTx = makeParsedTx({
      body: {
        ...makeParsedTx().body,
        inputs: [{ txHash, index: 0n }],
      },
    });
    const result = await checkNonce(ctx);
    expect(result.passed).toBe(true);
  });

  it('reports nonce_lookup_failed when chain query throws', async () => {
    const ctx = makeCtx({
      declaredNonce: { txHash, index: 0 },
      isUtxoUnspent: vi.fn().mockRejectedValue(new Error('blockfrost down')),
    });
    ctx._parsedTx = makeParsedTx({
      body: {
        ...makeParsedTx().body,
        inputs: [{ txHash, index: 0n }],
      },
    });
    const result = await checkNonce(ctx);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('nonce_lookup_failed');
  });

  it('fails closed when isUtxoUnspent is missing in spec-compliant mode (requireNonce default true)', async () => {
    const ctx = makeCtx({
      declaredNonce: { txHash, index: 0 },
      // intentionally no isUtxoUnspent
    });
    ctx._parsedTx = makeParsedTx({
      body: {
        ...makeParsedTx().body,
        inputs: [{ txHash, index: 0n }],
      },
    });
    const result = await checkNonce(ctx);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('nonce_lookup_unavailable');
  });

  it('passes with skipped detail when isUtxoUnspent is missing in legacy mode (requireNonce=false)', async () => {
    const ctx = makeCtx({
      requireNonce: false,
      declaredNonce: { txHash, index: 0 },
      // intentionally no isUtxoUnspent
    });
    ctx._parsedTx = makeParsedTx({
      body: {
        ...makeParsedTx().body,
        inputs: [{ txHash, index: 0n }],
      },
    });
    const result = await checkNonce(ctx);
    expect(result.passed).toBe(true);
    expect(result.details).toMatchObject({ skipped: 'isUtxoUnspent_callback_missing' });
  });

  it('returns cbor_required when ctx._parsedTx is missing', async () => {
    const ctx = makeCtx({ declaredNonce: { txHash, index: 0 } });
    const result = await checkNonce(ctx);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('cbor_required');
  });
});
