// Verification orchestrator for x402 transaction-based model
//
// Runs all VERIFICATION_CHECKS, collects errors (not fail-fast),
// and builds the x402 V2 VerifyResponse.
//
// Key behavior:
// - Iterates ALL checks even after first failure (collect-all-errors)
// - First error becomes the primary invalidReason
// - All BigInt values converted to strings before JSON serialization
// - Optional logger for success/failure reporting

import type { FastifyBaseLogger } from 'fastify';

import { VERIFICATION_CHECKS } from './checks.js';
import type { CheckResult, VerifyContext, VerifyResponse } from './types.js';

// ---------------------------------------------------------------------------
// Human-readable failure descriptions
// ---------------------------------------------------------------------------

const FAILURE_MESSAGES: Record<string, string> = {
  invalid_base64: 'Transaction data is not valid base64',
  invalid_cbor: 'Transaction CBOR could not be parsed',
  unsupported_scheme: 'Payment scheme is not supported',
  network_mismatch: 'Transaction targets the wrong network',
  recipient_mismatch: 'No output pays to the required recipient',
  amount_insufficient: 'Payment amount is less than required',
  missing_witness: 'Transaction has no signatures',
  transaction_expired: 'Transaction TTL has expired',
  unreasonable_fee: 'Transaction fee is outside acceptable bounds',
  cbor_required: 'Transaction CBOR is required for this check',
  unsupported_token: 'Token is not supported by this facilitator',
  min_utxo_insufficient: 'Output does not contain enough ADA for minimum UTXO requirement',
  nonce_required: 'payload.nonce is required by the x402 Cardano scheme',
  nonce_not_in_inputs:
    'payload.nonce does not reference any input UTXO of the signed transaction',
  nonce_utxo_spent:
    'The UTXO referenced by payload.nonce is not unspent in the current chain state',
  nonce_lookup_failed: 'Failed to query the chain for the nonce UTXO state',
  nonce_lookup_unavailable:
    'Facilitator is not configured to chain-verify the nonce UTXO',
};

/**
 * Map a CheckResult reason to a human-readable description.
 */
export function describeFailure(result: CheckResult): string {
  const reason = result.reason ?? 'unknown';
  return FAILURE_MESSAGES[reason] ?? `Verification failed: ${reason}`;
}

// ---------------------------------------------------------------------------
// Verification orchestrator
// ---------------------------------------------------------------------------

/**
 * Run all verification checks and build the VerifyResponse.
 *
 * Iterates every check in VERIFICATION_CHECKS order, awaiting each result.
 * Collects all failures (not fail-fast). Builds either a success or failure
 * response depending on whether any checks failed.
 *
 * @param ctx - Assembled verification context from the route handler
 * @param logger - Optional Fastify logger for structured logging
 * @returns VerifyResponse conforming to the x402 V2 spec
 */
export async function verifyPayment(
  ctx: VerifyContext,
  logger?: FastifyBaseLogger
): Promise<VerifyResponse> {
  const errors: CheckResult[] = [];

  for (const check of VERIFICATION_CHECKS) {
    const result = await check(ctx);
    if (!result.passed) {
      errors.push(result);
    }
  }

  const payer = ctx.payerAddress ?? undefined;

  if (errors.length === 0) {
    // Success: all checks passed
    const response: VerifyResponse = {
      isValid: true,
      payer,
      extensions: {
        scheme: ctx.scheme,
        amount: ctx.requiredAmount.toString(),
        payTo: ctx.payTo,
        txHash: ctx._parsedTx?.txHash,
      },
    };

    logger?.info({ payer, txHash: ctx._parsedTx?.txHash, scheme: ctx.scheme }, 'Payment verified');

    return response;
  }

  // Failure: one or more checks failed
  const primaryError = errors[0];
  const response: VerifyResponse = {
    isValid: false,
    invalidReason: primaryError.reason,
    invalidMessage: describeFailure(primaryError),
    payer,
    extensions: {
      errors: errors.map((e) => e.reason ?? 'unknown'),
      ...(primaryError.details ? { expected: primaryError.details } : {}),
    },
  };

  logger?.info({ payer, reasons: errors.map((e) => e.reason) }, 'Payment verification failed');

  return response;
}
