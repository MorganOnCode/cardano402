// SDK-specific types and Zod schemas for x402 V2 wire format.
//
// The wire-format schemas (incl. 402-envelope schemas added in
// @cardano402/core@0.2.0) are now re-exported from core under their
// existing local names so importers (`from '../sdk/types.js'`) keep
// working unchanged.
//
// `PaymentExtensionsStatusSchema` + `PaymentResponseHeaderSchema` stay
// local because they validate the emit side (this facilitator's
// X-Payment-Response output), which intentionally never includes
// 'failed' status. Core's wider SettlementStatusSchema is used inbound.

import {
  CardanoAddressSchema,
  NetworkSchema,
  SchemeSchema,
  X402VersionSchema,
} from '@cardano402/core';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Wire-format schemas + types re-exported from @cardano402/core.
//
// Local name aliases preserve every import path used elsewhere in src/
// and tests/:
//   SupportedKindSchema      -> SupportedPaymentKindSchema (1 importer)
//   UtxoRefSchema            -> NonceSchema                (~10 importers)
//   CardanoPayloadSchema     -> CardanoPaymentPayloadSchema
// ---------------------------------------------------------------------------

export {
  UtxoRefSchema as NonceSchema,
  CardanoPayloadSchema as CardanoPaymentPayloadSchema,
  PaymentAcceptSchema,
  ResourceInfoSchema,
  PaymentRequiredResponseSchema,
  PaymentSignaturePayloadSchema,
} from '@cardano402/core';

export type {
  UtxoRef as Nonce,
  CardanoPayload as CardanoPaymentPayload,
  PaymentAccept,
  ResourceInfo,
  PaymentRequiredResponse,
  PaymentSignaturePayload,
} from '@cardano402/core';

export const SignerNetworkPatternSchema = z
  .string()
  .regex(
    /^[a-z0-9]+:(?:[a-z0-9]+|\*)$/,
    'Signer keys must be CAIP-2 chain IDs or CAIP family wildcards such as "cardano:*"'
  );

export const SupportedPaymentKindSchema = z.object({
  x402Version: X402VersionSchema,
  scheme: SchemeSchema,
  network: NetworkSchema,
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type SupportedPaymentKind = z.infer<typeof SupportedPaymentKindSchema>;

export const SupportedResponseSchema = z.object({
  kinds: z.array(SupportedPaymentKindSchema),
  extensions: z.array(z.unknown()),
  signers: z.record(SignerNetworkPatternSchema, z.array(CardanoAddressSchema)),
});
export type SupportedResponse = z.infer<typeof SupportedResponseSchema>;

// ---------------------------------------------------------------------------
// X-Payment-Response / PAYMENT-RESPONSE header (resource server -> client).
//
// Two header names, one payload. X-Payment-Response is the canonical form
// (matches base x402); PAYMENT-RESPONSE is emitted in parallel for
// compatibility with the literal Cardano spec wording.
//
// `extensions.status` is INTENTIONALLY narrow on the emit side:
//   - "confirmed" (recommended; tx is in a block)
//   - "mempool"   (tx accepted by node but not yet in a block; spec says
//                  this SHOULD NOT be used for resources with real value
//                  due to Ouroboros Praos rollback risk)
//
// This facilitator never emits 'failed'. Core's SettlementStatusSchema
// (which includes 'failed') is used inbound by SettleResponseSchema in
// ../settle/types.ts for parse tolerance against external facilitators.
// ---------------------------------------------------------------------------

export const PaymentExtensionsStatusSchema = z.enum(['confirmed', 'mempool']);

export const PaymentResponseHeaderSchema = z.object({
  success: z.boolean(),
  transaction: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'Transaction hash must be 64 lowercase hex characters'),
  network: NetworkSchema,
  payer: CardanoAddressSchema.optional(),
  errorReason: z.string().optional(),
  errorMessage: z.string().optional(),
  extensions: z
    .object({
      status: PaymentExtensionsStatusSchema.optional(),
    })
    .passthrough()
    .optional(),
});

export type PaymentExtensionsStatus = z.infer<typeof PaymentExtensionsStatusSchema>;
export type PaymentResponseHeader = z.infer<typeof PaymentResponseHeaderSchema>;
