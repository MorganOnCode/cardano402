import { PaymentPayloadSchema, type PaymentPayload } from './schemas.js';
import {
  Cardano402DecodeError,
  Cardano402ValidationError,
} from './errors.js';

// --- Request header names ---

export const PAYMENT_REQUEST_HEADER = 'Payment-Signature' as const;
export const PAYMENT_REQUEST_HEADER_ALIAS = 'X-PAYMENT' as const;
export const PAYMENT_REQUEST_HEADER_NAMES = [
  PAYMENT_REQUEST_HEADER,
  PAYMENT_REQUEST_HEADER_ALIAS,
] as const;

// --- Response header names ---

export const PAYMENT_REQUIRED_HEADER = 'Payment-Required' as const;
export const PAYMENT_RESPONSE_HEADER = 'X-Payment-Response' as const;
export const PAYMENT_RESPONSE_HEADER_ALIAS = 'PAYMENT-RESPONSE' as const;
export const PAYMENT_RESPONSE_HEADER_NAMES = [
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_RESPONSE_HEADER_ALIAS,
] as const;

// --- Codec ---

export function encodePaymentHeader(payload: PaymentPayload): string {
  const parsed = PaymentPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Cardano402ValidationError(
      'encodePaymentHeader: payload failed PaymentPayloadSchema',
      parsed.error.issues
    );
  }
  const json = JSON.stringify(parsed.data);
  const bytes = new TextEncoder().encode(json);
  return base64EncodeBytes(bytes);
}

export function decodePaymentHeader(headerValue: string): PaymentPayload {
  let json: string;
  try {
    const bytes = base64DecodeToBytes(headerValue);
    json = new TextDecoder().decode(bytes);
  } catch (err) {
    throw new Cardano402DecodeError(
      `Invalid base64 in payment header: ${(err as Error).message}`,
      { cause: err }
    );
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(json);
  } catch (err) {
    throw new Cardano402DecodeError(
      `Invalid JSON in payment header: ${(err as Error).message}`,
      { cause: err }
    );
  }
  const result = PaymentPayloadSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new Cardano402ValidationError(
      'Decoded payment header did not match PaymentPayloadSchema',
      result.error.issues
    );
  }
  return result.data;
}

export function findPaymentHeader(
  headers: Headers | Record<string, string | string[] | undefined>
): string | null {
  const get = (name: string): string | null => {
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
      return headers.get(name);
    }
    const obj = headers as Record<string, string | string[] | undefined>;
    const lc = name.toLowerCase();
    for (const key of Object.keys(obj)) {
      if (key.toLowerCase() === lc) {
        const v = obj[key];
        if (Array.isArray(v)) return v[0] ?? null;
        return v ?? null;
      }
    }
    return null;
  };
  for (const name of PAYMENT_REQUEST_HEADER_NAMES) {
    const v = get(name);
    if (v) return v;
  }
  return null;
}

// --- Internal base64 helpers ---

function base64EncodeBytes(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64DecodeToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}
