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
  x402Version: z.number(),
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

export const CardanoPaymentPayloadSchema = z.object({
  transaction: z.string().min(1),
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
// X-Payment-Response header (resource server -> client, after settlement)
// Aligned with V2 SettleResponse schema.
// ---------------------------------------------------------------------------

export const PaymentResponseHeaderSchema = z.object({
  success: z.boolean(),
  transaction: z.string(),
  network: z.string(),
  payer: z.string().optional(),
  errorReason: z.string().optional(),
  errorMessage: z.string().optional(),
});

export type PaymentResponseHeader = z.infer<typeof PaymentResponseHeaderSchema>;
