import { z } from 'zod';

// --- Primitives ---

export const X402VersionSchema = z.literal(2);
export type X402Version = z.infer<typeof X402VersionSchema>;

export const SchemeSchema = z.literal('exact');
export type Scheme = z.infer<typeof SchemeSchema>;

export const NetworkSchema = z
  .string()
  .regex(/^[a-z0-9]+:[a-z0-9]+$/, 'Must be a CAIP-2 chain ID (e.g. "cardano:preview")');
export type Network = z.infer<typeof NetworkSchema>;

export const LovelaceAmountSchema = z
  .string()
  .regex(/^[0-9]+$/, 'Lovelace amount must be a base-10 digit string')
  .min(1);
export type LovelaceAmount = z.infer<typeof LovelaceAmountSchema>;

export const CardanoAddressSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(
    /^[\x21-\x7e]+$/,
    'Cardano address must contain only printable ASCII (no whitespace, no control chars)'
  );
export type CardanoAddress = z.infer<typeof CardanoAddressSchema>;

export const UtxoRefSchema = z
  .string()
  .regex(/^[0-9a-f]{64}#\d+$/, 'UTXO ref must be of the form txHash#index (lowercase hex)');
export type UtxoRef = z.infer<typeof UtxoRefSchema>;

export const AssetTransferMethodSchema = z.enum(['default', 'script']);
export type AssetTransferMethod = z.infer<typeof AssetTransferMethodSchema>;

// v0.1.0 widens src/settle/types.ts (which is ['confirmed','mempool']) to include 'failed' per spec.
export const SettlementStatusSchema = z.enum(['confirmed', 'mempool', 'failed']);
export type SettlementStatus = z.infer<typeof SettlementStatusSchema>;

export const VerifyErrorReasonSchema = z.string().min(1);
export type VerifyErrorReason = z.infer<typeof VerifyErrorReasonSchema>;

// --- Composed ---

export const PaymentRequirementsSchema = z
  .object({
    scheme: SchemeSchema,
    network: NetworkSchema,
    asset: z.string().default('lovelace'),
    amount: LovelaceAmountSchema,
    payTo: CardanoAddressSchema,
    maxTimeoutSeconds: z.number().int().positive(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export type PaymentRequirements = z.infer<typeof PaymentRequirementsSchema>;

export const CardanoPayloadSchema = z.object({
  transaction: z.string().min(1),
  // nonce location mirrors src/; spec wants it on PaymentRequirements - promotion deferred to v0.2.0.
  nonce: UtxoRefSchema.optional(),
  payer: CardanoAddressSchema.optional(),
});
export type CardanoPayload = z.infer<typeof CardanoPayloadSchema>;

export const PaymentPayloadSchema = z
  .object({
    x402Version: X402VersionSchema,
    resource: z
      .object({
        url: z.string(),
        description: z.string().optional(),
        mimeType: z.string().optional(),
      })
      .optional(),
    accepted: PaymentRequirementsSchema,
    payload: CardanoPayloadSchema,
    extensions: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export type PaymentPayload = z.infer<typeof PaymentPayloadSchema>;

export const VerifyResponseSchema = z.object({
  isValid: z.boolean(),
  payer: CardanoAddressSchema.optional(),
  invalidReason: VerifyErrorReasonSchema.optional(),
  invalidMessage: z.string().optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});
export type VerifyResponse = z.infer<typeof VerifyResponseSchema>;

export const SettleResponseSchema = z.object({
  success: z.boolean(),
  transaction: z.string(),
  network: NetworkSchema,
  payer: CardanoAddressSchema.optional(),
  errorReason: z.string().optional(),
  errorMessage: z.string().optional(),
  extensions: z
    .object({ status: SettlementStatusSchema.optional() })
    .passthrough()
    .optional(),
});
export type SettleResponse = z.infer<typeof SettleResponseSchema>;

export const StatusResponseSchema = z.object({
  status: z.enum(['confirmed', 'pending', 'not_found']),
  transaction: z.string(),
});
export type StatusResponse = z.infer<typeof StatusResponseSchema>;

export const SupportedKindSchema = z.object({
  x402Version: X402VersionSchema,
  scheme: z.string(),
  network: NetworkSchema,
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type SupportedKind = z.infer<typeof SupportedKindSchema>;

export const SupportedResponseSchema = z.object({
  kinds: z.array(SupportedKindSchema),
  extensions: z.array(z.unknown()),
  signers: z.record(z.string(), z.array(z.string())),
});
export type SupportedResponse = z.infer<typeof SupportedResponseSchema>;

// --- 402 envelope (client side; promoted from src/sdk/types.ts in v0.2.0) ---
//
// These four schemas describe what an x402 *client* (e.g. @cardano402/mcp-server)
// receives and parses when a resource server returns `402 Payment Required`.
// The fields stay loose (`z.string()` rather than NetworkSchema / LovelaceAmount /
// CardanoAddress) to avoid breaking existing facilitator emissions; v0.3.0 will
// tighten them alongside the nonce promotion.

export const PaymentAcceptSchema = z.object({
  scheme: z.string().default('exact'),
  network: z.string(),
  amount: z.string(),
  payTo: z.string(),
  maxTimeoutSeconds: z.number().int().positive().default(300),
  asset: z.string().default('lovelace'),
  extra: z.record(z.string(), z.unknown()).nullable().default(null),
});
export type PaymentAccept = z.infer<typeof PaymentAcceptSchema>;

export const ResourceInfoSchema = z.object({
  description: z.string(),
  mimeType: z.string().default('application/json'),
  url: z.string(),
});
export type ResourceInfo = z.infer<typeof ResourceInfoSchema>;

export const PaymentRequiredResponseSchema = z.object({
  x402Version: X402VersionSchema,
  error: z.string().nullable().default(null),
  resource: ResourceInfoSchema,
  accepts: z.array(PaymentAcceptSchema),
});
export type PaymentRequiredResponse = z.infer<typeof PaymentRequiredResponseSchema>;

export const PaymentSignaturePayloadSchema = z.object({
  x402Version: X402VersionSchema,
  accepted: PaymentAcceptSchema,
  payload: CardanoPayloadSchema,
  resource: ResourceInfoSchema,
});
export type PaymentSignaturePayload = z.infer<typeof PaymentSignaturePayloadSchema>;

// --- Request envelopes (used by FacilitatorClient; also exported) ---

export const VerifyRequestSchema = z.object({
  x402Version: X402VersionSchema,
  paymentPayload: PaymentPayloadSchema,
  paymentRequirements: PaymentRequirementsSchema,
});
export type VerifyRequest = z.infer<typeof VerifyRequestSchema>;

export const SettleRequestSchema = VerifyRequestSchema;
export type SettleRequest = z.infer<typeof SettleRequestSchema>;

export const StatusRequestSchema = z.object({
  transaction: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'Transaction hash must be 64 lowercase hex characters'),
  paymentRequirements: PaymentRequirementsSchema,
});
export type StatusRequest = z.infer<typeof StatusRequestSchema>;
