// Unit tests for verifyPayment() orchestrator
//
// Tests the coordination layer that runs all VERIFICATION_CHECKS,
// collects errors (not fail-fast), and builds the x402 V2 VerifyResponse.

import type { FastifyBaseLogger } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DeserializedTx } from '../../../src/verify/cbor.js';
import type { CheckResult, VerifyCheck, VerifyContext } from '../../../src/verify/types.js';
import { describeFailure } from '../../../src/verify/verify-payment.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal mock logger. */
function createMockLogger(): FastifyBaseLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
    silent: vi.fn(),
    level: 'info',
  } as unknown as FastifyBaseLogger;
}

/** Create a minimal mock DeserializedTx. */
function makeParsedTx(overrides: Partial<DeserializedTx> = {}): DeserializedTx {
  return {
    cborHex: 'deadbeef',
    body: {
      inputs: [{ txHash: 'a'.repeat(64), index: 0n }],
      outputs: [
        {
          addressHex: '00' + 'aa'.repeat(28) + 'bb'.repeat(28),
          addressBech32:
            'addr_test1qz424242424242424242424242424242424242424242424mhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwasmdp8x6',
          lovelace: 2_000_000n,
          assets: {},
          networkId: 0,
        },
      ],
      fee: 200_000n,
      ttl: 5000n,
      networkId: 0,
    },
    hasWitnesses: true,
    txHash: 'a'.repeat(64),
    ...overrides,
  };
}

/** Create a VerifyContext with sensible defaults for all-pass scenario. */
function makeCtx(overrides: Partial<VerifyContext> = {}): VerifyContext {
  return {
    scheme: 'exact',
    network: 'cardano:preview',
    payTo:
      'addr_test1qz424242424242424242424242424242424242424242424mhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwasmdp8x6',
    requiredAmount: 2_000_000n,
    maxTimeoutSeconds: 300,
    transactionCbor: 'dummybase64',
    requestedAt: Date.now(),
    getCurrentSlot: vi.fn().mockResolvedValue(1000),
    configuredNetwork: 'cardano:preview',
    feeMin: 150_000n,
    feeMax: 5_000_000n,
    ...overrides,
  };
}

/** Helper to create a mock check that returns predetermined results. */
function mockCheck(result: CheckResult): VerifyCheck {
  return vi.fn().mockReturnValue(result);
}

/** Helper to create an async mock check. */
function mockAsyncCheck(result: CheckResult): VerifyCheck {
  return vi.fn().mockResolvedValue(result);
}

/** Helper: dynamically import verifyPayment with mocked VERIFICATION_CHECKS. */
async function importWithMockedChecks(checks: VerifyCheck[]) {
  vi.resetModules();
  vi.doMock('../../../src/verify/checks.js', () => ({
    VERIFICATION_CHECKS: checks,
  }));
  const mod = await import('../../../src/verify/verify-payment.js');
  return mod.verifyPayment;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('../../../src/verify/checks.js');
});

// ---------------------------------------------------------------------------
// describeFailure
// ---------------------------------------------------------------------------

describe('describeFailure', () => {
  it('maps invalid_base64 to human-readable message', () => {
    const result: CheckResult = { check: 'cbor_valid', passed: false, reason: 'invalid_base64' };
    expect(describeFailure(result)).toBe('Transaction data is not valid base64');
  });

  it('maps invalid_cbor to human-readable message', () => {
    const result: CheckResult = { check: 'cbor_valid', passed: false, reason: 'invalid_cbor' };
    expect(describeFailure(result)).toBe('Transaction CBOR could not be parsed');
  });

  it('maps unsupported_scheme to human-readable message', () => {
    const result: CheckResult = { check: 'scheme', passed: false, reason: 'unsupported_scheme' };
    expect(describeFailure(result)).toBe('Payment scheme is not supported');
  });

  it('maps network_mismatch to human-readable message', () => {
    const result: CheckResult = { check: 'network', passed: false, reason: 'network_mismatch' };
    expect(describeFailure(result)).toBe('Transaction targets the wrong network');
  });

  it('maps recipient_mismatch to human-readable message', () => {
    const result: CheckResult = {
      check: 'recipient',
      passed: false,
      reason: 'recipient_mismatch',
    };
    expect(describeFailure(result)).toBe('No output pays to the required recipient');
  });

  it('maps invalid_pay_to to human-readable message', () => {
    const result: CheckResult = {
      check: 'recipient',
      passed: false,
      reason: 'invalid_pay_to',
    };
    expect(describeFailure(result)).toBe(
      'Payment requirements contain an invalid recipient address'
    );
  });

  it('maps amount_insufficient to human-readable message', () => {
    const result: CheckResult = {
      check: 'amount',
      passed: false,
      reason: 'amount_insufficient',
    };
    expect(describeFailure(result)).toBe('Payment amount is less than required');
  });

  it('maps missing_witness to human-readable message', () => {
    const result: CheckResult = { check: 'witness', passed: false, reason: 'missing_witness' };
    expect(describeFailure(result)).toBe('Transaction has no signatures');
  });

  it('maps transaction_expired to human-readable message', () => {
    const result: CheckResult = { check: 'ttl', passed: false, reason: 'transaction_expired' };
    expect(describeFailure(result)).toBe('Transaction TTL has expired');
  });

  it('maps unreasonable_fee to human-readable message', () => {
    const result: CheckResult = { check: 'fee', passed: false, reason: 'unreasonable_fee' };
    expect(describeFailure(result)).toBe('Transaction fee is outside acceptable bounds');
  });

  it('maps cbor_required to human-readable message', () => {
    const result: CheckResult = { check: 'network', passed: false, reason: 'cbor_required' };
    expect(describeFailure(result)).toBe('Transaction CBOR is required for this check');
  });

  it('returns generic message for unknown reasons', () => {
    const result: CheckResult = { check: 'custom', passed: false, reason: 'something_new' };
    expect(describeFailure(result)).toBe('Verification failed: something_new');
  });
});

// ---------------------------------------------------------------------------
// verifyPayment
// ---------------------------------------------------------------------------

describe('verifyPayment', () => {
  describe('all checks pass', () => {
    it('returns isValid: true with payer and txHash in extensions', async () => {
      const parsedTx = makeParsedTx();
      const ctx = makeCtx({ payerAddress: 'addr_test1_payer123' });
      ctx._parsedTx = parsedTx;

      const checks: VerifyCheck[] = [
        mockCheck({ check: 'cbor_valid', passed: true }),
        mockCheck({ check: 'scheme', passed: true }),
        mockCheck({ check: 'network', passed: true }),
        mockCheck({ check: 'recipient', passed: true }),
        mockCheck({ check: 'amount', passed: true }),
        mockCheck({ check: 'witness', passed: true }),
        mockAsyncCheck({ check: 'ttl', passed: true }),
        mockCheck({ check: 'fee', passed: true }),
      ];

      const verifyMocked = await importWithMockedChecks(checks);
      const logger = createMockLogger();
      const result = await verifyMocked(ctx, logger);

      expect(result.isValid).toBe(true);
      expect(result.payer).toBe('addr_test1_payer123');
      expect(result.extensions).toBeDefined();
      expect(result.extensions!.txHash).toBe(parsedTx.txHash);
      expect(result.extensions!.scheme).toBe('exact');
      expect(result.extensions!.payTo).toBe(ctx.payTo);
      expect(result.extensions!.amount).toBe('2000000');
      expect(result.invalidReason).toBeUndefined();

      // Logger should log success
      expect(logger.info).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // single failure
  // ---------------------------------------------------------------------------

  describe('single failure', () => {
    it('returns isValid: false with invalidReason from the failed check', async () => {
      const ctx = makeCtx({ scheme: 'threshold', payerAddress: 'addr_test1_payer123' });

      const checks: VerifyCheck[] = [
        mockCheck({ check: 'cbor_valid', passed: true }),
        mockCheck({
          check: 'scheme',
          passed: false,
          reason: 'unsupported_scheme',
          details: { scheme: 'threshold' },
        }),
        mockCheck({ check: 'network', passed: true }),
        mockCheck({ check: 'recipient', passed: true }),
        mockCheck({ check: 'amount', passed: true }),
        mockCheck({ check: 'witness', passed: true }),
        mockAsyncCheck({ check: 'ttl', passed: true }),
        mockCheck({ check: 'fee', passed: true }),
      ];

      const verifyMocked = await importWithMockedChecks(checks);
      const logger = createMockLogger();
      const result = await verifyMocked(ctx, logger);

      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('unsupported_scheme');
      expect(result.invalidMessage).toBe('Payment scheme is not supported');
      expect(result.payer).toBe('addr_test1_payer123');
      expect(result.extensions).toBeDefined();
      expect(result.extensions!.errors).toEqual(['unsupported_scheme']);
      expect(result.extensions!.expected).toEqual({ scheme: 'threshold' });

      // Logger should log failure
      expect(logger.info).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // multiple failures
  // ---------------------------------------------------------------------------

  describe('multiple failures', () => {
    it('returns first failure as invalidReason and all errors in extensions', async () => {
      const ctx = makeCtx();

      const checks: VerifyCheck[] = [
        mockCheck({ check: 'cbor_valid', passed: false, reason: 'invalid_cbor' }),
        mockCheck({ check: 'scheme', passed: false, reason: 'unsupported_scheme' }),
        mockCheck({ check: 'network', passed: false, reason: 'cbor_required' }),
        mockCheck({ check: 'recipient', passed: false, reason: 'cbor_required' }),
        mockCheck({ check: 'amount', passed: false, reason: 'amount_insufficient' }),
        mockCheck({ check: 'witness', passed: false, reason: 'cbor_required' }),
        mockAsyncCheck({ check: 'ttl', passed: false, reason: 'cbor_required' }),
        mockCheck({ check: 'fee', passed: false, reason: 'cbor_required' }),
      ];

      const verifyMocked = await importWithMockedChecks(checks);
      const result = await verifyMocked(ctx);

      expect(result.isValid).toBe(false);
      // First failure in order is invalid_cbor
      expect(result.invalidReason).toBe('invalid_cbor');
      expect(result.invalidMessage).toBe('Transaction CBOR could not be parsed');
      // All errors collected
      expect(result.extensions!.errors).toEqual([
        'invalid_cbor',
        'unsupported_scheme',
        'cbor_required',
        'cbor_required',
        'amount_insufficient',
        'cbor_required',
        'cbor_required',
        'cbor_required',
      ]);

      // ALL checks were called (not fail-fast)
      for (const check of checks) {
        expect(check).toHaveBeenCalledOnce();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // CBOR failure cascading
  // ---------------------------------------------------------------------------

  describe('CBOR failure cascading', () => {
    it('cbor_valid fails, scheme passes, others return dependency-failed', async () => {
      const ctx = makeCtx();

      const checks: VerifyCheck[] = [
        mockCheck({ check: 'cbor_valid', passed: false, reason: 'invalid_cbor' }),
        mockCheck({ check: 'scheme', passed: true }), // No CBOR dependency
        mockCheck({ check: 'network', passed: false, reason: 'cbor_required' }),
        mockCheck({ check: 'recipient', passed: false, reason: 'cbor_required' }),
        mockCheck({ check: 'amount', passed: false, reason: 'amount_insufficient' }),
        mockCheck({ check: 'witness', passed: false, reason: 'cbor_required' }),
        mockAsyncCheck({ check: 'ttl', passed: false, reason: 'cbor_required' }),
        mockCheck({ check: 'fee', passed: false, reason: 'cbor_required' }),
      ];

      const verifyMocked = await importWithMockedChecks(checks);
      const result = await verifyMocked(ctx);

      // All 8 checks were called
      for (const check of checks) {
        expect(check).toHaveBeenCalledOnce();
      }

      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('invalid_cbor');

      // 7 failures (all except scheme)
      expect(result.extensions!.errors).toHaveLength(7);
      expect(result.extensions!.errors).not.toContain('scheme');
      expect(result.extensions!.errors).toContain('invalid_cbor');
      expect(result.extensions!.errors).toContain('cbor_required');
    });
  });

  // ---------------------------------------------------------------------------
  // BigInt serialization safety
  // ---------------------------------------------------------------------------

  describe('BigInt serialization safety', () => {
    it('returns no BigInt values in the response object', async () => {
      const parsedTx = makeParsedTx();
      const ctx = makeCtx({
        payerAddress: 'addr_test1_payer',
        requiredAmount: 9_999_999_999_999n,
      });
      ctx._parsedTx = parsedTx;

      const checks: VerifyCheck[] = [
        mockCheck({ check: 'cbor_valid', passed: true }),
        mockCheck({ check: 'scheme', passed: true }),
        mockCheck({ check: 'network', passed: true }),
        mockCheck({ check: 'recipient', passed: true }),
        mockCheck({ check: 'amount', passed: true }),
        mockCheck({ check: 'witness', passed: true }),
        mockAsyncCheck({ check: 'ttl', passed: true }),
        mockCheck({ check: 'fee', passed: true }),
      ];

      const verifyMocked = await importWithMockedChecks(checks);
      const result = await verifyMocked(ctx);

      // JSON.stringify should not throw (would throw if BigInt present)
      expect(() => JSON.stringify(result)).not.toThrow();

      // Amount should be a string
      expect(typeof result.extensions!.amount).toBe('string');
      expect(result.extensions!.amount).toBe('9999999999999');
    });
  });

  // ---------------------------------------------------------------------------
  // payer address handling
  // ---------------------------------------------------------------------------

  describe('payer address handling', () => {
    it('includes payer when payerAddress is set', async () => {
      const ctx = makeCtx({ payerAddress: 'addr_test1_somebody' });
      ctx._parsedTx = makeParsedTx();

      const checks: VerifyCheck[] = [mockCheck({ check: 'cbor_valid', passed: true })];

      const verifyMocked = await importWithMockedChecks(checks);
      const result = await verifyMocked(ctx);
      expect(result.payer).toBe('addr_test1_somebody');
    });

    it('payer is undefined when payerAddress is not set', async () => {
      const ctx = makeCtx({ payerAddress: undefined });
      ctx._parsedTx = makeParsedTx();

      const checks: VerifyCheck[] = [mockCheck({ check: 'cbor_valid', passed: true })];

      const verifyMocked = await importWithMockedChecks(checks);
      const result = await verifyMocked(ctx);
      expect(result.payer).toBeUndefined();
    });

    it('includes payer in failure response', async () => {
      const ctx = makeCtx({ payerAddress: 'addr_test1_payer_fail' });

      const checks: VerifyCheck[] = [
        mockCheck({ check: 'cbor_valid', passed: false, reason: 'invalid_cbor' }),
      ];

      const verifyMocked = await importWithMockedChecks(checks);
      const result = await verifyMocked(ctx);
      expect(result.isValid).toBe(false);
      expect(result.payer).toBe('addr_test1_payer_fail');
    });
  });

  // ---------------------------------------------------------------------------
  // logging
  // ---------------------------------------------------------------------------

  describe('logging', () => {
    it('logs success with payer and txHash', async () => {
      const parsedTx = makeParsedTx();
      const ctx = makeCtx({ payerAddress: 'addr_test1_payer' });
      ctx._parsedTx = parsedTx;

      const checks: VerifyCheck[] = [mockCheck({ check: 'cbor_valid', passed: true })];

      const verifyMocked = await importWithMockedChecks(checks);
      const logger = createMockLogger();
      await verifyMocked(ctx, logger);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ payer: 'addr_test1_payer', txHash: parsedTx.txHash }),
        'Payment verified'
      );
    });

    it('logs failure with payer and error reasons', async () => {
      const ctx = makeCtx({ payerAddress: 'addr_test1_payer' });

      const checks: VerifyCheck[] = [
        mockCheck({ check: 'cbor_valid', passed: false, reason: 'invalid_cbor' }),
        mockCheck({ check: 'scheme', passed: false, reason: 'unsupported_scheme' }),
      ];

      const verifyMocked = await importWithMockedChecks(checks);
      const logger = createMockLogger();
      await verifyMocked(ctx, logger);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          payer: 'addr_test1_payer',
          reasons: ['invalid_cbor', 'unsupported_scheme'],
        }),
        'Payment verification failed'
      );
    });

    it('works without logger (no crash)', async () => {
      const ctx = makeCtx();
      ctx._parsedTx = makeParsedTx();

      const checks: VerifyCheck[] = [mockCheck({ check: 'cbor_valid', passed: true })];

      const verifyMocked = await importWithMockedChecks(checks);

      // Should not throw when no logger passed
      const result = await verifyMocked(ctx);
      expect(result.isValid).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // failure details
  // ---------------------------------------------------------------------------

  describe('failure details', () => {
    it('includes details from first failure as expected in extensions', async () => {
      const ctx = makeCtx();

      const checks: VerifyCheck[] = [
        mockCheck({
          check: 'cbor_valid',
          passed: false,
          reason: 'invalid_cbor',
          details: { error: 'malformed CBOR' },
        }),
      ];

      const verifyMocked = await importWithMockedChecks(checks);
      const result = await verifyMocked(ctx);

      expect(result.extensions!.expected).toEqual({ error: 'malformed CBOR' });
    });

    it('omits expected from extensions when first failure has no details', async () => {
      const ctx = makeCtx();

      const checks: VerifyCheck[] = [
        mockCheck({
          check: 'witness',
          passed: false,
          reason: 'missing_witness',
          // No details property
        }),
      ];

      const verifyMocked = await importWithMockedChecks(checks);
      const result = await verifyMocked(ctx);

      expect(result.extensions!.expected).toBeUndefined();
    });
  });
});
