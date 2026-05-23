// Settlement domain types for x402 transaction submission and confirmation.
//
// Request schemas + SettlementStatusSchema are re-exported from
// @cardano402/core. SettleResponseSchema stays local with a wider
// extensions.status enum (to accept core's 'failed' from external
// facilitators) and slightly looser network/payer fields for
// emission-tolerance.

import { SettlementStatusSchema } from '@cardano402/core';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Wire-format request schemas + the settlement-status primitive
// re-exported from @cardano402/core.
// ---------------------------------------------------------------------------

export {
  SettleRequestSchema,
  StatusRequestSchema,
  StatusResponseSchema,
  SettlementStatusSchema,
} from '@cardano402/core';

export type {
  SettleRequest,
  StatusRequest,
  StatusResponse,
  SettlementStatus,
} from '@cardano402/core';

// ---------------------------------------------------------------------------
// SettleResponseSchema -- local
//
// Two intentional divergences from core's SettleResponseSchema:
//   1. `extensions.status` widens to the full SettlementStatusSchema
//      (confirmed | mempool | failed). The facilitator never emits 'failed',
//      but the wider parse means we accept it from external facilitators.
//   2. `network` and `payer` stay as loose strings rather than core's
//      NetworkSchema / CardanoAddressSchema, matching what src/ emits today.
// ---------------------------------------------------------------------------

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
  /**
   * Protocol extensions. Status now accepts the widened enum
   * `confirmed | mempool | failed` for inbound parse tolerance.
   * The facilitator's emit path never sets 'failed'.
   */
  extensions: z
    .object({
      status: SettlementStatusSchema.optional(),
    })
    .passthrough()
    .optional(),
});

export type SettleResponse = z.infer<typeof SettleResponseSchema>;

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
 * Maps directly to the SettleResponse wire format.
 *
 * `extensions.status` follows the widened spec enum:
 *   - "confirmed" once the tx is in a block
 *   - "mempool"  if the operator has explicitly opted into mempool returns
 *                via chain.verification.confirmationMode = "allow_mempool"
 *   - "failed"   never emitted by this facilitator; reserved for inbound parse
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
  /** Spec-required extensions container */
  extensions?: {
    status?: 'confirmed' | 'mempool' | 'failed';
    [k: string]: unknown;
  };
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
