// SDK-specific types and Zod schemas for x402 V2 wire format.
//
// These types define the structures that flow between client, resource server,
// and facilitator -- specifically the Payment-Required header (402 response),
// the Payment-Signature header (client payment), and the /supported response.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// /supported response (PROT-03)
// ---------------------------------------------------------------------------

export const SupportedPaymentKindSchema = z.object({
  // Spec pins x402 protocol to v2; older clients should be rejected loudly.
  x402Version: z.literal(2),
  scheme: z.string(),
  network: z.string(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const SupportedResponseSchema = z.object({
  kinds: z.array(SupportedPaymentKindSchema),
  extensions: z.array(z.unknown()),
  signers: z.record(z.string(), z.array(z.string())),
});

export type SupportedPaymentKind = z.infer<typeof SupportedPaymentKindSchema>;
export type SupportedResponse = z.infer<typeof SupportedResponseSchema>;

// ---------------------------------------------------------------------------
// Payment-Required header (402 response, resource server -> client)
// ---------------------------------------------------------------------------

/** A single accepted payment option in the 402 response */
export const PaymentAcceptSchema = z.object({
  scheme: z.string().default('exact'),
  network: z.string(),
  amount: z.string(),
  payTo: z.string(),
  maxTimeoutSeconds: z.number().int().positive().default(300),
  asset: z.string().default('lovelace'),
  extra: z.record(z.string(), z.unknown()).nullable().default(null),
});

export const ResourceInfoSchema = z.object({
  description: z.string(),
  mimeType: z.string().default('application/json'),
  url: z.string(),
});

export const PaymentRequiredResponseSchema = z.object({
  x402Version: z.literal(2),
  error: z.string().nullable().default(null),
  resource: ResourceInfoSchema,
  accepts: z.array(PaymentAcceptSchema),
});

export type PaymentAccept = z.infer<typeof PaymentAcceptSchema>;
export type ResourceInfo = z.infer<typeof ResourceInfoSchema>;
export type PaymentRequiredResponse = z.infer<typeof PaymentRequiredResponseSchema>;

// ---------------------------------------------------------------------------
// Payment-Signature header (client -> resource server)
// ---------------------------------------------------------------------------

/**
 * Nonce for the Cardano `exact` scheme: a UTXO reference of the form
 * `txHash#index`. Per the x402 Cardano spec, this UTXO MUST be included as
 * an input in the signed transaction and MUST be unspent in the current
 * UTXO set when verified.
 *
 * Spec: https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_cardano.md
 */
export const NonceSchema = z
  .string()
  .regex(/^[0-9a-f]{64}#\d+$/, 'nonce must be of the form txHash#index (lowercase hex hash)')
  .describe(
    'UTXO reference (txHash#index) that MUST be consumed as a tx input and MUST be unspent'
  );

export const CardanoPaymentPayloadSchema = z.object({
  transaction: z.string().min(1),
  /**
   * REQUIRED per spec: a `txHash#index` UTXO reference that must be one of
   * the transaction's inputs and must be currently unspent. Replay protection.
   * Made optional only to support staged migration; verifier rejects when
   * absent if `requireNonce` is enabled in chain.verification config.
   */
  nonce: NonceSchema.optional(),
  payer: z.string().optional(),
});

export const PaymentSignaturePayloadSchema = z.object({
  x402Version: z.literal(2),
  accepted: PaymentAcceptSchema,
  payload: CardanoPaymentPayloadSchema,
  resource: ResourceInfoSchema,
});

export type PaymentSignaturePayload = z.infer<typeof PaymentSignaturePayloadSchema>;

// ---------------------------------------------------------------------------
// X-Payment-Response / PAYMENT-RESPONSE header (resource server -> client).
//
// Two header names, one payload. X-Payment-Response is the canonical form
// (matches base x402); PAYMENT-RESPONSE is emitted in parallel for
// compatibility with the literal Cardano spec wording.
//
// `extensions.status` per the Cardano spec is one of:
//   - "confirmed" (recommended; tx is in a block)
//   - "mempool"   (tx accepted by node but not yet in a block; spec says
//                  this SHOULD NOT be used for resources with real value
//                  due to Ouroboros Praos rollback risk)
// ---------------------------------------------------------------------------

export const PaymentExtensionsStatusSchema = z.enum(['confirmed', 'mempool']);

export const PaymentResponseHeaderSchema = z.object({
  success: z.boolean(),
  transaction: z.string(),
  network: z.string(),
  payer: z.string().optional(),
  errorReason: z.string().optional(),
  errorMessage: z.string().optional(),
  extensions: z
    .object({
      status: PaymentExtensionsStatusSchema.optional(),
    })
    .passthrough()
    .optional(),
});

export type PaymentResponseHeader = z.infer<typeof PaymentResponseHeaderSchema>;
export type PaymentExtensionsStatus = z.infer<typeof PaymentExtensionsStatusSchema>;
