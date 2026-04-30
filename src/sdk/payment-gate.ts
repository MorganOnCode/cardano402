// Payment gate middleware for x402 V2.
//
// Intercepts requests to protected routes and enforces payment.
// Flow: check header -> decode -> verify -> settle -> allow through.
// Implements settle-before-execution (SECU-04): payment is confirmed on-chain
// BEFORE the route handler runs.

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';

import type { FacilitatorClient } from './facilitator-client.js';
import { reply402 } from './payment-required.js';
import type { PaymentRequiredOptions } from './payment-required.js';
import { PaymentSignaturePayloadSchema } from './types.js';
import type { PaymentResponseHeader } from './types.js';

export interface PaymentGateOptions {
  /** FacilitatorClient instance for verify/settle calls */
  facilitator: FacilitatorClient;
  /** Bech32 recipient address for payments */
  payTo: string;
  /** Payment amount in smallest unit (lovelace) as string */
  amount: string;
  /** CAIP-2 chain ID (e.g. "cardano:preview") */
  network: string;
  /** Asset identifier (default: "lovelace") */
  asset?: string;
  /** Max timeout seconds (default: 300) */
  maxTimeoutSeconds?: number;
  /** Resource description for 402 response */
  description?: string;
  /** Resource MIME type (default: "application/octet-stream") */
  mimeType?: string;
}

/**
 * Decode the Payment-Signature header from a request.
 * Returns the parsed payload or null if invalid.
 */
function decodePaymentSignature(
  headerValue: string
): ReturnType<typeof PaymentSignaturePayloadSchema.safeParse> {
  try {
    const json = Buffer.from(headerValue, 'base64').toString('utf-8');
    const parsed = JSON.parse(json) as unknown;
    return PaymentSignaturePayloadSchema.safeParse(parsed);
  } catch {
    return { success: false, error: { message: 'Invalid base64 or JSON' } } as ReturnType<
      typeof PaymentSignaturePayloadSchema.safeParse
    >;
  }
}

/**
 * Create a Fastify preHandler that enforces x402 payment.
 *
 * When applied to a route, this middleware:
 * 1. Checks for the Payment-Signature header
 * 2. If absent: returns 402 with payment requirements
 * 3. If present: decodes, verifies, settles via the facilitator
 * 4. On success: attaches settlement result to request and allows through
 * 5. On failure: returns 402 with error details
 *
 * Settlement happens BEFORE the route handler (settle-before-execution per SECU-04).
 */
export function createPaymentGate(options: PaymentGateOptions): preHandlerHookHandler {
  const paymentRequiredOptions: PaymentRequiredOptions = {
    network: options.network,
    amount: options.amount,
    payTo: options.payTo,
    scheme: 'exact',
    asset: options.asset ?? 'lovelace',
    maxTimeoutSeconds: options.maxTimeoutSeconds ?? 300,
    description: options.description,
    mimeType: options.mimeType ?? 'application/octet-stream',
  };

  return async function paymentGateHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    // 1. Check for Payment-Signature header
    const paymentHeader = request.headers['payment-signature'] as string | undefined;

    if (!paymentHeader) {
      // Return 402 with payment requirements
      reply402(reply, { ...paymentRequiredOptions, url: request.url });
      return;
    }

    // 2. Decode and validate payment payload
    const decoded = decodePaymentSignature(paymentHeader);

    if (!decoded.success) {
      reply402(reply, {
        ...paymentRequiredOptions,
        url: request.url,
        error: 'Invalid Payment-Signature header',
      });
      return;
    }

    const payload = decoded.data;

    // 3. Build verify request from the payment payload
    const verifyRequest = {
      x402Version: 2 as const,
      paymentPayload: {
        x402Version: 2 as const,
        accepted: {
          scheme: 'exact' as const,
          network: payload.accepted.network,
          amount: options.amount,
          asset: options.asset ?? 'lovelace',
          payTo: options.payTo,
          maxTimeoutSeconds: options.maxTimeoutSeconds ?? 300,
        },
        payload: payload.payload,
      },
      paymentRequirements: {
        scheme: 'exact' as const,
        network: options.network,
        amount: options.amount,
        payTo: options.payTo,
        maxTimeoutSeconds: options.maxTimeoutSeconds ?? 300,
        asset: options.asset ?? 'lovelace',
      },
    };

    // 4. Verify with facilitator
    let verifyResult;
    try {
      verifyResult = await options.facilitator.verify(verifyRequest);
    } catch (error) {
      request.log.error(
        { err: error instanceof Error ? error.message : 'Unknown error' },
        'Payment verification failed'
      );
      reply402(reply, {
        ...paymentRequiredOptions,
        url: request.url,
        error: 'Payment verification failed',
      });
      return;
    }

    if (!verifyResult.isValid) {
      reply402(reply, {
        ...paymentRequiredOptions,
        url: request.url,
        error: verifyResult.invalidReason ?? 'Payment verification failed',
      });
      return;
    }

    // 5. Settle with facilitator (SECU-04: settle before execution)
    let settleResult;
    try {
      settleResult = await options.facilitator.settle({
        x402Version: 2 as const,
        paymentPayload: {
          x402Version: 2 as const,
          accepted: {
            scheme: 'exact' as const,
            network: options.network,
            amount: options.amount,
            asset: options.asset ?? 'lovelace',
            payTo: options.payTo,
            maxTimeoutSeconds: options.maxTimeoutSeconds ?? 300,
          },
          payload: payload.payload,
        },
        paymentRequirements: {
          scheme: 'exact' as const,
          network: options.network,
          amount: options.amount,
          payTo: options.payTo,
          maxTimeoutSeconds: options.maxTimeoutSeconds ?? 300,
          asset: options.asset ?? 'lovelace',
        },
      });
    } catch (error) {
      request.log.error(
        { err: error instanceof Error ? error.message : 'Unknown error' },
        'Payment settlement failed'
      );
      reply402(reply, {
        ...paymentRequiredOptions,
        url: request.url,
        error: 'Payment settlement failed',
      });
      return;
    }

    if (!settleResult.success) {
      reply402(reply, {
        ...paymentRequiredOptions,
        url: request.url,
        error: `Settlement failed: ${settleResult.errorReason ?? 'unknown'}`,
      });
      return;
    }

    // 6. Attach settlement info to request for downstream handlers
    const paymentResponse: PaymentResponseHeader = {
      success: true,
      transaction: settleResult.transaction,
      network: settleResult.network,
      // Settlement only proceeds past the gate after on-chain confirmation,
      // so we annotate the response with the spec-required extensions.status.
      extensions: { status: 'confirmed' },
    };

    // Store on request for route handlers to access
    (request as FastifyRequest & { x402Settlement?: PaymentResponseHeader }).x402Settlement =
      paymentResponse;

    // Encode once, emit under both header names. X-Payment-Response is the
    // canonical name (matches base x402); PAYMENT-RESPONSE is emitted for
    // compatibility with strict x402 Cardano spec readers and will be removed
    // in a future major version once upstream has reconciled the two specs.
    const responseHeaderValue = Buffer.from(JSON.stringify(paymentResponse)).toString('base64');
    void reply.header('X-Payment-Response', responseHeaderValue);
    void reply.header('PAYMENT-RESPONSE', responseHeaderValue);

    // Allow through to the route handler
  };
}
