// Nonce parsing and validation helpers for the x402 Cardano `exact` scheme.
//
// Per spec:
// - `nonce` is a UTXO reference of the form `txHash#index`
// - `txHash` is 64 lowercase hex chars, `index` is a non-negative decimal
// - The UTXO MUST be one of the transaction's inputs
// - The UTXO MUST be unspent in the current on-chain UTXO set
//
// Spec: https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_cardano.md#facilitator-verification-rules

const NONCE_RE = /^([0-9a-f]{64})#(\d+)$/;

/**
 * Parse a nonce string of the form `txHash#index`.
 *
 * Returns the structured form on success, or null if the format is invalid.
 * The hash is left as a lowercase hex string so it can be compared directly
 * with `DeserializedTx.body.inputs[i].txHash` (CML's Address.to_hex()).
 */
export function parseNonce(nonce: string): { txHash: string; index: number } | null {
  const match = NONCE_RE.exec(nonce);
  if (!match) return null;

  const [, txHash, indexStr] = match;
  const index = Number(indexStr);

  // Reject parses that overflow safe integer range; UTXO indices in real Cardano
  // outputs are tiny (<2^16) so this is purely defensive.
  if (!Number.isSafeInteger(index) || index < 0) return null;

  return { txHash, index };
}

/**
 * Format a structured nonce back into wire form.
 */
export function formatNonce(nonce: { txHash: string; index: number }): string {
  return `${nonce.txHash}#${nonce.index}`;
}
