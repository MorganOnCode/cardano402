// Asset transfer method schemas for the Cardano `exact` scheme.
//
// The `extra.assetTransferMethod` field selects which transaction shape the
// facilitator expects. cardano402 supports the `default` (address-to-address)
// method end-to-end. The `script` method (Plutus V3 with applied parameters)
// is recognised at the schema level for forward compatibility but the
// verifier returns `method_not_implemented` until the parameter applier
// work lands.
//
// Spec: https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_cardano.md

import { z } from 'zod';

/**
 * The "default" asset transfer method: address-to-address payment.
 * No additional fields are required, but `extra.assetTransferMethod` may
 * be `"default"` or omitted entirely.
 */
export const DefaultExtraSchema = z
  .object({
    assetTransferMethod: z.literal('default').optional(),
  })
  .passthrough();

/**
 * The script asset transfer method: pay to a Plutus V3 script address.
 * Parameters are applied to the script during transaction building so the
 * facilitator can independently derive the address and verify the output.
 */
export const ScriptParamSchema = z.object({
  value: z.unknown(),
  type: z.enum(['bytes', 'bigint', 'bool', 'list', 'map', 'constr']),
});

export const ScriptExtraSchema = z
  .object({
    assetTransferMethod: z.literal('script'),
    /** Hex-encoded script hash (56 chars). Required if `script` is omitted. */
    scriptHash: z.string().regex(/^[0-9a-fA-F]{56}$/).optional(),
    /** Inline script body. Required if `scriptHash` is not on-chain yet. */
    script: z
      .object({
        type: z.literal('plutusV3'),
        code: z.string().min(1),
      })
      .optional(),
    /** Parameters to apply to the script during tx build. */
    parameters: z.record(z.string(), ScriptParamSchema).optional(),
  })
  .refine((v) => Boolean(v.scriptHash) || Boolean(v.script), {
    message: 'At least one of scriptHash or script must be provided',
  });

/**
 * Discriminated union over supported methods. Use this when validating
 * `paymentRequirements.extra` with knowledge of the method.
 *
 * NOTE: We do not put this directly on PaymentAcceptSchema's `extra` field
 * yet because that field accepts arbitrary records for forward compatibility.
 * Instead, the verifier branches at runtime on `extra.assetTransferMethod`.
 */
export const AssetTransferExtraSchema = z.discriminatedUnion('assetTransferMethod', [
  // Default needs to provide `assetTransferMethod` as a literal for discrim
  // purposes. The wire-level `default | absent` semantics are handled by the
  // route handler that normalises absence to "default" before parsing.
  DefaultExtraSchema.extend({ assetTransferMethod: z.literal('default') }),
  ScriptExtraSchema,
]);

export type DefaultExtra = z.infer<typeof DefaultExtraSchema>;
export type ScriptExtra = z.infer<typeof ScriptExtraSchema>;
export type AssetTransferExtra = z.infer<typeof AssetTransferExtraSchema>;

/**
 * Resolve `assetTransferMethod` from a PaymentRequirements `extra` record.
 *
 * Returns one of:
 *   - "default":  address-to-address payment (also returned when `extra` is
 *                 absent or its `assetTransferMethod` is missing).
 *   - "script":   Plutus V3 script payment (recognised, not implemented).
 *   - "unknown":  any other literal. Treated as a hard error by the route
 *                 layer; we will not silently re-interpret an unknown method
 *                 as the default because doing so could cause a payment to
 *                 land in a way the client did not intend.
 */
export function resolveAssetTransferMethod(
  extra: Record<string, unknown> | null | undefined
): 'default' | 'script' | 'unknown' {
  if (!extra) return 'default';
  const method = extra.assetTransferMethod;
  if (method === undefined || method === null || method === 'default') return 'default';
  if (method === 'script') return 'script';
  return 'unknown';
}
