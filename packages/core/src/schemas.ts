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
  transaction: z.string().length(64),
  paymentRequirements: PaymentRequirementsSchema,
});
export type StatusRequest = z.infer<typeof StatusRequestSchema>;
