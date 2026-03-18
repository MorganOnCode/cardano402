// POST /demo/run -- Live x402 payment demo endpoint.
//
// Runs the full 7-step x402 payment cycle server-side using Lucid Evolution
// and streams progress events as Server-Sent Events (SSE). The demo wallet
// is the facilitator's own wallet (same seed phrase), paying to itself on
// the preview testnet -- this shows the protocol working end-to-end without
// requiring the visitor to have their own wallet.
//
// Events emitted:
//   step    { step: number, total: number, label: string, detail?: string }
//   result  { txHash: string, cid: string, amount: string, scanUrl: string }
//   error   { message: string }
//
// GET /demo/status -- Check if a demo run is already in progress (rate guard).

import { Lucid } from '@lucid-evolution/lucid';
import { Blockfrost } from '@lucid-evolution/provider';
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

import type { PaymentRequiredResponse } from '../sdk/types.js';

// Only allow one concurrent demo run to protect the demo wallet's UTXOs
let demoRunning = false;
let lastRunAt: number | null = null;
// Minimum gap between runs: 30 seconds (testnet block time + buffer)
const DEMO_COOLDOWN_MS = 30_000;

const DEMO_AMOUNT_LOVELACE = '2000000'; // 2 ADA

function emit(reply: FastifyReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const demoRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  // GET /demo/status -- poll before starting
  fastify.get('/demo/status', async (_req: FastifyRequest, reply: FastifyReply) => {
    const cooldownRemaining =
      lastRunAt !== null ? Math.max(0, DEMO_COOLDOWN_MS - (Date.now() - lastRunAt)) : 0;
    return reply.send({
      running: demoRunning,
      cooldownRemainingMs: cooldownRemaining,
      ready: !demoRunning && cooldownRemaining === 0,
    });
  });

  // POST /demo/run -- SSE stream of the live payment cycle
  fastify.post('/demo/run', async (req: FastifyRequest, reply: FastifyReply) => {
    // Guard: one demo at a time
    if (demoRunning) {
      return reply.status(429).send({
        error: 'Demo already running',
        message: 'Another demo is currently in progress. Try again in a moment.',
      });
    }

    // Guard: cooldown between runs
    if (lastRunAt !== null && Date.now() - lastRunAt < DEMO_COOLDOWN_MS) {
      const wait = Math.ceil((DEMO_COOLDOWN_MS - (Date.now() - lastRunAt)) / 1000);
      return reply.status(429).send({
        error: 'Cooldown active',
        message: `Demo wallet needs ${wait}s to reset between runs. Please wait.`,
      });
    }

    // Check config is set up (no blockfrost key = demo not configured)
    const blockfrostKey = fastify.config.chain.blockfrost.projectId;
    const seedPhrase = fastify.config.chain.facilitator.seedPhrase;

    if (!blockfrostKey || !seedPhrase) {
      return reply.status(503).send({
        error: 'Demo not configured',
        message: 'Blockfrost API key and seed phrase required. See config/config.json.',
      });
    }

    // Set up SSE
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.flushHeaders();

    demoRunning = true;

    const serverUrl = `http://127.0.0.1:${fastify.config.server.port}`;

    try {
      // ---- Step 1: Health check ----
      emit(reply, 'step', {
        step: 1,
        total: 7,
        label: 'Health check',
        detail: 'Verifying facilitator is live…',
      });

      const healthRes = await fetch(`${serverUrl}/health`);
      const healthBody = (await healthRes.json()) as Record<string, unknown>;
      if (healthRes.status !== 200 || healthBody.status !== 'healthy') {
        throw new Error(`Server not healthy: ${JSON.stringify(healthBody)}`);
      }
      emit(reply, 'step', {
        step: 1,
        total: 7,
        label: 'Health check',
        detail: `OK — ${JSON.stringify(healthBody.dependencies)}`,
      });

      // ---- Step 2: Query supported ----
      emit(reply, 'step', {
        step: 2,
        total: 7,
        label: 'Query capabilities',
        detail: 'GET /supported…',
      });

      const supportedRes = await fetch(`${serverUrl}/supported`);
      const supportedBody = (await supportedRes.json()) as Record<string, unknown>;
      const signers = supportedBody.signers as Record<string, string[]> | undefined;
      const facilitatorAddress = signers
        ? (Object.values(signers)[0]?.[0] ?? 'unknown')
        : 'unknown';
      emit(reply, 'step', {
        step: 2,
        total: 7,
        label: 'Query capabilities',
        detail: `Facilitator: ${facilitatorAddress.slice(0, 20)}…`,
      });

      // ---- Step 3: Request upload without payment (expect 402) ----
      emit(reply, 'step', {
        step: 3,
        total: 7,
        label: 'Request without payment',
        detail: 'POST /upload → expecting 402 Payment Required…',
      });

      const testContent = `x402 live demo — ${new Date().toISOString()}`;
      const fileBuffer = Buffer.from(testContent, 'utf-8');
      const formData1 = new FormData();
      formData1.append('file', new Blob([new Uint8Array(fileBuffer)]), 'demo.txt');

      const upload402 = await fetch(`${serverUrl}/upload`, {
        method: 'POST',
        body: formData1,
      });

      if (upload402.status !== 402) {
        throw new Error(`Expected 402, got ${upload402.status}`);
      }
      emit(reply, 'step', {
        step: 3,
        total: 7,
        label: 'Request without payment',
        detail: `402 received — payment gating confirmed`,
      });

      // ---- Step 4: Parse payment requirements ----
      emit(reply, 'step', {
        step: 4,
        total: 7,
        label: 'Parse payment requirements',
        detail: 'Decoding Payment-Required header…',
      });

      const paymentRequiredHeader = upload402.headers.get('Payment-Required');
      if (!paymentRequiredHeader) throw new Error('No Payment-Required header in 402 response');

      const paymentRequired = JSON.parse(
        Buffer.from(paymentRequiredHeader, 'base64').toString('utf-8')
      ) as PaymentRequiredResponse;

      const accept = paymentRequired.accepts[0];
      if (!accept) throw new Error('No accepted payment options in 402 response');

      emit(reply, 'step', {
        step: 4,
        total: 7,
        label: 'Parse payment requirements',
        detail: `${accept.amount} lovelace on ${accept.network} → ${accept.payTo.slice(0, 20)}…`,
      });

      // ---- Step 5: Build and sign Cardano transaction ----
      emit(reply, 'step', {
        step: 5,
        total: 7,
        label: 'Build & sign transaction',
        detail: 'Initialising Lucid + Blockfrost…',
      });

      const provider = new Blockfrost(
        'https://cardano-preview.blockfrost.io/api/v0',
        blockfrostKey
      );
      const lucid = await Lucid(provider, 'Preview');
      lucid.selectWallet.fromSeed(seedPhrase);

      const walletAddress = await lucid.wallet().address();
      const utxos = await lucid.wallet().getUtxos();
      const totalLovelace = utxos.reduce((sum, u) => sum + u.assets.lovelace, 0n);

      emit(reply, 'step', {
        step: 5,
        total: 7,
        label: 'Build & sign transaction',
        detail: `Wallet: ${walletAddress.slice(0, 20)}… | Balance: ${Number(totalLovelace) / 1_000_000} ADA`,
      });

      const paymentAmount = BigInt(DEMO_AMOUNT_LOVELACE);
      if (totalLovelace < paymentAmount + 2_000_000n) {
        throw new Error(
          `Insufficient demo wallet balance (${Number(totalLovelace) / 1_000_000} ADA). Fund at https://docs.cardano.org/cardano-testnets/tools/faucet/`
        );
      }

      const tx = await lucid
        .newTx()
        .pay.ToAddress(accept.payTo, { lovelace: paymentAmount })
        .complete();

      const signed = await tx.sign.withWallet().complete();
      const cborHex = signed.toCBOR();
      const txHash = signed.toHash();

      emit(reply, 'step', {
        step: 5,
        total: 7,
        label: 'Build & sign transaction',
        detail: `Tx hash: ${txHash}`,
      });

      // ---- Step 6: Retry upload with payment ----
      emit(reply, 'step', {
        step: 6,
        total: 7,
        label: 'Pay & upload',
        detail: 'Submitting payment + uploading file… (20-60s for confirmation)',
      });

      const cborBytes = Buffer.from(cborHex, 'hex');
      const transactionBase64 = cborBytes.toString('base64');

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

      const formData2 = new FormData();
      formData2.append('file', new Blob([new Uint8Array(fileBuffer)]), 'demo.txt');

      const upload200 = await fetch(`${serverUrl}/upload`, {
        method: 'POST',
        headers: { 'Payment-Signature': paymentSignatureHeader },
        body: formData2,
        signal: AbortSignal.timeout(180_000), // 3 minutes — settle polls 120s + headroom
      });

      const uploadBody = (await upload200.json()) as Record<string, unknown>;

      if (upload200.status !== 200 || !uploadBody.success) {
        throw new Error(`Upload failed: ${JSON.stringify(uploadBody)}`);
      }

      const cid = uploadBody.cid as string;

      emit(reply, 'step', {
        step: 6,
        total: 7,
        label: 'Pay & upload',
        detail: `Confirmed on-chain. CID: ${cid}`,
      });

      // ---- Step 7: Download for free ----
      emit(reply, 'step', {
        step: 7,
        total: 7,
        label: 'Download (free)',
        detail: `GET /files/${cid}…`,
      });

      const downloadRes = await fetch(`${serverUrl}/files/${cid}`);
      if (downloadRes.status !== 200) {
        throw new Error(`Download failed: ${downloadRes.status}`);
      }

      const downloadedBytes = Buffer.from(await downloadRes.arrayBuffer());
      const match = Buffer.compare(fileBuffer, downloadedBytes) === 0;

      emit(reply, 'step', {
        step: 7,
        total: 7,
        label: 'Download (free)',
        detail: `${downloadedBytes.length} bytes — integrity ${match ? '✓ verified' : '✗ mismatch'}`,
      });

      // ---- Done: emit result ----
      lastRunAt = Date.now();
      emit(reply, 'result', {
        txHash,
        cid,
        amount: DEMO_AMOUNT_LOVELACE,
        network: accept.network,
        scanUrl: `https://preview.cardanoscan.io/transaction/${txHash}`,
      });

      fastify.log.info({ txHash, cid }, 'Demo run completed successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      fastify.log.error({ err: message }, 'Demo run failed');
      emit(reply, 'error', { message });
    } finally {
      demoRunning = false;
      reply.raw.end();
    }
  });

  done();
};

export const demoRoutesPlugin = fp(demoRoutes, {
  name: 'demo-routes',
  fastify: '5.x',
});
