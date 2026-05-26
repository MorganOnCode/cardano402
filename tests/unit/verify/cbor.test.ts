// Unit tests for CBOR transaction deserialization
//
// Uses real CML to build test transaction fixtures, then verifies
// deserializeTransaction() correctly extracts all fields.

import { CML } from '@lucid-evolution/lucid';
import { describe, expect, it } from 'vitest';

import {
  MAX_TRANSACTION_CBOR_BASE64_LENGTH,
  decodeTransactionCborBase64,
  deserializeTransaction,
} from '../../../src/verify/cbor.js';

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

/** Create a testnet base address from key hash hex strings. */
function makeTestnetAddr(payKeyHex: string, stakeKeyHex: string): CML.Address {
  return CML.BaseAddress.new(
    0, // testnet
    CML.Credential.new_pub_key(CML.Ed25519KeyHash.from_hex(payKeyHex)),
    CML.Credential.new_pub_key(CML.Ed25519KeyHash.from_hex(stakeKeyHex))
  ).to_address();
}

/** Create a mainnet base address from key hash hex strings. */
function makeMainnetAddr(payKeyHex: string, stakeKeyHex: string): CML.Address {
  return CML.BaseAddress.new(
    1, // mainnet
    CML.Credential.new_pub_key(CML.Ed25519KeyHash.from_hex(payKeyHex)),
    CML.Credential.new_pub_key(CML.Ed25519KeyHash.from_hex(stakeKeyHex))
  ).to_address();
}

/** Create a VKey witness from CBOR (fake data -- not cryptographically valid). */
function makeFakeWitness(): CML.Vkeywitness {
  const vkeyBytes = '0'.repeat(64); // 32 bytes
  const sigBytes = '0'.repeat(128); // 64 bytes
  const cborHex = '82' + '5820' + vkeyBytes + '5840' + sigBytes;
  return CML.Vkeywitness.from_cbor_hex(cborHex);
}

/** Build a basic unsigned test transaction and return base64. */
function buildTestTx(
  options: {
    fee?: bigint;
    ttl?: bigint;
    outputAddr?: CML.Address;
    outputLovelace?: bigint;
    signed?: boolean;
    multiOutput?: { addr: CML.Address; lovelace: bigint }[];
    multiAsset?: { policyHex: string; assetNameHex: string; quantity: bigint };
  } = {}
): string {
  const {
    fee = 200_000n,
    ttl,
    outputAddr = makeTestnetAddr('a'.repeat(56), 'b'.repeat(56)),
    outputLovelace = 2_000_000n,
    signed = false,
    multiOutput,
    multiAsset,
  } = options;

  const inputList = CML.TransactionInputList.new();
  inputList.add(CML.TransactionInput.new(CML.TransactionHash.from_hex('a'.repeat(64)), 0n));

  const outputList = CML.TransactionOutputList.new();

  if (multiOutput) {
    for (const out of multiOutput) {
      outputList.add(CML.TransactionOutput.new(out.addr, CML.Value.from_coin(out.lovelace)));
    }
  } else {
    let value: CML.Value;
    if (multiAsset) {
      const ma = CML.MultiAsset.new();
      ma.set(
        CML.ScriptHash.from_hex(multiAsset.policyHex),
        CML.AssetName.from_hex(multiAsset.assetNameHex),
        multiAsset.quantity
      );
      value = CML.Value.new(outputLovelace, ma);
    } else {
      value = CML.Value.from_coin(outputLovelace);
    }
    outputList.add(CML.TransactionOutput.new(outputAddr, value));
  }

  const txBody = CML.TransactionBody.new(inputList, outputList, fee);
  if (ttl !== undefined) {
    txBody.set_ttl(ttl);
  }

  let witnessSet: CML.TransactionWitnessSet;
  if (signed) {
    witnessSet = CML.TransactionWitnessSet.new();
    const vkwList = CML.VkeywitnessList.new();
    vkwList.add(makeFakeWitness());
    witnessSet.set_vkeywitnesses(vkwList);
  } else {
    witnessSet = CML.TransactionWitnessSet.new();
  }

  const tx = CML.Transaction.new(txBody, witnessSet, true);
  const cborHex = tx.to_cbor_hex();

  // Free CML objects
  tx.free();

  return Buffer.from(cborHex, 'hex').toString('base64');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deserializeTransaction', () => {
  describe('valid transaction round-trip', () => {
    it('deserializes a basic unsigned transaction', () => {
      const base64 = buildTestTx({ fee: 200_000n, ttl: 500_000n });
      const result = deserializeTransaction(base64);

      expect(result.body.fee).toBe(200_000n);
      expect(result.body.ttl).toBe(500_000n);
      expect(result.body.inputs).toHaveLength(1);
      expect(result.body.inputs[0].txHash).toBe('a'.repeat(64));
      expect(result.body.inputs[0].index).toBe(0n);
      expect(result.body.outputs).toHaveLength(1);
      expect(result.body.outputs[0].lovelace).toBe(2_000_000n);
      expect(result.body.outputs[0].networkId).toBe(0); // testnet
      expect(result.cborHex).toBeTruthy();
      expect(result.txHash).toBeTruthy();
      expect(typeof result.txHash).toBe('string');
      expect(result.txHash.length).toBe(64); // 32 bytes hex
    });

    it('populates addressHex and addressBech32 for outputs', () => {
      const addr = makeTestnetAddr('a'.repeat(56), 'b'.repeat(56));
      const base64 = buildTestTx({ outputAddr: addr });
      const result = deserializeTransaction(base64);

      expect(result.body.outputs[0].addressHex).toBe(addr.to_hex());
      expect(result.body.outputs[0].addressBech32).toBe(addr.to_bech32());
    });
  });

  describe('multi-output transaction', () => {
    it('parses all outputs with correct addresses and amounts', () => {
      const addr1 = makeTestnetAddr('a'.repeat(56), 'b'.repeat(56));
      const addr2 = makeTestnetAddr('c'.repeat(56), 'b'.repeat(56));

      const base64 = buildTestTx({
        multiOutput: [
          { addr: addr1, lovelace: 2_000_000n },
          { addr: addr2, lovelace: 3_000_000n },
        ],
        signed: true,
      });

      const result = deserializeTransaction(base64);

      expect(result.body.outputs).toHaveLength(2);
      expect(result.body.outputs[0].addressHex).toBe(addr1.to_hex());
      expect(result.body.outputs[0].lovelace).toBe(2_000_000n);
      expect(result.body.outputs[1].addressHex).toBe(addr2.to_hex());
      expect(result.body.outputs[1].lovelace).toBe(3_000_000n);
    });
  });

  describe('TTL handling', () => {
    it('returns TTL when set', () => {
      const base64 = buildTestTx({ ttl: 999_999n });
      const result = deserializeTransaction(base64);
      expect(result.body.ttl).toBe(999_999n);
    });

    it('returns undefined TTL when not set', () => {
      const base64 = buildTestTx(); // no ttl
      const result = deserializeTransaction(base64);
      expect(result.body.ttl).toBeUndefined();
    });
  });

  describe('witness detection', () => {
    it('detects witnesses when present', () => {
      const base64 = buildTestTx({ signed: true });
      const result = deserializeTransaction(base64);
      expect(result.hasWitnesses).toBe(true);
    });

    it('detects absence of witnesses', () => {
      const base64 = buildTestTx({ signed: false });
      const result = deserializeTransaction(base64);
      expect(result.hasWitnesses).toBe(false);
    });
  });

  describe('multi-asset extraction', () => {
    it('extracts native assets into the assets record', () => {
      const policyHex = 'c'.repeat(56);
      const assetNameHex = 'cafe';

      const base64 = buildTestTx({
        multiAsset: { policyHex, assetNameHex, quantity: 100n },
      });

      const result = deserializeTransaction(base64);
      expect(result.body.outputs[0].lovelace).toBe(2_000_000n);
      expect(result.body.outputs[0].assets).toEqual({
        [policyHex + assetNameHex]: 100n,
      });
    });

    it('returns empty assets for lovelace-only outputs', () => {
      const base64 = buildTestTx();
      const result = deserializeTransaction(base64);
      expect(result.body.outputs[0].assets).toEqual({});
    });
  });

  describe('network ID extraction', () => {
    it('infers network ID from output address when body has no network_id', () => {
      const base64 = buildTestTx({
        outputAddr: makeTestnetAddr('a'.repeat(56), 'b'.repeat(56)),
      });
      const result = deserializeTransaction(base64);
      expect(result.body.networkId).toBe(0);
    });

    it('detects mainnet network ID from output address', () => {
      const base64 = buildTestTx({
        outputAddr: makeMainnetAddr('a'.repeat(56), 'b'.repeat(56)),
      });
      const result = deserializeTransaction(base64);
      expect(result.body.networkId).toBe(1);
    });
  });

  describe('error handling', () => {
    it('throws on invalid base64 input', () => {
      expect(() => deserializeTransaction('not-valid-base64!!!')).toThrow(/base64/i);
    });

    it('throws on invalid base64 padding', () => {
      expect(() => deserializeTransaction('AAAA=')).toThrow(/base64/i);
      expect(() => decodeTransactionCborBase64('abcd=ef')).toThrow(/base64/i);
    });

    it('throws on oversized base64 input before CBOR parsing', () => {
      expect(() =>
        deserializeTransaction('A'.repeat(MAX_TRANSACTION_CBOR_BASE64_LENGTH + 1))
      ).toThrow(/maximum size/i);
    });

    it('throws CML error on valid base64 that is not valid CBOR', () => {
      // Valid base64 encoding of garbage bytes
      const garbageBase64 = Buffer.from('deadbeef', 'hex').toString('base64');
      expect(() => deserializeTransaction(garbageBase64)).toThrow();
    });

    it('throws on empty string', () => {
      expect(() => deserializeTransaction('')).toThrow();
    });
  });
});
