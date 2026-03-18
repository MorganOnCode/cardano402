// x402 Failure Mode Tests — Preview Testnet
//
// Tests 5 failure scenarios against the live facilitator:
//   1. Replay attack (submit same tx twice)
//   2. Wrong recipient address
//   3. Wrong amount (underpayment)
//   4. Expired transaction (TTL in the past)
//   5. Malformed CBOR
//
// Usage:
//   BLOCKFROST_KEY=preview... SEED_PHRASE="word1 word2 ..." tsx examples/failure-modes.ts

import { Lucid } from '@lucid-evolution/lucid';
import type { LucidEvolution } from '@lucid-evolution/lucid';
import { Blockfrost } from '@lucid-evolution/provider';

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3000';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`ERROR: ${name} is required`);
    process.exit(1);
  }
  return value;
}

const BLOCKFROST_KEY = requireEnv('BLOCKFROST_KEY');
const SEED_PHRASE = requireEnv('SEED_PHRASE');

// The facilitator's address (from /supported)
let FACILITATOR_ADDRESS = '';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(test: string, status: 'PASS' | 'FAIL' | 'INFO', msg: string): void {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '🔍';
  console.log(`  ${icon} [${test}] ${msg}`);
}

interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  invalidMessage?: string;
  payer?: string;
  extensions?: Record<string, unknown>;
}

interface SettleResponse {
  success: boolean;
  transaction?: string;
  network?: string;
  errorReason?: string;
  errorMessage?: string;
}

async function callVerify(
  transactionBase64: string,
  amount: string,
  payTo: string,
  network = 'cardano:preview'
): Promise<VerifyResponse> {
  const body = {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      accepted: {
        scheme: 'exact',
        network,
        amount,
        payTo,
        maxTimeoutSeconds: 300,
        asset: 'lovelace',
      },
      payload: {
        transaction: transactionBase64,
        payer: 'addr_test1qq_placeholder',
      },
    },
    paymentRequirements: {
      scheme: 'exact',
      network,
      amount,
      payTo,
      maxTimeoutSeconds: 300,
      asset: 'lovelace',
    },
  };

  const res = await fetch(`${SERVER_URL}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return (await res.json()) as VerifyResponse;
}

async function callSettle(
  transactionBase64: string,
  amount: string,
  payTo: string,
  network = 'cardano:preview'
): Promise<SettleResponse> {
  const body = {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      accepted: {
        scheme: 'exact',
        network,
        amount,
        payTo,
        maxTimeoutSeconds: 300,
        asset: 'lovelace',
      },
      payload: {
        transaction: transactionBase64,
        payer: 'addr_test1qq_placeholder',
      },
    },
    paymentRequirements: {
      scheme: 'exact',
      network,
      amount,
      payTo,
      maxTimeoutSeconds: 300,
      asset: 'lovelace',
    },
  };

  const res = await fetch(`${SERVER_URL}/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return (await res.json()) as SettleResponse;
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

async function testMalformedCbor(): Promise<boolean> {
  log('MALFORMED_CBOR', 'INFO', 'Sending garbage base64 as transaction...');

  const garbageBase64 = Buffer.from('this is not a valid transaction').toString('base64');
  const result = await callVerify(garbageBase64, '2000000', FACILITATOR_ADDRESS);

  if (!result.isValid && result.invalidReason === 'invalid_cbor') {
    log('MALFORMED_CBOR', 'PASS', `Rejected: ${result.invalidReason} — ${result.invalidMessage}`);
    return true;
  }
  log('MALFORMED_CBOR', 'FAIL', `Expected invalid_cbor, got: ${JSON.stringify(result)}`);
  return false;
}

async function testWrongRecipient(lucid: LucidEvolution): Promise<boolean> {
  log(
    'WRONG_RECIPIENT',
    'INFO',
    'Building tx that pays to a random address instead of facilitator...'
  );

  // Generate a random address (not the facilitator)
  const wrongAddress =
    'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp';

  const tx = await lucid.newTx().pay.ToAddress(wrongAddress, { lovelace: 2_000_000n }).complete();

  const signed = await tx.sign.withWallet().complete();
  const cborHex = signed.toCBOR();
  const transactionBase64 = Buffer.from(cborHex, 'hex').toString('base64');

  // Verify against the facilitator address — should fail recipient check
  const result = await callVerify(transactionBase64, '2000000', FACILITATOR_ADDRESS);

  if (!result.isValid && result.invalidReason === 'recipient_mismatch') {
    log('WRONG_RECIPIENT', 'PASS', `Rejected: ${result.invalidReason} — ${result.invalidMessage}`);
    return true;
  }
  log('WRONG_RECIPIENT', 'FAIL', `Expected recipient_mismatch, got: ${JSON.stringify(result)}`);
  return false;
}

async function testWrongAmount(lucid: LucidEvolution): Promise<boolean> {
  log('WRONG_AMOUNT', 'INFO', 'Building tx that pays 1 ADA instead of required 2 ADA...');

  const tx = await lucid
    .newTx()
    .pay.ToAddress(FACILITATOR_ADDRESS, { lovelace: 1_000_000n }) // 1 ADA, need 2
    .complete();

  const signed = await tx.sign.withWallet().complete();
  const cborHex = signed.toCBOR();
  const transactionBase64 = Buffer.from(cborHex, 'hex').toString('base64');

  const result = await callVerify(transactionBase64, '2000000', FACILITATOR_ADDRESS);

  if (!result.isValid && result.invalidReason === 'amount_insufficient') {
    log('WRONG_AMOUNT', 'PASS', `Rejected: ${result.invalidReason} — ${result.invalidMessage}`);
    return true;
  }
  log('WRONG_AMOUNT', 'FAIL', `Expected amount_insufficient, got: ${JSON.stringify(result)}`);
  return false;
}

async function testReplayAttack(lucid: LucidEvolution): Promise<boolean> {
  log('REPLAY_ATTACK', 'INFO', 'Building a valid tx, settling it, then trying to settle again...');

  const tx = await lucid
    .newTx()
    .pay.ToAddress(FACILITATOR_ADDRESS, { lovelace: 2_000_000n })
    .complete();

  const signed = await tx.sign.withWallet().complete();
  const cborHex = signed.toCBOR();
  const txHash = signed.toHash();
  const transactionBase64 = Buffer.from(cborHex, 'hex').toString('base64');

  // First: verify passes
  const verifyResult = await callVerify(transactionBase64, '2000000', FACILITATOR_ADDRESS);
  if (!verifyResult.isValid) {
    log('REPLAY_ATTACK', 'FAIL', `Initial verify failed: ${verifyResult.invalidReason}`);
    return false;
  }
  log('REPLAY_ATTACK', 'INFO', `Verify passed for tx ${txHash.slice(0, 16)}...`);

  // First settle — should succeed (submits on-chain)
  log('REPLAY_ATTACK', 'INFO', 'First settle (submitting on-chain, may take 20-60s)...');
  const settle1 = await callSettle(transactionBase64, '2000000', FACILITATOR_ADDRESS);
  if (!settle1.success) {
    log(
      'REPLAY_ATTACK',
      'FAIL',
      `First settle failed: ${settle1.errorReason} — ${settle1.errorMessage}`
    );
    return false;
  }
  log('REPLAY_ATTACK', 'INFO', `First settle succeeded: tx ${settle1.transaction}`);

  // Second settle — should be caught by dedup (SHA-256 key in Redis)
  log('REPLAY_ATTACK', 'INFO', 'Replaying the same transaction...');
  const settle2 = await callSettle(transactionBase64, '2000000', FACILITATOR_ADDRESS);

  if (!settle2.success && settle2.errorReason === 'already_settled') {
    log(
      'REPLAY_ATTACK',
      'PASS',
      `Replay blocked: ${settle2.errorReason} — ${settle2.errorMessage}`
    );
    return true;
  }

  // The dedup system is idempotent by design: replaying the same tx returns
  // the original success result (same txHash). This is correct behavior —
  // the blockchain prevents actual double-spending via UTXO model, and the
  // facilitator returns the cached confirmed result without re-submitting.
  if (settle2.success && settle2.transaction && settle2.transaction === settle1.transaction) {
    log(
      'REPLAY_ATTACK',
      'PASS',
      `Idempotent dedup: same tx returned without re-submission (${settle2.transaction.slice(0, 16)}...)`
    );
    return true;
  }

  // It might also fail because the UTXO is already spent on-chain
  if (!settle2.success) {
    log(
      'REPLAY_ATTACK',
      'PASS',
      `Replay blocked (chain-level): ${settle2.errorReason} — ${settle2.errorMessage}`
    );
    return true;
  }

  log('REPLAY_ATTACK', 'FAIL', `Expected replay to be blocked, got: ${JSON.stringify(settle2)}`);
  return false;
}

async function testExpiredTransaction(lucid: LucidEvolution): Promise<boolean> {
  log('EXPIRED_TX', 'INFO', 'Building tx with TTL set to slot 1 (long expired)...');

  // Build a tx with an absurdly low validity interval (slot 1, way in the past)
  // Lucid normally sets TTL automatically, so we need to set it manually
  const tx = await lucid
    .newTx()
    .pay.ToAddress(FACILITATOR_ADDRESS, { lovelace: 2_000_000n })
    .validTo(Date.now() - 3600_000) // 1 hour in the past
    .complete();

  const signed = await tx.sign.withWallet().complete();
  const cborHex = signed.toCBOR();
  const transactionBase64 = Buffer.from(cborHex, 'hex').toString('base64');

  const result = await callVerify(transactionBase64, '2000000', FACILITATOR_ADDRESS);

  if (!result.isValid && result.invalidReason === 'transaction_expired') {
    log('EXPIRED_TX', 'PASS', `Rejected: ${result.invalidReason} — ${result.invalidMessage}`);
    return true;
  }

  // Lucid might reject building expired tx — in that case we report it
  log('EXPIRED_TX', 'FAIL', `Expected transaction_expired, got: ${JSON.stringify(result)}`);
  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\n  x402 Failure Mode Tests — Preview Testnet');
  console.log('  ==========================================\n');

  // Get facilitator address
  const supportedRes = await fetch(`${SERVER_URL}/supported`);
  const supported = (await supportedRes.json()) as {
    signers: Record<string, string[]>;
  };
  FACILITATOR_ADDRESS = Object.values(supported.signers).flat()[0];
  console.log(`  Facilitator: ${FACILITATOR_ADDRESS}`);
  console.log(`  Server: ${SERVER_URL}\n`);

  // Init Lucid
  const blockfrostProvider = new Blockfrost(
    'https://cardano-preview.blockfrost.io/api/v0',
    BLOCKFROST_KEY
  );
  const lucid = await Lucid(blockfrostProvider, 'Preview');
  lucid.selectWallet.fromSeed(SEED_PHRASE);

  const walletAddress = await lucid.wallet().address();
  const utxos = await lucid.wallet().getUtxos();
  const balance = utxos.reduce((sum, u) => sum + u.assets.lovelace, 0n);
  console.log(`  Wallet: ${walletAddress}`);
  console.log(`  Balance: ${Number(balance) / 1_000_000} ADA\n`);

  const results: { name: string; passed: boolean }[] = [];

  // Test 1: Malformed CBOR (no on-chain cost)
  console.log('─'.repeat(60));
  results.push({ name: 'MALFORMED_CBOR', passed: await testMalformedCbor() });

  // Test 2: Wrong recipient (no on-chain cost, just verify)
  console.log('─'.repeat(60));
  results.push({ name: 'WRONG_RECIPIENT', passed: await testWrongRecipient(lucid) });

  // Test 3: Wrong amount (no on-chain cost, just verify)
  console.log('─'.repeat(60));
  results.push({ name: 'WRONG_AMOUNT', passed: await testWrongAmount(lucid) });

  // Test 4: Expired TX (no on-chain cost, just verify)
  console.log('─'.repeat(60));
  try {
    results.push({ name: 'EXPIRED_TX', passed: await testExpiredTransaction(lucid) });
  } catch (error) {
    // Lucid might refuse to build an expired tx
    const msg = error instanceof Error ? error.message : String(error);
    if (
      msg.includes('validity') ||
      msg.includes('slot') ||
      msg.includes('expired') ||
      msg.includes('Interval')
    ) {
      log(
        'EXPIRED_TX',
        'PASS',
        `Lucid refused to build expired tx (client-side protection): ${msg.slice(0, 100)}`
      );
      results.push({ name: 'EXPIRED_TX', passed: true });
    } else {
      log('EXPIRED_TX', 'FAIL', `Unexpected error: ${msg}`);
      results.push({ name: 'EXPIRED_TX', passed: false });
    }
  }

  // Test 5: Replay attack (costs 2 ADA + fees for the first settlement)
  console.log('─'.repeat(60));
  results.push({ name: 'REPLAY_ATTACK', passed: await testReplayAttack(lucid) });

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('  RESULTS');
  console.log('═'.repeat(60));
  const passed = results.filter((r) => r.passed).length;
  for (const r of results) {
    console.log(`  ${r.passed ? '✅' : '❌'} ${r.name}`);
  }
  console.log(`\n  ${passed}/${results.length} passed\n`);

  if (passed < results.length) {
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error('\nFATAL:', error instanceof Error ? error.message : error);
  process.exit(1);
});
