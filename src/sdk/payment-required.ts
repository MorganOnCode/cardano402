// 402 Payment Required response builder for x402 V2.
//
// The resource server sends a 402 response with the Payment-Required header
// containing base64-encoded JSON that tells the client what payment is needed.

import {
  CardanoAddressSchema,
  LovelaceAmountSchema,
  NetworkSchema,
  SchemeSchema,
} from '@cardano402/core';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';

import type { PaymentAccept, PaymentRequiredResponse, ResourceInfo } from './types.js';

export const MAX_PAYMENT_REQUIRED_TIMEOUT_SECONDS = 3600;

const PaymentRequiredQuoteSchema = z.object({
  scheme: SchemeSchema,
  network: NetworkSchema,
  amount: LovelaceAmountSchema,
  payTo: CardanoAddressSchema,
  asset: z.string().min(1),
  maxTimeoutSeconds: z.number().int().min(1).max(MAX_PAYMENT_REQUIRED_TIMEOUT_SECONDS),
});

export interface PaymentRequiredOptions {
  /** CAIP-2 chain ID (e.g. "cardano:preview") */
  network: string;
  /** Amount in smallest unit as string (e.g. "2000000" for 2 ADA) */
  amount: string;
  /** Bech32 recipient address */
  payTo: string;
  /** Payment scheme (default: "exact") */
  scheme?: 'exact';
  /** Asset identifier (default: "lovelace") */
  asset?: string;
  /** Max timeout in seconds (default: 300) */
  maxTimeoutSeconds?: number;
  /** Resource description for the client */
  description?: string;
  /** Resource MIME type (default: "application/json") */
  mimeType?: string;
  /** Resource URL */
  url?: string;
  /** Error message to include in the 402 response */
  error?: string | null;
}

export function validatePaymentRequiredOptions(
  options: PaymentRequiredOptions
): PaymentRequiredOptions {
  const quote = PaymentRequiredQuoteSchema.parse({
    scheme: options.scheme ?? 'exact',
    network: options.network,
    amount: options.amount,
    payTo: options.payTo,
    maxTimeoutSeconds: options.maxTimeoutSeconds ?? 300,
    asset: options.asset ?? 'lovelace',
  });

  return {
    ...options,
    ...quote,
  };
}

/**
 * Build the base64-encoded Payment-Required header value.
 * This is the core function that constructs the x402 V2 402 response payload.
 */
export function buildPaymentRequired(options: PaymentRequiredOptions): string {
  const quote = validatePaymentRequiredOptions(options);

  const accepted: PaymentAccept = {
    scheme: quote.scheme ?? 'exact',
    network: quote.network,
    amount: quote.amount,
    payTo: quote.payTo,
    maxTimeoutSeconds: quote.maxTimeoutSeconds ?? 300,
    asset: quote.asset ?? 'lovelace',
    extra: null,
  };

  const resource: ResourceInfo = {
    description: options.description ?? 'Payment required',
    mimeType: options.mimeType ?? 'application/json',
    url: options.url ?? '',
  };

  const response: PaymentRequiredResponse = {
    x402Version: 2,
    error: options.error ?? null,
    resource,
    accepts: [accepted],
  };

  return Buffer.from(JSON.stringify(response)).toString('base64');
}

/**
 * Send an HTTP 402 Payment Required response with the Payment-Required header.
 *
 * Per x402 V2 spec: the payment requirements go in the header (base64),
 * and the body is empty.
 */
export function reply402(reply: FastifyReply, options: PaymentRequiredOptions): void {
  const headerValue = buildPaymentRequired(options);
  void reply.status(402).header('Payment-Required', headerValue).send();
}
