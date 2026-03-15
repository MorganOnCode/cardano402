// Verification domain types for x402 V2 transaction-based model
//
// Key design: NO nonces, NO COSE/CIP-8, NO signData payloads.
// The client builds and signs a full Cardano transaction; the facilitator
// parses CBOR, verifies outputs (recipient + amount), then submits.
// UTXO-based replay protection is inherent (each UTXO can only be spent once).

import { z } from 'zod';

import type { DeserializedTx } from './cbor.js';
import type { CardanoNetwork } from '../chain/types.js';

// ---------------------------------------------------------------------------
// CAIP-2 Chain ID Constants
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
// x402 V2 Wire Format Schemas (Zod)
// ---------------------------------------------------------------------------

/**
 * PaymentRequirements -- what the resource server requires for payment.
 * Sent in the 402 response to the client.
 */
export const PaymentRequirementsSchema = z
  .object({
    /** Only supported payment scheme */
    scheme: z.literal('exact'),
    /** CAIP-2 chain ID, e.g. "cardano:preview" */
    network: z.string().regex(/^[a-z0-9]+:[a-z0-9]+$/, 'Must be a valid CAIP-2 chain ID'),
    /** Asset identifier ("lovelace" for ADA, "policyId.assetNameHex" for tokens) */
    asset: z.string().default('lovelace'),
    /** Payment amount in smallest unit as string (BigInt-safe for JSON) */
    amount: z.string().min(1),
    /** Bech32 Cardano address of the payment recipient */
    payTo: z.string().min(1),
    /** Maximum time in seconds the payment is valid */
    maxTimeoutSeconds: z.number().int().positive(),
    /** Extensible metadata per x402 V2 spec */
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/**
 * CardanoPayload -- what the client sends as the payment payload.
 * Transaction-based model: the client builds and signs the full tx.
 */
export const CardanoPayloadSchema = z.object({
  /** Base64-encoded signed CBOR transaction */
  transaction: z.string().min(1),
  /** Bech32 address of the payer (declared by client, optional) */
  payer: z.string().optional(),
});

/**
 * PaymentPayload -- full payment payload wrapper per x402 V2 spec.
 * Contains the accepted payment requirements and scheme-specific payload.
 */
export const PaymentPayloadSchema = z
  .object({
    /** x402 protocol version */
    x402Version: z.literal(2),
    /** Resource being accessed (optional per spec) */
    resource: z
      .object({
        url: z.string(),
        description: z.string().optional(),
        mimeType: z.string().optional(),
      })
      .optional(),
    /** The PaymentRequirements the client chose to fulfill */
    accepted: PaymentRequirementsSchema,
    /** Cardano-specific payload */
    payload: CardanoPayloadSchema,
    /** Protocol extensions data */
    extensions: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/**
 * VerifyRequest -- POST /verify request body.
 */
export const VerifyRequestSchema = z.object({
  x402Version: z.literal(2),
  paymentPayload: PaymentPayloadSchema,
  paymentRequirements: PaymentRequirementsSchema,
});

/**
 * VerifyResponse -- the response shape from /verify.
 * Used for documentation and test assertions; not validated at runtime.
 *
 * NOTE: Response uses `extensions` (not `extra`) per x402 V2 spec distinction:
 * - PaymentRequirements uses `extra`
 * - VerifyResponse uses `extensions`
 */
export const VerifyResponseSchema = z.object({
  /** Whether the payment is valid */
  isValid: z.boolean(),
  /** Bech32 address of the payer (resolved from transaction) */
  payer: z.string().optional(),
  /** Snake_case reason code when isValid is false */
  invalidReason: z.string().optional(),
  /** Human-readable description when isValid is false */
  invalidMessage: z.string().optional(),
  /** Extensible metadata in the response */
  extensions: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Inferred TypeScript types from Zod schemas
// ---------------------------------------------------------------------------

export type PaymentRequirements = z.infer<typeof PaymentRequirementsSchema>;
export type CardanoPayload = z.infer<typeof CardanoPayloadSchema>;
export type PaymentPayload = z.infer<typeof PaymentPayloadSchema>;
export type VerifyRequest = z.infer<typeof VerifyRequestSchema>;
export type VerifyResponse = z.infer<typeof VerifyResponseSchema>;

// ---------------------------------------------------------------------------
// Internal Types (plain TypeScript -- no Zod)
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
