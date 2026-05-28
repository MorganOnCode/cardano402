import {
  PaymentPayloadSchema,
  PaymentRequiredResponseSchema,
  PaymentSignaturePayloadSchema,
  type PaymentPayload,
  type PaymentRequiredResponse,
  type PaymentSignaturePayload,
} from './schemas.js';
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

const PROTO_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const stripProtoPollutionReviver = (key: string, value: unknown): unknown =>
  PROTO_POLLUTION_KEYS.has(key) ? undefined : value;
export const MAX_PAYMENT_HEADER_LENGTH = 16 * 1024;
const BASE64_ALPHABET_RE = /^[A-Za-z0-9+/]+={0,2}$/;

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
  const parsedJson = decodePaymentHeaderJson(headerValue);
  const result = PaymentPayloadSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new Cardano402ValidationError(
      'Decoded payment header did not match PaymentPayloadSchema',
      result.error.issues
    );
  }
  return result.data;
}

export function decodePaymentSignatureHeader(headerValue: string): PaymentSignaturePayload {
  const parsedJson = decodePaymentHeaderJson(headerValue);
  const result = PaymentSignaturePayloadSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new Cardano402ValidationError(
      'Decoded payment signature header did not match PaymentSignaturePayloadSchema',
      result.error.issues
    );
  }
  return result.data;
}

export function decodePaymentRequiredHeader(headerValue: string): PaymentRequiredResponse {
  const parsedJson = decodePaymentHeaderJson(headerValue);
  const result = PaymentRequiredResponseSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new Cardano402ValidationError(
      'Decoded Payment-Required header did not match PaymentRequiredResponseSchema',
      result.error.issues
    );
  }
  return result.data;
}

function decodePaymentHeaderJson(headerValue: string): unknown {
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
    parsedJson = JSON.parse(json, stripProtoPollutionReviver);
  } catch (err) {
    throw new Cardano402DecodeError(
      `Invalid JSON in payment header: ${(err as Error).message}`,
      { cause: err }
    );
  }
  return parsedJson;
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
  const padded = normalizeStrictBase64(b64);

  if (typeof Buffer !== 'undefined') {
    const bytes = Buffer.from(padded, 'base64');
    const normalizedInput = padded.replace(/=+$/u, '');
    const normalizedRoundTrip = bytes.toString('base64').replace(/=+$/u, '');
    if (normalizedInput !== normalizedRoundTrip) {
      throw new Error('base64 value is not canonical');
    }
    return new Uint8Array(bytes);
  }
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function normalizeStrictBase64(b64: string): string {
  if (b64.length === 0) {
    throw new Error('empty base64 value');
  }
  if (b64.length > MAX_PAYMENT_HEADER_LENGTH) {
    throw new Error('base64 value exceeds maximum payment header length');
  }
  if (!BASE64_ALPHABET_RE.test(b64)) {
    throw new Error('base64 value contains invalid characters or padding');
  }
  if (b64.includes('=') && b64.length % 4 !== 0) {
    throw new Error('base64 value has invalid padding');
  }

  const unpadded = b64.replace(/=+$/u, '');
  if (unpadded.length % 4 === 1) {
    throw new Error('base64 value has invalid length');
  }
  const paddedLength = Math.ceil(unpadded.length / 4) * 4;
  return unpadded.padEnd(paddedLength, '=');
}
