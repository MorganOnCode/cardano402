// Verification check functions for x402 transaction-based model
//
// Ten individual checks that examine one aspect of a Cardano transaction
// against the payment requirements. Together they form the verification
// pipeline consumed by the orchestrator (Plan 03).
//
// Each check receives a VerifyContext and returns a CheckResult.
// Checks share pipeline state via mutable ctx fields (_parsedTx, etc.).

import { CML } from '@lucid-evolution/lucid';

import { deserializeTransaction } from './cbor.js';
import { parseNonce } from './nonce.js';
import { SUPPORTED_TOKENS, LOVELACE_UNIT, assetToUnit } from './token-registry.js';
import { CAIP2_TO_NETWORK_ID } from './types.js';
import type { CheckResult, VerifyCheck, VerifyContext } from './types.js';

// ---------------------------------------------------------------------------
// Check 1: CBOR validity
// ---------------------------------------------------------------------------

/**
 * Validate that the base64 CBOR can be deserialized into a transaction.
 * On success, stores the parsed transaction on ctx._parsedTx for later checks.
 */
export function checkCborValid(ctx: VerifyContext): CheckResult {
  try {
    ctx._parsedTx = deserializeTransaction(ctx.transactionCbor);
    return { check: 'cbor_valid', passed: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    // Distinguish base64 errors from CBOR parse errors
    if (message.toLowerCase().includes('base64')) {
      return { check: 'cbor_valid', passed: false, reason: 'invalid_base64' };
    }

    return {
      check: 'cbor_valid',
      passed: false,
      reason: 'invalid_cbor',
      details: { error: message },
    };
  }
}

// ---------------------------------------------------------------------------
// Check 2: Payment scheme
// ---------------------------------------------------------------------------

/**
 * Validate that the payment scheme is 'exact' (the only scheme we support).
 */
export function checkScheme(ctx: VerifyContext): CheckResult {
  if (ctx.scheme === 'exact') {
    return { check: 'scheme', passed: true };
  }
  return {
    check: 'scheme',
    passed: false,
    reason: 'unsupported_scheme',
    details: { scheme: ctx.scheme },
  };
}

// ---------------------------------------------------------------------------
// Check 3: Network match
// ---------------------------------------------------------------------------

/**
 * Validate that the request network matches the configured network and
 * that transaction output addresses target the expected Cardano network.
 */
export function checkNetwork(ctx: VerifyContext): CheckResult {
  if (!ctx._parsedTx) {
    return { check: 'network', passed: false, reason: 'cbor_required' };
  }

  // CAIP-2 chain ID must match configured network
  if (ctx.network !== ctx.configuredNetwork) {
    return {
      check: 'network',
      passed: false,
      reason: 'network_mismatch',
      details: { expected: ctx.configuredNetwork, actual: ctx.network },
    };
  }

  // Transaction network ID must match expected network ID for the CAIP-2 chain
  const expectedNetworkId = CAIP2_TO_NETWORK_ID[ctx.configuredNetwork];
  const txNetworkId = ctx._parsedTx.body.networkId;

  if (expectedNetworkId !== undefined && txNetworkId !== expectedNetworkId) {
    return {
      check: 'network',
      passed: false,
      reason: 'network_mismatch',
      details: {
        expected: expectedNetworkId,
        actual: txNetworkId,
        message: 'Transaction addresses target a different network',
      },
    };
  }

  return { check: 'network', passed: true };
}

// ---------------------------------------------------------------------------
// Check 4: Token supported
// ---------------------------------------------------------------------------

/**
 * Validate that the requested asset is supported by this facilitator.
 * ADA ("lovelace") is always supported. Token payments must be in
 * the SUPPORTED_TOKENS registry.
 *
 * Must come BEFORE recipient check for fast rejection of unsupported tokens.
 */
export function checkTokenSupported(ctx: VerifyContext): CheckResult {
  const asset = ctx.asset ?? LOVELACE_UNIT;

  if (asset === LOVELACE_UNIT) {
    return { check: 'token_supported', passed: true };
  }

  const unit = assetToUnit(asset);
  if (SUPPORTED_TOKENS.has(unit)) {
    return { check: 'token_supported', passed: true };
  }

  return {
    check: 'token_supported',
    passed: false,
    reason: 'unsupported_token',
    details: { asset },
  };
}

// ---------------------------------------------------------------------------
// Check 5: Recipient output
// ---------------------------------------------------------------------------

/**
 * Validate that the transaction pays to the required recipient address.
 *
 * Uses canonical hex comparison (not bech32) per research pitfall #2.
 *
 * Sets ctx._matchingOutputIndex and ctx._matchingOutputAmount for downstream
 * checks. Strategy depends on the asset being paid:
 *
 * - **ADA (lovelace):** sums lovelace across ALL outputs to payTo. Spam-token
 *   attacks (first matching output carries `requiredAmount` lovelace plus an
 *   unwanted token; additional outputs route the real payment elsewhere) are
 *   neutralized because the verifier credits the recipient with the sum, not
 *   a single output's amount. _matchingOutputIndex points at the first
 *   matching output (any output works for min-utxo since each output already
 *   meets it independently per Cardano protocol).
 *
 * - **Token:** enumerates outputs to payTo and selects the first that holds
 *   at least `requiredAmount` of the asset. This means a recipient with two
 *   outputs — one with zero of the asset, one with enough — is accepted; the
 *   pre-fix behavior would lock onto the zero-asset output and fail.
 */
export function checkRecipient(ctx: VerifyContext): CheckResult {
  if (!ctx._parsedTx) {
    return { check: 'recipient', passed: false, reason: 'cbor_required' };
  }

  // Convert recipient bech32 to canonical hex for comparison. `payTo` comes
  // from caller-supplied paymentRequirements, so malformed addresses must be
  // reported as verification failures instead of escaping as public 500s.
  let recipientAddr: CML.Address;
  let recipientHex: string;
  try {
    recipientAddr = CML.Address.from_bech32(ctx.payTo);
    recipientHex = recipientAddr.to_hex();
  } catch (error) {
    return {
      check: 'recipient',
      passed: false,
      reason: 'invalid_pay_to',
      details: {
        payTo: ctx.payTo,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
  recipientAddr.free();

  const outputs = ctx._parsedTx.body.outputs;
  const asset = ctx.asset ?? LOVELACE_UNIT;

  if (asset === LOVELACE_UNIT) {
    // ADA path: sum lovelace across ALL outputs to payTo so spam-output
    // splitting can't bypass the amount check.
    let firstMatch = -1;
    let summedLovelace = 0n;
    for (let i = 0; i < outputs.length; i++) {
      if (outputs[i].addressHex === recipientHex) {
        if (firstMatch === -1) firstMatch = i;
        summedLovelace += outputs[i].lovelace;
      }
    }
    if (firstMatch === -1) {
      return {
        check: 'recipient',
        passed: false,
        reason: 'recipient_mismatch',
        details: { expected: ctx.payTo },
      };
    }
    ctx._matchingOutputIndex = firstMatch;
    ctx._matchingOutputAmount = summedLovelace;
    return { check: 'recipient', passed: true };
  }

  // Token path: pick the first output to payTo that holds enough of the
  // required asset. checkAmount and checkMinUtxo then run against THAT
  // output rather than the first-to-payTo one (which could carry 0 tokens
  // as a spam-output decoy).
  const unit = assetToUnit(asset);
  let firstMatchTo = -1;
  for (let i = 0; i < outputs.length; i++) {
    if (outputs[i].addressHex !== recipientHex) continue;
    if (firstMatchTo === -1) firstMatchTo = i;
    const tokenAmount = outputs[i].assets[unit] ?? 0n;
    if (tokenAmount >= ctx.requiredAmount) {
      ctx._matchingOutputIndex = i;
      ctx._matchingOutputAmount = outputs[i].lovelace;
      return { check: 'recipient', passed: true };
    }
  }

  if (firstMatchTo === -1) {
    return {
      check: 'recipient',
      passed: false,
      reason: 'recipient_mismatch',
      details: { expected: ctx.payTo },
    };
  }

  // We did find outputs to payTo, but none had enough of the required asset.
  // Surface this through checkAmount by pointing at the first matching output
  // so its asset map is reported in the failure details.
  ctx._matchingOutputIndex = firstMatchTo;
  ctx._matchingOutputAmount = outputs[firstMatchTo].lovelace;
  return { check: 'recipient', passed: true };
}

// ---------------------------------------------------------------------------
// Check 6: Payment amount (ADA or token)
// ---------------------------------------------------------------------------

/**
 * Validate that the recipient receives at least the required amount.
 *
 * ADA path: reads ctx._matchingOutputAmount, which checkRecipient has
 * populated with the SUM of lovelace across all outputs to payTo (so spam-
 * output splitting can't sneak partial payments past the threshold).
 *
 * Token path: looks up the token quantity in the matched output's assets
 * map. checkRecipient already selected an output that holds enough of the
 * asset, so a pass here just re-confirms; a failure indicates the recipient
 * received outputs to their address but none with the required token
 * quantity.
 *
 * Overpayment allowed (>=) for both ADA and tokens.
 */
export function checkAmount(ctx: VerifyContext): CheckResult {
  // Determine the effective asset (default to lovelace for backward compat)
  const asset = ctx.asset ?? LOVELACE_UNIT;

  if (asset === LOVELACE_UNIT) {
    // ADA payment: use existing _matchingOutputAmount (set by checkRecipient)
    // This preserves backward compatibility with existing test mocks
    if (ctx._matchingOutputAmount === undefined) {
      return {
        check: 'amount',
        passed: false,
        reason: 'amount_insufficient',
        details: { error: 'no matching output found' },
      };
    }
    if (ctx._matchingOutputAmount >= ctx.requiredAmount) {
      return { check: 'amount', passed: true };
    }
    return {
      check: 'amount',
      passed: false,
      reason: 'amount_insufficient',
      details: {
        expected: ctx.requiredAmount.toString(),
        actual: ctx._matchingOutputAmount.toString(),
      },
    };
  }

  // Token payment: must use _parsedTx to access the assets map
  if (ctx._matchingOutputIndex === undefined || !ctx._parsedTx) {
    return {
      check: 'amount',
      passed: false,
      reason: 'amount_insufficient',
      details: { error: 'no matching output found' },
    };
  }

  const output = ctx._parsedTx.body.outputs[ctx._matchingOutputIndex];
  const unit = assetToUnit(asset);
  const tokenAmount = output.assets[unit] ?? 0n;
  if (tokenAmount >= ctx.requiredAmount) {
    return { check: 'amount', passed: true };
  }
  return {
    check: 'amount',
    passed: false,
    reason: 'amount_insufficient',
    details: {
      expected: ctx.requiredAmount.toString(),
      actual: tokenAmount.toString(),
      asset,
    },
  };
}

// ---------------------------------------------------------------------------
// Check 7: Min UTXO ADA
// ---------------------------------------------------------------------------

/**
 * Validate that the recipient output contains enough ADA for the min UTXO requirement.
 * Applies to ALL payments (ADA and token). Token outputs require more ADA due to
 * multi-asset serialization overhead.
 *
 * Uses ChainProvider.getMinUtxoLovelace(numAssets) via the ctx callback.
 * The error includes the required amount so clients can fix their transaction.
 *
 * If ctx.getMinUtxoLovelace is not provided (optional field), the check passes
 * with a skip -- this allows existing routes to work before Plan 03 wires it in.
 */
export async function checkMinUtxo(ctx: VerifyContext): Promise<CheckResult> {
  // Skip if callback not provided (backward compat until Plan 03 wires it)
  if (!ctx.getMinUtxoLovelace) {
    return { check: 'min_utxo', passed: true };
  }

  if (ctx._matchingOutputIndex === undefined || !ctx._parsedTx) {
    return { check: 'min_utxo', passed: false, reason: 'cbor_required' };
  }

  const output = ctx._parsedTx.body.outputs[ctx._matchingOutputIndex];
  const numAssets = Object.keys(output.assets).length;
  const requiredMinAda = await ctx.getMinUtxoLovelace(numAssets);

  if (output.lovelace >= requiredMinAda) {
    return { check: 'min_utxo', passed: true };
  }

  return {
    check: 'min_utxo',
    passed: false,
    reason: 'min_utxo_insufficient',
    details: {
      required: requiredMinAda.toString(),
      actual: output.lovelace.toString(),
      message: `min UTXO requires ${requiredMinAda.toString()} lovelace, got ${output.lovelace.toString()}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Check 8: Witness presence (NOT cryptographic verification)
// ---------------------------------------------------------------------------

/**
 * Pre-filter that the transaction has at least one VKey witness present in
 * the witness set. This is NOT a cryptographic signature check — it only
 * confirms the witness slot is non-empty.
 *
 * Cryptographic signature validation (vkey ↔ payment address, signature ↔
 * tx hash) is performed by Cardano nodes when the tx is submitted via
 * Blockfrost. A tx that passes this presence check but carries garbage
 * vkey/signature bytes will still be rejected by the chain — by design,
 * this function does not duplicate that work.
 *
 * Renamed from `checkWitness` in PR audit-H3 to make the limited contract
 * obvious to readers and to lock in that future "improve witness check"
 * PRs MUST either (a) implement real Ed25519 verification via libsodium,
 * or (b) leave this presence check alone — silently adding a buggy
 * signer-identity check here would let an attacker forge "valid" payments.
 */
export function checkWitnessPresent(ctx: VerifyContext): CheckResult {
  if (!ctx._parsedTx) {
    return { check: 'witness', passed: false, reason: 'cbor_required' };
  }

  if (ctx._parsedTx.hasWitnesses) {
    return { check: 'witness', passed: true };
  }

  return { check: 'witness', passed: false, reason: 'missing_witness' };
}

// ---------------------------------------------------------------------------
// Check 9: TTL (validity interval)
// ---------------------------------------------------------------------------

/**
 * Validate that the transaction TTL is present, not expired, and consistent
 * with PaymentRequirements.maxTimeoutSeconds.
 *
 * A transaction with no TTL is valid indefinitely on-chain. That is a poor
 * fit for x402 because the payment instrument can be replayed or submitted
 * long after the resource server's quoted payment window. Fail closed.
 *
 * The Cardano spec says TTL MUST not be in the past and SHOULD be consistent
 * with maxTimeoutSeconds. For a money-handling facilitator, enforce the SHOULD:
 * currentSlot + maxTimeoutSeconds + graceBufferSeconds is the latest allowed
 * TTL. Cardano slots are approximately one second on current public networks,
 * so the config field is treated as slots here.
 *
 * Async because it needs to query the current slot from ChainProvider.
 */
export async function checkTtl(ctx: VerifyContext): Promise<CheckResult> {
  if (!ctx._parsedTx) {
    return { check: 'ttl', passed: false, reason: 'cbor_required' };
  }

  const { ttl } = ctx._parsedTx.body;

  if (ttl === undefined) {
    return {
      check: 'ttl',
      passed: false,
      reason: 'ttl_required',
      details: {
        message: 'Signed payment transactions must include a TTL bounded by maxTimeoutSeconds.',
      },
    };
  }

  const currentSlot = await ctx.getCurrentSlot();
  const currentSlotBig = BigInt(currentSlot);

  if (currentSlotBig > ttl) {
    return {
      check: 'ttl',
      passed: false,
      reason: 'transaction_expired',
      details: {
        ttl: ttl.toString(),
        currentSlot: currentSlot.toString(),
      },
    };
  }

  const grace = ctx.ttlGraceBufferSeconds ?? 30;
  const latestAllowedTtl = currentSlotBig + BigInt(ctx.maxTimeoutSeconds + grace);
  if (ttl > latestAllowedTtl) {
    return {
      check: 'ttl',
      passed: false,
      reason: 'transaction_ttl_too_far',
      details: {
        ttl: ttl.toString(),
        currentSlot: currentSlot.toString(),
        maxTimeoutSeconds: ctx.maxTimeoutSeconds,
        graceBufferSeconds: grace,
        latestAllowedTtl: latestAllowedTtl.toString(),
      },
    };
  }

  return { check: 'ttl', passed: true };
}

// ---------------------------------------------------------------------------
// Check 10: Fee reasonableness
// ---------------------------------------------------------------------------

/**
 * Validate that the transaction fee is within configured bounds.
 * This is a sanity check, not a precise fee calculation.
 */
export function checkFee(ctx: VerifyContext): CheckResult {
  if (!ctx._parsedTx) {
    return { check: 'fee', passed: false, reason: 'cbor_required' };
  }

  const { fee } = ctx._parsedTx.body;

  if (fee >= ctx.feeMin && fee <= ctx.feeMax) {
    return { check: 'fee', passed: true };
  }

  return {
    check: 'fee',
    passed: false,
    reason: 'unreasonable_fee',
    details: {
      fee: fee.toString(),
      min: ctx.feeMin.toString(),
      max: ctx.feeMax.toString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Check 11: Spec-mandated nonce (UTXO reference, must be tx input + unspent)
// ---------------------------------------------------------------------------

/**
 * Validate the spec-mandated `nonce` field.
 *
 * Per the x402 Cardano spec, `payload.nonce` MUST be a UTXO reference
 * (`txHash#index`) that:
 *   1. Is included as one of the transaction's inputs.
 *   2. Is unspent in the current on-chain UTXO set.
 *
 * Behaviour matrix (controlled by ctx.requireNonce, default true):
 *   - declaredNonce missing && requireNonce=true   -> reject `nonce_required`
 *   - declaredNonce missing && requireNonce=false  -> pass (legacy mode)
 *   - declaredNonce present, but doesn't match any tx input -> reject `nonce_not_in_inputs`
 *   - declaredNonce present, matches input, but isUtxoUnspent() returns false
 *       -> reject `nonce_utxo_spent`
 *   - declaredNonce present, isUtxoUnspent callback absent
 *       -> pass with warning detail (so unit tests can run without chain access)
 */
export async function checkNonce(ctx: VerifyContext): Promise<CheckResult> {
  if (!ctx._parsedTx) {
    return { check: 'nonce', passed: false, reason: 'cbor_required' };
  }

  const required = ctx.requireNonce ?? true;

  if (!ctx.declaredNonce) {
    if (required) {
      return {
        check: 'nonce',
        passed: false,
        reason: 'nonce_required',
        details: {
          message:
            'payload.nonce is required by the x402 Cardano scheme. Set chain.verification.requireNonce=false to allow legacy clients.',
        },
      };
    }
    return { check: 'nonce', passed: true, details: { skipped: 'no_nonce_declared' } };
  }

  // Nonce declared: must match a tx input.
  const { txHash, index } = ctx.declaredNonce;
  const matchesInput = ctx._parsedTx.body.inputs.some(
    (input) => input.txHash === txHash && Number(input.index) === index
  );

  if (!matchesInput) {
    return {
      check: 'nonce',
      passed: false,
      reason: 'nonce_not_in_inputs',
      details: {
        nonce: `${txHash}#${index}`,
        inputs: ctx._parsedTx.body.inputs.map((i) => `${i.txHash}#${String(i.index)}`),
      },
    };
  }

  // Nonce matches an input; verify the UTXO is unspent.
  if (!ctx.isUtxoUnspent) {
    // No callback wired. The spec is explicit: the facilitator MUST verify
    // the UTXO is unspent. In spec-compliant mode (requireNonce=true) we
    // fail closed rather than silently pass — this prevents a production
    // misconfiguration from disabling replay protection.
    if (required) {
      return {
        check: 'nonce',
        passed: false,
        reason: 'nonce_lookup_unavailable',
        details: {
          message:
            'isUtxoUnspent callback is not configured. Cannot verify the nonce UTXO is unspent as the spec requires.',
        },
      };
    }
    // Legacy mode only: surface that we did not chain-verify the UTXO.
    return {
      check: 'nonce',
      passed: true,
      details: { skipped: 'isUtxoUnspent_callback_missing' },
    };
  }

  let unspent: boolean;
  try {
    unspent = await ctx.isUtxoUnspent(txHash, index);
  } catch (error) {
    return {
      check: 'nonce',
      passed: false,
      reason: 'nonce_lookup_failed',
      details: {
        nonce: `${txHash}#${index}`,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }

  if (!unspent) {
    return {
      check: 'nonce',
      passed: false,
      reason: 'nonce_utxo_spent',
      details: { nonce: `${txHash}#${index}` },
    };
  }

  return { check: 'nonce', passed: true };
}

// Re-export parseNonce so callers (route handlers) have one import path
export { parseNonce };

// ---------------------------------------------------------------------------
// Ordered check array
// ---------------------------------------------------------------------------

/**
 * All verification checks in execution order.
 * checkCborValid MUST be first (it populates ctx._parsedTx).
 * checkTokenSupported MUST precede checkRecipient (fast rejection of unsupported tokens).
 * checkRecipient MUST precede checkAmount (it populates ctx._matchingOutputAmount).
 * checkMinUtxo MUST follow checkAmount (needs _matchingOutputIndex).
 * checkNonce MUST follow checkCborValid (needs parsed inputs).
 */
export const VERIFICATION_CHECKS: VerifyCheck[] = [
  checkCborValid, // 1. Parse CBOR
  checkScheme, // 2. Validate scheme
  checkNetwork, // 3. Validate network
  checkTokenSupported, // 4. Validate asset is supported
  checkRecipient, // 5. Find matching output
  checkAmount, // 6. Check ADA or token amount
  checkMinUtxo, // 7. Check min UTXO ADA
  checkWitnessPresent, // 8. Pre-filter that witnesses exist; chain does the crypto
  checkTtl, // 9. Check TTL not expired
  checkFee, // 10. Check fee bounds
  checkNonce, // 11. Spec-mandated nonce (replay prevention)
];
