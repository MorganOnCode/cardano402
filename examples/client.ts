// x402 Cardano Payment Client -- Example
//
// Demonstrates the complete x402 payment cycle:
//   1. Health check (GET /health)
//   2. Query capabilities (GET /supported)
//   3. Request upload without payment -> receive 402
//   4. Parse Payment-Required header for payment requirements
//   5. Build and sign a Cardano transaction using Lucid Evolution
//   6. Retry upload with Payment-Signature header -> receive 200 + CID
//   7. Download the file for free (GET /files/:cid)
//
// Usage:
//   BLOCKFROST_KEY=preview... SEED_PHRASE="word1 word2 ..." tsx examples/client.ts
//
// Environment variables:
//   BLOCKFROST_KEY  (required) -- Blockfrost project ID for preview testnet
//   SEED_PHRASE     (required) -- 24-word seed phrase for a funded wallet
//   SERVER_URL      (optional) -- Resource server URL (default: http://localhost:3000)
//   FILE_PATH       (optional) -- Path to a file to upload (default: creates a test file)

import { readFileSync } from 'node:fs';

import { Lucid } from '@lucid-evolution/lucid';
import { Blockfrost } from '@lucid-evolution/provider';

import type { PaymentRequiredResponse } from '../src/sdk/types.js';

// ---------------------------------------------------------------------------
// Configuration from environment
// ---------------------------------------------------------------------------

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3000';
const FILE_PATH = process.env.FILE_PATH;

function requireEnv(name: string, hint: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`ERROR: ${name} environment variable is required.`);
    console.error(hint);
    process.exit(1);
  }
  return value;
}

const BLOCKFROST_KEY = requireEnv(
  'BLOCKFROST_KEY',
  'Get one at https://blockfrost.io (free tier available).'
);

const SEED_PHRASE = requireEnv(
  'SEED_PHRASE',
  'Provide a 24-word seed phrase for a funded preview testnet wallet.'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(step: string, message: string): void {
  console.log(`\n[${'='.repeat(60)}]`);
  console.log(`[STEP] ${step}`);
  console.log(`       ${message}`);
  console.log(`[${'='.repeat(60)}]`);
}

function logDetail(label: string, value: string): void {
  console.log(`  ${label}: ${value}`);
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\n  x402 Cardano Payment Client -- Example');
  console.log('  =======================================\n');
  console.log(`  Server: ${SERVER_URL}`);
  console.log(`  Network: cardano:preview`);

  // ---- Step 1: Health check ----
  log('1/7', 'Checking server health (GET /health)');

  const healthRes = await fetch(`${SERVER_URL}/health`);
  const healthBody = (await healthRes.json()) as Record<string, unknown>;

  logDetail('Status', String(healthRes.status));
  logDetail('Server status', String(healthBody.status));
  logDetail('Dependencies', JSON.stringify(healthBody.dependencies));

  if (healthRes.status !== 200 || healthBody.status !== 'healthy') {
    console.error('\nServer is not healthy. Start the server and try again.');
    process.exit(1);
  }

  // ---- Step 2: Query capabilities ----
  log('2/7', 'Querying facilitator capabilities (GET /supported)');

  const supportedRes = await fetch(`${SERVER_URL}/supported`);
  const supportedBody = (await supportedRes.json()) as Record<string, unknown>;

  logDetail('Status', String(supportedRes.status));
  logDetail('Supported kinds', JSON.stringify(supportedBody.kinds));
  logDetail('Signers', JSON.stringify(supportedBody.signers));

  // ---- Step 3: Request upload without payment -> 402 ----
  log('3/7', 'Requesting upload WITHOUT payment (POST /upload)');

  // Prepare a file to upload
  let fileBuffer: Buffer;
  let fileName: string;
  if (FILE_PATH) {
    fileBuffer = readFileSync(FILE_PATH);
    fileName = FILE_PATH.split('/').pop() ?? 'upload.bin';
    logDetail('File', `${FILE_PATH} (${fileBuffer.length} bytes)`);
  } else {
    const testContent = `x402 test file created at ${new Date().toISOString()}`;
    fileBuffer = Buffer.from(testContent, 'utf-8');
    fileName = 'test.txt';
    logDetail('File', `Generated test file (${fileBuffer.length} bytes)`);
  }

  // Build multipart form data
  const formData = new FormData();
  formData.append('file', new Blob([new Uint8Array(fileBuffer)]), fileName);

  const uploadRes402 = await fetch(`${SERVER_URL}/upload`, {
    method: 'POST',
    body: formData,
  });

  logDetail('Status', String(uploadRes402.status));

  if (uploadRes402.status !== 402) {
    console.error(`\nExpected 402 Payment Required, got ${uploadRes402.status}.`);
    console.error('The server may not have payment gating enabled.');
    process.exit(1);
  }

  // ---- Step 4: Parse Payment-Required header ----
  log('4/7', 'Parsing Payment-Required header from 402 response');

  const paymentRequiredHeader = uploadRes402.headers.get('Payment-Required');
  if (!paymentRequiredHeader) {
    console.error('\nNo Payment-Required header in 402 response.');
    process.exit(1);
  }

  const paymentRequired: PaymentRequiredResponse = JSON.parse(
    Buffer.from(paymentRequiredHeader, 'base64').toString('utf-8')
  ) as PaymentRequiredResponse;

  const accept = paymentRequired.accepts[0];
  if (!accept) {
    console.error('\nNo accepted payment options in 402 response.');
    process.exit(1);
  }

  logDetail('Version', String(paymentRequired.x402Version));
  logDetail('Network', accept.network);
  logDetail('Amount', `${accept.amount} ${accept.asset}`);
  logDetail('Pay to', accept.payTo);
  logDetail('Scheme', accept.scheme);
  logDetail('Max timeout', `${accept.maxTimeoutSeconds}s`);
  logDetail('Resource', paymentRequired.resource.description);

  // ---- Step 5: Build and sign Cardano transaction ----
  log('5/7', 'Building and signing Cardano transaction with Lucid Evolution');

  const blockfrostProvider = new Blockfrost(
    'https://cardano-preview.blockfrost.io/api/v0',
    BLOCKFROST_KEY
  );

  const lucid = await Lucid(blockfrostProvider, 'Preview');
  lucid.selectWallet.fromSeed(SEED_PHRASE);

  const walletAddress = await lucid.wallet().address();
  logDetail('Wallet address', walletAddress);

  // Check wallet balance
  const utxos = await lucid.wallet().getUtxos();
  const totalLovelace = utxos.reduce((sum, u) => sum + u.assets.lovelace, 0n);
  logDetail(
    'Wallet balance',
    `${totalLovelace} lovelace (${Number(totalLovelace) / 1_000_000} ADA)`
  );

  const paymentAmount = BigInt(accept.amount);
  if (totalLovelace < paymentAmount + 2_000_000n) {
    console.error(`\nInsufficient funds. Need at least ${paymentAmount + 2_000_000n} lovelace.`);
    console.error('Fund your wallet at https://docs.cardano.org/cardano-testnets/tools/faucet/');
    process.exit(1);
  }

  // Build the payment transaction
  logDetail('Building tx', `Sending ${accept.amount} lovelace to ${accept.payTo}`);

  const tx = await lucid
    .newTx()
    .pay.ToAddress(accept.payTo, { lovelace: paymentAmount })
    .complete();

  const signed = await tx.sign.withWallet().complete();
  const cborHex = signed.toCBOR();
  const txHash = signed.toHash();

  logDetail('Tx hash', txHash);
  logDetail('CBOR length', `${cborHex.length} hex chars`);

  // Encode as base64 for the Payment-Signature header
  const cborBytes = Buffer.from(cborHex, 'hex');
  const transactionBase64 = cborBytes.toString('base64');

  // Build the Payment-Signature header payload (x402 V2)
  const paymentSignaturePayload = {
    x402Version: 2,
    accepted: accept,
    payload: {
      transaction: transactionBase64,
      payer: walletAddress,
    },
    resource: paymentRequired.resource,
  };

  const paymentSignatureHeader = Buffer.from(JSON.stringify(paymentSignaturePayload)).toString(
    'base64'
  );

  logDetail('Payment-Signature', `${paymentSignatureHeader.slice(0, 60)}...`);

  // ---- Step 6: Retry upload with payment ----
  log('6/7', 'Retrying upload WITH payment (POST /upload + Payment-Signature)');

  const formDataRetry = new FormData();
  formDataRetry.append('file', new Blob([new Uint8Array(fileBuffer)]), fileName);

  const uploadRes200 = await fetch(`${SERVER_URL}/upload`, {
    method: 'POST',
    headers: {
      'Payment-Signature': paymentSignatureHeader,
    },
    body: formDataRetry,
  });

  logDetail('Status', String(uploadRes200.status));

  const uploadBody = (await uploadRes200.json()) as Record<string, unknown>;
  logDetail('Response', JSON.stringify(uploadBody, null, 2));

  // Check X-Payment-Response header
  const paymentResponseHeader = uploadRes200.headers.get('X-Payment-Response');
  if (paymentResponseHeader) {
    const paymentResponse = JSON.parse(
      Buffer.from(paymentResponseHeader, 'base64').toString('utf-8')
    ) as Record<string, unknown>;
    logDetail('Payment response', JSON.stringify(paymentResponse));
  }

  if (uploadRes200.status !== 200 || !uploadBody.success) {
    console.error('\nUpload failed after payment. Check server logs for details.');
    process.exit(1);
  }

  const cid = uploadBody.cid as string;
  logDetail('File CID', cid);

  // ---- Step 7: Download the file for free ----
  log('7/7', 'Downloading the file for free (GET /files/:cid)');

  const downloadRes = await fetch(`${SERVER_URL}/files/${cid}`);

  logDetail('Status', String(downloadRes.status));
  logDetail('Content-Type', downloadRes.headers.get('Content-Type') ?? 'unknown');
  logDetail('Content-Length', downloadRes.headers.get('Content-Length') ?? 'unknown');

  if (downloadRes.status === 200) {
    const downloadedBytes = Buffer.from(await downloadRes.arrayBuffer());
    logDetail('Downloaded', `${downloadedBytes.length} bytes`);

    // Verify round-trip integrity
    const match = Buffer.compare(fileBuffer, downloadedBytes) === 0;
    logDetail(
      'Round-trip match',
      match ? 'YES -- file integrity verified' : 'NO -- mismatch detected'
    );
  } else {
    console.error(`\nDownload failed with status ${downloadRes.status}.`);
  }

  // ---- Done ----
  console.log('\n');
  console.log('  x402 Payment Flow Complete');
  console.log('  ==========================');
  console.log(`  Transaction: ${txHash}`);
  console.log(`  File CID:    ${cid}`);
  console.log(`  Cost:        ${accept.amount} ${accept.asset}`);
  console.log(`  Network:     ${accept.network}`);
  console.log('\n  The full x402 cycle worked:');
  console.log('    402 -> parse requirements -> build tx -> sign -> pay -> upload -> download');
  console.log('');
}

main().catch((error: unknown) => {
  console.error('\nFATAL:', error instanceof Error ? error.message : error);
  process.exit(1);
});
