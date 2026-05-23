// Chain domain types for Cardano UTXO tracking

/**
 * Supported Cardano networks (matches Lucid Evolution's expected strings).
 */
export type CardanoNetwork = 'Preview' | 'Preprod' | 'Mainnet';

/**
 * Blockfrost API tier - affects caching aggressiveness.
 * Free tier: 50K requests/day, more aggressive caching.
 * Paid tier: higher limits, relaxed caching.
 */
export type BlockfrostTier = 'free' | 'paid';

/**
 * Blockfrost API base URLs per network.
 */
export const BLOCKFROST_URLS: Record<CardanoNetwork, string> = {
  Preview: 'https://cardano-preview.blockfrost.io/api/v0',
  Preprod: 'https://cardano-preprod.blockfrost.io/api/v0',
  Mainnet: 'https://cardano-mainnet.blockfrost.io/api/v0',
} as const;

/**
 * Unique UTXO identifier (transaction hash + output index).
 */
export interface UtxoRef {
  txHash: string;
  outputIndex: number;
}

/**
 * Simplified UTXO representation for caching.
 * Uses bigint for all lovelace/asset values to prevent precision loss.
 */
export interface CachedUtxo {
  txHash: string;
  outputIndex: number;
  address: string;
  /** Lovelace amount (bigint to prevent precision loss above 2^53) */
  lovelace: bigint;
  /** Native asset quantities keyed by policyId + assetName hex */
  assets: Record<string, bigint>;
  /** Optional datum hash attached to the UTXO */
  datumHash?: string;
}

/**
 * Convert a UtxoRef object to its string representation.
 * Format: "txHash#outputIndex"
 */
export function utxoRefToString(ref: UtxoRef): string {
  return `${ref.txHash}#${ref.outputIndex}`;
}

/**
 * Parse a UTXO reference string back to a UtxoRef object.
 * Expected format: "txHash#outputIndex"
 *
 * @throws {Error} If the string format is invalid
 */
export function stringToUtxoRef(ref: string): UtxoRef {
  const hashIndex = ref.lastIndexOf('#');
  if (hashIndex === -1) {
    throw new Error(`Invalid UTXO reference format: "${ref}" (expected "txHash#outputIndex")`);
  }

  const txHash = ref.slice(0, hashIndex);
  const outputIndexStr = ref.slice(hashIndex + 1);
  const outputIndex = Number(outputIndexStr);

  if (!txHash || Number.isNaN(outputIndex) || outputIndex < 0 || !Number.isInteger(outputIndex)) {
    throw new Error(`Invalid UTXO reference format: "${ref}" (expected "txHash#outputIndex")`);
  }

  return { txHash, outputIndex };
}
