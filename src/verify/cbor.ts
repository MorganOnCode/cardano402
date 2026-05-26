// CBOR transaction deserialization for x402 verification
//
// Converts base64-encoded signed Cardano transactions into structured objects
// for verification by the check pipeline.
//
// Uses CML (Cardano Multiplatform Library) re-exported from @lucid-evolution/lucid
// for CBOR parsing. No additional dependencies needed.

import { CML } from '@lucid-evolution/lucid';

/**
 * Structured representation of a deserialized Cardano transaction.
 */
export interface DeserializedTx {
  /** Hex-encoded CBOR for hashing */
  cborHex: string;
  body: {
    inputs: { txHash: string; index: bigint }[];
    outputs: {
      /** Canonical hex representation of the address (for comparison) */
      addressHex: string;
      /** Bech32 representation of the address (for display) */
      addressBech32: string;
      lovelace: bigint;
      /** Native assets keyed by policyIdHex + assetNameHex (Phase 5 forward compat) */
      assets: Record<string, bigint>;
      /** Network ID from the address (0 = testnet, 1 = mainnet) */
      networkId: number;
    }[];
    fee: bigint;
    ttl: bigint | undefined;
    /** Network ID from body field or inferred from first output address */
    networkId: number | undefined;
  };
  /** Whether VKey witnesses are present in the witness set */
  hasWitnesses: boolean;
  /** Transaction hash computed from the body */
  txHash: string;
}

// Keep transaction payloads bounded before WASM parsing or Blockfrost
// submission. The server's JSON body limit is still the outer guard.
export const MAX_TRANSACTION_CBOR_BASE64_LENGTH = 24 * 1024;
const BASE64_ALPHABET_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Strictly decode base64-encoded signed transaction CBOR.
 *
 * Node's Buffer.from(..., 'base64') is intentionally permissive and silently
 * accepts malformed input. Public payment paths should reject malformed,
 * noncanonical, or oversized transaction payloads before CBOR parsing or chain
 * submission.
 */
export function decodeTransactionCborBase64(base64Cbor: string): Uint8Array {
  const padded = normalizeStrictBase64(base64Cbor);
  const bytes = Buffer.from(padded, 'base64');
  const normalizedInput = padded.replace(/=+$/u, '');
  const normalizedRoundTrip = bytes.toString('base64').replace(/=+$/u, '');
  if (normalizedInput !== normalizedRoundTrip) {
    throw new Error('Invalid base64 encoding in transaction payload');
  }
  return new Uint8Array(bytes);
}

function normalizeStrictBase64(base64Cbor: string): string {
  if (base64Cbor.length === 0) {
    throw new Error('Invalid base64 encoding in transaction payload');
  }
  if (base64Cbor.length > MAX_TRANSACTION_CBOR_BASE64_LENGTH) {
    throw new Error('Invalid base64 encoding in transaction payload: payload exceeds maximum size');
  }
  if (!BASE64_ALPHABET_RE.test(base64Cbor)) {
    throw new Error('Invalid base64 encoding in transaction payload');
  }
  if (base64Cbor.includes('=') && base64Cbor.length % 4 !== 0) {
    throw new Error('Invalid base64 encoding in transaction payload');
  }

  const unpadded = base64Cbor.replace(/=+$/u, '');
  if (unpadded.length % 4 === 1) {
    throw new Error('Invalid base64 encoding in transaction payload');
  }
  const paddedLength = Math.ceil(unpadded.length / 4) * 4;
  return unpadded.padEnd(paddedLength, '=');
}

/**
 * Deserialize a base64-encoded signed Cardano transaction CBOR.
 *
 * 1. Converts base64 to hex
 * 2. Parses hex CBOR using CML.Transaction.from_cbor_hex()
 * 3. Extracts all transaction body fields into a structured DeserializedTx
 *
 * Address comparison uses canonical hex (Address.to_hex()), NOT bech32 string
 * comparison, per research pitfall #2.
 *
 * @param base64Cbor - Base64-encoded transaction CBOR
 * @returns Structured transaction data
 * @throws Error with "base64" in message on invalid base64
 * @throws CML error on invalid CBOR (propagated directly)
 */
export function deserializeTransaction(base64Cbor: string): DeserializedTx {
  // Convert base64 to hex
  const cborHex = Buffer.from(decodeTransactionCborBase64(base64Cbor)).toString('hex');

  // Parse CBOR hex into CML Transaction (throws on invalid CBOR)
  const tx = CML.Transaction.from_cbor_hex(cborHex);

  try {
    const body = tx.body();

    // Parse inputs
    const inputList = body.inputs();
    const inputs: DeserializedTx['body']['inputs'] = [];
    for (let i = 0; i < inputList.len(); i++) {
      const input = inputList.get(i);
      inputs.push({
        txHash: input.transaction_id().to_hex(),
        index: input.index(),
      });
    }

    // Parse outputs
    const outputList = body.outputs();
    const outputs: DeserializedTx['body']['outputs'] = [];
    for (let i = 0; i < outputList.len(); i++) {
      const output = outputList.get(i);
      const address = output.address();
      const value = output.amount();

      // Extract multi-asset map for Phase 5 forward compatibility
      const assets: Record<string, bigint> = {};
      if (value.has_multiassets()) {
        const multiAsset = value.multi_asset();
        const policies = multiAsset.keys();
        for (let p = 0; p < policies.len(); p++) {
          const policyId = policies.get(p);
          const assetMap = multiAsset.get_assets(policyId);
          if (!assetMap) continue;
          const assetKeys = assetMap.keys();
          for (let a = 0; a < assetKeys.len(); a++) {
            const assetName = assetKeys.get(a);
            const quantity = assetMap.get(assetName);
            if (quantity !== undefined) {
              // Key format: policyIdHex + assetNameHex (concatenated, no separator)
              assets[policyId.to_hex() + assetName.to_hex()] = quantity;
            }
          }
        }
      }

      outputs.push({
        addressHex: address.to_hex(),
        addressBech32: address.to_bech32(),
        lovelace: value.coin(),
        assets,
        networkId: address.network_id(),
      });
    }

    // Network ID: try body.network_id() first, then fallback to first output address
    let networkId: number | undefined;
    const bodyNetworkId = body.network_id();
    if (bodyNetworkId) {
      networkId = Number(bodyNetworkId.network());
    } else if (outputs.length > 0) {
      networkId = outputs[0].networkId;
    }

    // Check for VKey witnesses
    const witnessSet = tx.witness_set();
    const witnessJson = JSON.parse(witnessSet.to_json()) as {
      vkeywitnesses: unknown[] | null;
    };
    const hasWitnesses =
      Array.isArray(witnessJson.vkeywitnesses) && witnessJson.vkeywitnesses.length > 0;

    // Compute transaction hash
    const txHash = CML.hash_transaction(body).to_hex();

    return {
      cborHex,
      body: {
        inputs,
        outputs,
        fee: body.fee(),
        ttl: body.ttl(),
        networkId,
      },
      hasWitnesses,
      txHash,
    };
  } finally {
    // Free CML WASM memory
    tx.free();
  }
}
