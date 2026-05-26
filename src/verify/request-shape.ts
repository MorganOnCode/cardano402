// Request body normalizer for /verify and /settle.
//
// The base x402 V2 spec defines the verify body as
//   { x402Version, paymentHeader: <base64 string>, paymentRequirements }
// while cardano402 historically used
//   { x402Version, paymentPayload: <object>,        paymentRequirements }
//
// To stay drop-in compatible with both base x402 resource servers and our
// existing clients, this module accepts either shape and normalises to the
// internal `{ x402Version, paymentPayload, paymentRequirements }` form.

import {
  Cardano402DecodeError,
  Cardano402ValidationError,
  MAX_PAYMENT_HEADER_LENGTH,
  decodePaymentHeader,
} from '@cardano402/core';
import { z } from 'zod';

import { PaymentPayloadSchema, PaymentRequirementsSchema } from './types.js';
import type { PaymentPayload, PaymentRequirements } from './types.js';

/**
 * Lenient request schema accepting either the cardano402 (`paymentPayload`)
 * or base x402 (`paymentHeader: base64`) shape. Validation of the inner
 * payload happens in `normaliseFacilitatorRequest` below so consumers get
 * structured Zod errors that point at `paymentPayload.payload.nonce` etc.
 */
export const FacilitatorRequestEnvelopeSchema = z.object({
  x402Version: z.literal(2),
  paymentRequirements: PaymentRequirementsSchema,
  paymentPayload: z.unknown().optional(),
  paymentHeader: z.string().max(MAX_PAYMENT_HEADER_LENGTH).optional(),
});

export type FacilitatorRequestEnvelope = z.infer<typeof FacilitatorRequestEnvelopeSchema>;

export interface NormalisedFacilitatorRequest {
  x402Version: 2;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

export type NormaliseError =
  | { kind: 'missing_payload'; message: string }
  | { kind: 'invalid_base64'; message: string }
  | { kind: 'invalid_json'; message: string }
  | { kind: 'invalid_payload'; message: string; issues: z.ZodIssue[] };

export type NormaliseResult =
  | { ok: true; data: NormalisedFacilitatorRequest }
  | { ok: false; error: NormaliseError };

/**
 * Normalise a parsed envelope into the canonical internal request shape.
 *
 * Resolution order:
 *  1. If both `paymentPayload` (object) and `paymentHeader` (string) are
 *     present, prefer the object form. This is unusual but we tolerate it.
 *  2. If only `paymentPayload` is present: parse against PaymentPayloadSchema.
 *  3. If only `paymentHeader` is present: base64-decode -> JSON -> Zod parse.
 *  4. If neither: return `missing_payload`.
 */
export function normaliseFacilitatorRequest(envelope: FacilitatorRequestEnvelope): NormaliseResult {
  if (envelope.paymentPayload !== undefined) {
    const parsed = PaymentPayloadSchema.safeParse(envelope.paymentPayload);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          kind: 'invalid_payload',
          message: 'paymentPayload did not match the PaymentPayload schema',
          issues: parsed.error.issues,
        },
      };
    }
    return {
      ok: true,
      data: {
        x402Version: 2,
        paymentPayload: parsed.data,
        paymentRequirements: envelope.paymentRequirements,
      },
    };
  }

  if (envelope.paymentHeader !== undefined) {
    try {
      const decoded = decodePaymentHeader(envelope.paymentHeader);
      return {
        ok: true,
        data: {
          x402Version: 2,
          paymentPayload: decoded,
          paymentRequirements: envelope.paymentRequirements,
        },
      };
    } catch (error) {
      if (error instanceof Cardano402DecodeError) {
        const message = error.message;
        return {
          ok: false,
          error: {
            kind: message.startsWith('Invalid JSON') ? 'invalid_json' : 'invalid_base64',
            message,
          },
        };
      }
      if (error instanceof Cardano402ValidationError) {
        return {
          ok: false,
          error: {
            kind: 'invalid_payload',
            message: 'Decoded paymentHeader did not match the PaymentPayload schema',
            issues: error.issues,
          },
        };
      }
      return {
        ok: false,
        error: {
          kind: 'invalid_base64',
          message: error instanceof Error ? error.message : 'paymentHeader was not valid base64',
        },
      };
    }
  }

  return {
    ok: false,
    error: {
      kind: 'missing_payload',
      message: 'Request must include either paymentPayload (object) or paymentHeader (base64).',
    },
  };
}
