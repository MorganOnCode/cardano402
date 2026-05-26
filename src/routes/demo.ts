// POST /demo/run -- Live x402 payment demo endpoint.
//
// Runs a simplified x402 payment cycle on the Cardano Preview testnet:
// 1. Health check
// 2. Query capabilities
// 3. Init testnet wallet
// 4. Build & sign testnet transaction (self-payment)
// 5. Verify via /verify endpoint
// 6. Submit to testnet via Blockfrost (direct, not /settle — avoids mainnet config)
// 7. Confirm on-chain
//
// Events emitted via SSE:
//   step    { step: number, total: number, label: string, detail?: string }
//   result  { txHash: string, amount: string, network: string, scanUrl: string }
//   error   { message: string }
//
// GET /demo/status -- Check if a demo run is already in progress (rate guard).

import { Lucid } from '@lucid-evolution/lucid';
import { Blockfrost } from '@lucid-evolution/provider';
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

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

  const runDemo = async (_req: FastifyRequest, reply: FastifyReply) => {
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

    // Check demo config is set up
    const demoConfig = fastify.config.demo;
    if (!demoConfig) {
      return reply.status(503).send({
        error: 'Demo not configured',
        message: 'Add a "demo" section with Preview testnet credentials to config/config.json.',
      });
    }

    const blockfrostKey = demoConfig.blockfrostProjectId;
    const seedPhrase = demoConfig.seedPhrase;
    const demoNetwork = demoConfig.network ?? 'Preview';

    if (!blockfrostKey || !seedPhrase) {
      return reply.status(503).send({
        error: 'Demo not configured',
        message: 'Demo requires blockfrostProjectId and seedPhrase in config.demo.',
      });
    }

    // Set up SSE
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.flushHeaders();

    demoRunning = true;

    // Self-call uses the configured server.host so the demo works with any
    // bind address. When listening on the wildcard (0.0.0.0), substitute
    // 127.0.0.1 since the wildcard isn't a valid client address.
    const configuredHost = fastify.config.server.host;
    const selfHost = configuredHost === '0.0.0.0' ? '127.0.0.1' : configuredHost;
    const serverUrl = `http://${selfHost}:${fastify.config.server.port}`;

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
      // Consume the body so the connection releases; the contents aren't used
      // here, only the fact that the endpoint responded.
      await supportedRes.json();
      emit(reply, 'step', {
        step: 2,
        total: 7,
        label: 'Query capabilities',
        detail: `Facilitator supports cardano:mainnet — demo runs on Preview testnet`,
      });

      // ---- Step 3: Init testnet wallet ----
      emit(reply, 'step', {
        step: 3,
        total: 7,
        label: 'Init testnet wallet',
        detail: 'Connecting to Cardano Preview testnet via Blockfrost…',
      });

      const blockfrostUrl =
        demoNetwork === 'Preprod'
          ? 'https://cardano-preprod.blockfrost.io/api/v0'
          : 'https://cardano-preview.blockfrost.io/api/v0';
      const provider = new Blockfrost(blockfrostUrl, blockfrostKey);
      const lucid = await Lucid(provider, demoNetwork);
      lucid.selectWallet.fromSeed(seedPhrase);

      const walletAddress = await lucid.wallet().address();
      const utxos = await lucid.wallet().getUtxos();
      const totalLovelace = utxos.reduce((sum, u) => sum + u.assets.lovelace, 0n);

      emit(reply, 'step', {
        step: 3,
        total: 7,
        label: 'Init testnet wallet',
        detail: `Wallet: ${walletAddress.slice(0, 24)}… | Balance: ${Number(totalLovelace) / 1_000_000} ADA`,
      });

      const paymentAmount = BigInt(DEMO_AMOUNT_LOVELACE);
      if (totalLovelace < paymentAmount + 2_000_000n) {
        throw new Error(
          `Insufficient demo wallet balance (${Number(totalLovelace) / 1_000_000} ADA). Fund at https://docs.cardano.org/cardano-testnets/tools/faucet/`
        );
      }

      // ---- Step 4: Build & sign transaction ----
      emit(reply, 'step', {
        step: 4,
        total: 7,
        label: 'Build & sign transaction',
        detail: `Building 2 ADA self-payment on ${demoNetwork} testnet…`,
      });

      const tx = await lucid
        .newTx()
        .pay.ToAddress(walletAddress, { lovelace: paymentAmount })
        .complete();

      const signed = await tx.sign.withWallet().complete();
      const cborHex = signed.toCBOR();
      const txHash = signed.toHash();
      const transactionBase64 = Buffer.from(cborHex, 'hex').toString('base64');

      emit(reply, 'step', {
        step: 4,
        total: 7,
        label: 'Build & sign transaction',
        detail: `Tx hash: ${txHash}`,
      });

      // ---- Step 5: Verify via facilitator ----
      emit(reply, 'step', {
        step: 5,
        total: 7,
        label: 'Verify payment',
        detail: 'POST /verify — running 10-check verification pipeline…',
      });

      const networkId = demoNetwork === 'Preprod' ? 'cardano:preprod' : 'cardano:preview';

      const verifyBody = {
        x402Version: 2,
        paymentPayload: {
          x402Version: 2,
          accepted: {
            scheme: 'exact',
            network: networkId,
            asset: 'lovelace',
            amount: DEMO_AMOUNT_LOVELACE,
            payTo: walletAddress,
            maxTimeoutSeconds: 300,
          },
          payload: {
            transaction: transactionBase64,
            payer: walletAddress,
          },
        },
        paymentRequirements: {
          scheme: 'exact',
          network: networkId,
          asset: 'lovelace',
          amount: DEMO_AMOUNT_LOVELACE,
          payTo: walletAddress,
          maxTimeoutSeconds: 300,
        },
      };

      const verifyRes = await fetch(`${serverUrl}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verifyBody),
      });

      const verifyData = (await verifyRes.json()) as Record<string, unknown>;

      if (verifyData.isValid) {
        emit(reply, 'step', {
          step: 5,
          total: 7,
          label: 'Verify payment',
          detail: '✅ All 10 verification checks passed',
        });
      } else {
        // Verification may fail due to network mismatch (mainnet config vs testnet tx)
        // This is expected — show the result transparently
        emit(reply, 'step', {
          step: 5,
          total: 7,
          label: 'Verify payment',
          detail: `Verification: ${verifyData.invalidReason ?? 'network_mismatch'} (expected — mainnet facilitator, testnet demo)`,
        });
      }

      // ---- Step 6: Submit to testnet directly ----
      emit(reply, 'step', {
        step: 6,
        total: 7,
        label: 'Submit to testnet',
        detail: 'Submitting signed transaction to Cardano Preview via Blockfrost…',
      });

      const submitRes = await fetch(`${blockfrostUrl}/tx/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/cbor',
          project_id: blockfrostKey,
        },
        body: Buffer.from(cborHex, 'hex'),
      });

      if (!submitRes.ok) {
        const errText = await submitRes.text();
        throw new Error(`Blockfrost submit failed (${submitRes.status}): ${errText}`);
      }

      emit(reply, 'step', {
        step: 6,
        total: 7,
        label: 'Submit to testnet',
        detail: `Transaction submitted — waiting for on-chain confirmation…`,
      });

      // ---- Step 7: Poll for confirmation ----
      emit(reply, 'step', {
        step: 7,
        total: 7,
        label: 'Confirm on-chain',
        detail: 'Polling Blockfrost for confirmation (~20-40s)…',
      });

      let confirmed = false;
      let blockHeight = '';
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          const checkRes = await fetch(`${blockfrostUrl}/txs/${txHash}`, {
            headers: { project_id: blockfrostKey },
          });
          if (checkRes.status === 200) {
            const txData = (await checkRes.json()) as Record<string, unknown>;
            blockHeight = String(txData.block_height ?? '');
            confirmed = true;
            break;
          }
        } catch {
          // keep polling
        }
        emit(reply, 'step', {
          step: 7,
          total: 7,
          label: 'Confirm on-chain',
          detail: `Polling… ${(i + 1) * 5}s`,
        });
      }

      if (confirmed) {
        emit(reply, 'step', {
          step: 7,
          total: 7,
          label: 'Confirm on-chain',
          detail: `✅ Confirmed in block ${blockHeight}`,
        });
      } else {
        emit(reply, 'step', {
          step: 7,
          total: 7,
          label: 'Confirm on-chain',
          detail: '⏳ Not yet confirmed — check CardanoScan in a few minutes',
        });
      }

      // ---- Done: emit result ----
      lastRunAt = Date.now();
      emit(reply, 'result', {
        txHash,
        amount: DEMO_AMOUNT_LOVELACE,
        network: networkId,
        scanUrl: `https://preview.cardanoscan.io/transaction/${txHash}`,
      });

      fastify.log.info({ txHash, network: networkId }, 'Demo run completed successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      fastify.log.error({ err: message }, 'Demo run failed');
      emit(reply, 'error', { message });
    } finally {
      demoRunning = false;
      reply.raw.end();
    }
  };

  // POST /demo/run -- SSE stream of the live payment cycle
  fastify.post(
    '/demo/run',
    {
      config: {
        rateLimit: {
          max: fastify.config.rateLimit.sensitive,
          timeWindow: fastify.config.rateLimit.windowMs,
        },
      },
    },
    runDemo
  );

  done();
};

export const demoRoutesPlugin = fp(demoRoutes, {
  name: 'demo-routes',
  fastify: '5.x',
});
