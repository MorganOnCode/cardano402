// Settlement domain types for x402 transaction submission and confirmation.
//
// Key design: The client builds and signs the full Cardano transaction;
// the facilitator re-verifies, submits raw CBOR to Blockfrost, polls for
// on-chain confirmation, and returns the result. No facilitator signing.

import { z } from 'zod';

import { PaymentPayloadSchema, PaymentRequirementsSchema } from '../verify/types.js';

// ---------------------------------------------------------------------------
// x402 Settlement Wire Format Schemas (Zod)
// ---------------------------------------------------------------------------

/**
 * SettleRequest -- POST /settle request body.
 * Same shape as /verify per V2 spec: paymentPayload + paymentRequirements.
 */
export const SettleRequestSchema = z.object({
  /** x402 protocol version */
  x402Version: z.literal(2),
  /** Full payment payload (same as /verify) */
  paymentPayload: PaymentPayloadSchema,
  /** Payment requirements (same as /verify) */
  paymentRequirements: PaymentRequirementsSchema,
});

/**
 * SettleResponse -- POST /settle response.
 * Aligned with upstream x402 V2 spec.
 */
export const SettleResponseSchema = z.object({
  /** Whether settlement succeeded */
  success: z.boolean(),
  /** Transaction hash (required -- empty string on failure) */
  transaction: z.string(),
  /** CAIP-2 chain ID (required) */
  network: z.string(),
  /** Address of the payer's wallet */
  payer: z.string().optional(),
  /** Error reason code (present on failure) */
  errorReason: z.string().optional(),
  /** Human-readable error message (present on failure) */
  errorMessage: z.string().optional(),
  /** Protocol extensions data */
  extensions: z.record(z.string(), z.unknown()).optional(),
});

/**
 * StatusRequest -- POST /status request body.
 * Accepts a tx hash (64-char hex) and payment requirements for context.
 */
export const StatusRequestSchema = z.object({
  /** Transaction hash (hex string, always 64 chars) */
  transaction: z.string().length(64),
  /** Payment requirements for context */
  paymentRequirements: PaymentRequirementsSchema,
});

/**
 * StatusResponse -- POST /status response.
 */
export const StatusResponseSchema = z.object({
  /** Confirmation status */
  status: z.enum(['confirmed', 'pending', 'not_found']),
  /** Transaction hash (echo) */
  transaction: z.string(),
});

// ---------------------------------------------------------------------------
// Inferred TypeScript types from Zod schemas
// ---------------------------------------------------------------------------

export type SettleRequest = z.infer<typeof SettleRequestSchema>;
export type SettleResponse = z.infer<typeof SettleResponseSchema>;
export type StatusRequest = z.infer<typeof StatusRequestSchema>;
export type StatusResponse = z.infer<typeof StatusResponseSchema>;

// ---------------------------------------------------------------------------
// Internal Types (plain TypeScript -- no Zod)
// ---------------------------------------------------------------------------

/**
 * Settlement record persisted in Redis for idempotency/dedup.
 * Key: `settle:<sha256hex>` with 24-hour TTL.
 */
export interface SettlementRecord {
  /** Transaction hash returned by Blockfrost on submission */
  txHash: string;
  /** Current settlement status */
  status: 'submitted' | 'confirmed' | 'timeout' | 'failed';
  /** Unix ms timestamp when submitted to Blockfrost */
  submittedAt: number;
  /** Unix ms timestamp when confirmed on-chain (set on confirmation) */
  confirmedAt?: number;
  /** Failure reason if status is 'failed' */
  reason?: string;
}

/**
 * Return type of the settlePayment() orchestrator.
 * Maps directly to the SettleResponse wire format (V2 aligned).
 */
export interface SettleResult {
  /** Whether settlement succeeded */
  success: boolean;
  /** Transaction hash (empty string on failure) */
  transaction: string;
  /** CAIP-2 chain ID */
  network: string;
  /** Address of the payer's wallet */
  payer?: string;
  /** Error reason code on failure */
  errorReason?: string;
  /** Human-readable error message on failure */
  errorMessage?: string;
}

/**
 * Subset of Blockfrost tx_content response needed for settlement confirmation.
 * Derived from @blockfrost/openapi components['schemas']['tx_content'].
 */
export interface TxInfo {
  /** Transaction hash */
  hash: string;
  /** Block hash */
  block: string;
  /** Block height */
  block_height: number;
  /** Block time (Unix timestamp) */
  block_time: number;
  /** Slot number */
  slot: number;
  /** Transaction index within block */
  index: number;
  /** Fee in lovelace (as string) */
  fees: string;
  /** Whether the contract executed successfully */
  valid_contract: boolean;
}
