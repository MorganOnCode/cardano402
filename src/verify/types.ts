// Verification domain types for x402 V2 transaction-based model.
//
// Wire-format schemas are re-exported from @cardano402/core so the
// facilitator and any downstream consumer of the package speak the same
// validated types. Cardano-specific constants + the orchestrator's
// internal `VerifyContext` / `VerifyCheck` pipeline state stay local.

import type { DeserializedTx } from './cbor.js';
import type { CardanoNetwork } from '../chain/types.js';

// ---------------------------------------------------------------------------
// CAIP-2 Chain ID Constants (local — Cardano-specific maps, not in core)
// ---------------------------------------------------------------------------

/**
 * CAIP-2 chain identifier strings for each Cardano network.
 * Format: "cardano:{network}" per Chain Agnostic Improvement Proposals.
 */
export const CAIP2_CHAIN_IDS: Record<CardanoNetwork, string> = {
  Preview: 'cardano:preview',
  Preprod: 'cardano:preprod',
  Mainnet: 'cardano:mainnet',
} as const;

/**
 * Map CAIP-2 chain ID string to Cardano network magic ID.
 * Preview and Preprod use testnet magic (0), Mainnet uses 1.
 */
export const CAIP2_TO_NETWORK_ID: Record<string, number> = {
  'cardano:preview': 0,
  'cardano:preprod': 0,
  'cardano:mainnet': 1,
};

/**
 * Expected Cardano network ID byte for each CAIP-2 chain.
 * Used when verifying the network ID embedded in transaction addresses.
 * (Same values as CAIP2_TO_NETWORK_ID -- kept as a named alias for clarity.)
 */
export const NETWORK_ID_EXPECTED: Record<string, number> = {
  'cardano:preview': 0,
  'cardano:preprod': 0,
  'cardano:mainnet': 1,
};

// ---------------------------------------------------------------------------
// Wire-format schemas + types re-exported from @cardano402/core.
// NonceSchema is an alias for UtxoRefSchema to preserve existing import
// paths (`import { NonceSchema } from '../verify/types.js'`).
// ---------------------------------------------------------------------------

export {
  X402VersionSchema,
  SchemeSchema,
  NetworkSchema,
  LovelaceAmountSchema,
  CardanoAddressSchema,
  UtxoRefSchema,
  UtxoRefSchema as NonceSchema,
  VerifyErrorReasonSchema,
  PaymentRequirementsSchema,
  CardanoPayloadSchema,
  PaymentPayloadSchema,
  VerifyRequestSchema,
  VerifyResponseSchema,
} from '@cardano402/core';

export type {
  X402Version,
  Scheme,
  Network,
  LovelaceAmount,
  CardanoAddress,
  UtxoRef,
  UtxoRef as Nonce,
  VerifyErrorReason,
  PaymentRequirements,
  CardanoPayload,
  PaymentPayload,
  VerifyRequest,
  VerifyResponse,
} from '@cardano402/core';

// ---------------------------------------------------------------------------
// Internal types (plain TypeScript — no Zod, stays local to the facilitator)
// ---------------------------------------------------------------------------

/**
 * Result of a single verification check.
 */
export interface CheckResult {
  /** Check name, e.g. "cbor_valid", "scheme", "network", "recipient" */
  check: string;
  /** Whether this check passed */
  passed: boolean;
  /** Snake_case reason code when failed, e.g. "invalid_cbor", "recipient_mismatch" */
  reason?: string;
  /** Debug info: expected vs actual values, CBOR details, etc. */
  details?: Record<string, unknown>;
}

/**
 * Verification context assembled by the route handler from the parsed
 * request plus runtime dependencies. Passed to each VerifyCheck function.
 *
 * Carries everything a check needs -- no separate VerifyDeps interface.
 */
export interface VerifyContext {
  /** Payment scheme (always "exact" for now) */
  scheme: string;
  /** CAIP-2 chain ID, e.g. "cardano:preview" */
  network: string;
  /** Bech32 recipient address from PaymentRequirements */
  payTo: string;
  /** Required lovelace amount (converted from string to bigint) */
  requiredAmount: bigint;
  /** Maximum timeout in seconds from PaymentRequirements */
  maxTimeoutSeconds: number;
  /** Base64-encoded signed CBOR from CardanoPayload.transaction */
  transactionCbor: string;
  /** Payer address from CardanoPayload.payer, if provided */
  payerAddress?: string;
  /** Timestamp (Date.now()) when the request arrived */
  requestedAt: number;
  /** Injected from ChainProvider: resolves current slot number */
  getCurrentSlot: () => Promise<number>;
  /** CAIP-2 chain ID our facilitator is configured for */
  configuredNetwork: string;
  /** Minimum acceptable fee in lovelace (from config) */
  feeMin: bigint;
  /** Maximum acceptable fee in lovelace (from config) */
  feeMax: bigint;

  /** Asset identifier: "lovelace" for ADA, or "policyId.assetNameHex" for tokens.
   *  Optional for backward compatibility -- checks default to 'lovelace' when absent. */
  asset?: string;

  /** Calculate min UTXO lovelace for an output carrying the given number of distinct assets.
   *  For ADA-only outputs, numAssets=0. For token outputs, numAssets=1+.
   *  Optional -- checkMinUtxo skips when absent (existing routes won't have it until Plan 03). */
  getMinUtxoLovelace?: (numAssets: number) => Promise<bigint>;

  /**
   * Spec-mandated nonce: UTXO reference of the form `txHash#index`.
   * checkNonce verifies this is one of the tx inputs and unspent on-chain.
   * Optional during migration; missing values are rejected when
   * `requireNonce` is true.
   */
  declaredNonce?: { txHash: string; index: number };

  /**
   * Whether the nonce field is required. When true, missing nonces are
   * rejected with `nonce_required`. When false (legacy clients), checkNonce
   * skips the wire-format check but still verifies UTXO inputs of the tx
   * are unspent if any nonce is declared.
   *
   * Default: derived from chain.verification.requireNonce config; defaults
   * to true to match the x402 Cardano spec.
   */
  requireNonce?: boolean;

  /**
   * Resolves whether a UTXO reference is unspent on-chain.
   * Optional callback so unit tests can inject a stub.
   * Returns true if the UTXO exists and is unspent in the current set.
   */
  isUtxoUnspent?: (txHash: string, index: number) => Promise<boolean>;

  // Pipeline state (set by earlier checks, consumed by later checks)
  /** Parsed transaction set by checkCborValid, consumed by all subsequent checks */
  _parsedTx?: DeserializedTx;
  /** Index of the matching output, set by checkRecipient */
  _matchingOutputIndex?: number;
  /** Lovelace amount of the matching output, set by checkRecipient */
  _matchingOutputAmount?: bigint;
}

/**
 * A single verification check function.
 * Receives the assembled VerifyContext and returns a CheckResult.
 * May be synchronous or asynchronous.
 */
export type VerifyCheck = (ctx: VerifyContext) => CheckResult | Promise<CheckResult>;
