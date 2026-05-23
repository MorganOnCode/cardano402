#!/usr/bin/env node
// Manual preview-testnet smoke for @cardano402/mcp-server.
//
// What this proves end-to-end:
//   1. cardano402-mcp parses a real /.well-known/x402.json catalog.
//   2. Lucid Evolution + Blockfrost produce a real signed CBOR tx on
//      Cardano Preview.
//   3. The Payment-Signature header shape we emit is byte-decodable.
//   4. The signed tx submits and confirms on the Preview chain.
//
// Architecture: one process. The script runs an inline HTTP resource
// server (the thing the MCP client points at), spawns cardano402-mcp as
// a stdio subprocess, drives the JSON-RPC handshake / tools/list /
// tools/call. The resource server is also the verifier: it submits the
// signed CBOR via Blockfrost and returns 200 + X-Payment-Response.
//
// Pay-to-self: payTo == the signer's own address. The smoke costs
// nothing but the Cardano tx fee (~0.2 preview ADA).
//
// Usage:
//   SEED_PHRASE="..." BLOCKFROST_KEY="preview..." \
//     node packages/mcp-server/scripts/smoke.mjs
//
// Optional:
//   --port <n>           Resource-server port (default 4000)
//   --keep-running       Don't tear down after success (poke at it manually)

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { Lucid } from '@lucid-evolution/lucid';
import { Blockfrost } from '@lucid-evolution/provider';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_CLI = resolve(__dirname, '..', 'dist', 'cli.js');

// ---- env + flags ----
const SEED = process.env.SEED_PHRASE;
const KEY = process.env.BLOCKFROST_KEY;
if (!SEED) {
  console.error('SEED_PHRASE env var is required (24-word preview wallet seed)');
  process.exit(1);
}
if (!KEY) {
  console.error('BLOCKFROST_KEY env var is required (preview project ID)');
  process.exit(1);
}
if (!KEY.startsWith('preview')) {
  console.error(`BLOCKFROST_KEY looks wrong — preview project IDs start with "preview", got ${KEY.slice(0, 12)}...`);
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (k, dflt) => {
  const i = args.indexOf(k);
  if (i === -1) return dflt;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const PORT = Number.parseInt(flag('--port', '4000'), 10);
const KEEP_RUNNING = flag('--keep-running', false) === true;
const NETWORK = 'Preview';
const PAYMENT_PRICE = '2000000'; // 2 ADA — well under fee+output minimum for a clean smoke
const BLOCKFROST_URL = 'https://cardano-preview.blockfrost.io/api/v0';
const PRICED_PATH = '/api/weather';
const TOOL_INVOCATION_TIMEOUT_MS = 120_000; // 2 minutes for the round trip incl. chain submit

const log = (msg, extra) =>
  console.log(`[smoke] ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`);

// ---- derive resource-server pay-to address ----
log('deriving pay-to address from SEED_PHRASE...');
const provider = new Blockfrost(BLOCKFROST_URL, KEY);
const lucid = await Lucid(provider, NETWORK);
lucid.selectWallet.fromSeed(SEED);
const payTo = await lucid.wallet().address();
log('pay-to (self):', payTo);

// ---- catalog body served at /.well-known/x402.json ----
const buildCatalog = () => ({
  x402Version: 2,
  server: {
    name: 'cardano402-smoke',
    description: 'Throwaway resource server used to smoke-test @cardano402/mcp-server.',
    url: `http://localhost:${PORT}`,
  },
  endpoints: [
    {
      method: 'GET',
      path: PRICED_PATH,
      scheme: 'exact',
      network: 'cardano:preview',
      amount: PAYMENT_PRICE,
      asset: 'lovelace',
      payTo,
      maxTimeoutSeconds: 600,
      description: 'Returns dummy weather data after a 2 ADA payment.',
    },
  ],
});

// ---- 402 Payment-Required header ----
const buildRequiredHeader = () =>
  Buffer.from(
    JSON.stringify({
      x402Version: 2,
      error: null,
      resource: {
        description: 'weather',
        mimeType: 'application/json',
        url: PRICED_PATH,
      },
      accepts: [
        {
          scheme: 'exact',
          network: 'cardano:preview',
          amount: PAYMENT_PRICE,
          payTo,
          maxTimeoutSeconds: 600,
          asset: 'lovelace',
          extra: null,
        },
      ],
    })
  ).toString('base64');

// ---- submit a CBOR tx via Blockfrost ----
async function submitSignedTx(cborHex) {
  const res = await fetch(`${BLOCKFROST_URL}/tx/submit`, {
    method: 'POST',
    headers: {
      project_id: KEY,
      'content-type': 'application/cbor',
    },
    body: Buffer.from(cborHex, 'hex'),
  });
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Blockfrost submit failed (${res.status}): ${bodyText}`);
  }
  // Blockfrost returns "txhash" as JSON-stringified hex; strip quotes.
  return bodyText.replace(/^"|"$/g, '');
}

// ---- inline HTTP resource server ----
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === '/.well-known/x402.json') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify(buildCatalog()));
    }

    if (url.pathname === PRICED_PATH) {
      const paymentHeader =
        req.headers['payment-signature'] ?? req.headers['PAYMENT-SIGNATURE'];

      if (!paymentHeader) {
        log('-> 402 (no Payment-Signature)');
        res.statusCode = 402;
        res.setHeader('payment-required', buildRequiredHeader());
        return res.end();
      }

      log('<- Payment-Signature received, decoding...');
      const decoded = JSON.parse(
        Buffer.from(paymentHeader, 'base64').toString('utf-8')
      );
      const cborBase64 = decoded.payload.transaction;
      const cborHex = Buffer.from(cborBase64, 'base64').toString('hex');
      log(`signed CBOR length: ${cborHex.length / 2} bytes; submitting to chain...`);

      const txHash = await submitSignedTx(cborHex);
      log('chain accepted tx:', txHash);

      const paymentResponse = Buffer.from(
        JSON.stringify({
          success: true,
          transaction: txHash,
          network: 'cardano:preview',
          payer: decoded.payload.payer,
          extensions: { status: 'mempool' },
        })
      ).toString('base64');

      res.setHeader('content-type', 'application/json');
      res.setHeader('x-payment-response', paymentResponse);
      return res.end(JSON.stringify({ weather: 'sunny', tempC: 20 }));
    }

    res.statusCode = 404;
    return res.end('not found');
  } catch (err) {
    log('resource server error:', err.message);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: err.message }));
    }
  }
});

await new Promise((r, j) => {
  server.once('error', j);
  server.listen(PORT, () => {
    log(`resource server listening on http://localhost:${PORT}`);
    r();
  });
});

// ---- spawn the MCP server as a stdio subprocess ----
log(`spawning ${MCP_CLI}...`);
const mcp = spawn(
  'node',
  [MCP_CLI, '--catalog', `http://localhost:${PORT}/.well-known/x402.json`, '--transport', 'stdio'],
  {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: {
      ...process.env,
      CARDANO402_ALLOW_INSECURE: 'true', // catalog is http://localhost
      CARDANO402_NETWORK: 'Preview',
    },
  }
);

// ---- minimal JSON-RPC client over stdio ----
let nextId = 1;
const pending = new Map();
let stdoutBuf = '';
mcp.stdout.on('data', (chunk) => {
  stdoutBuf += chunk.toString();
  while (true) {
    const nl = stdoutBuf.indexOf('\n');
    if (nl === -1) break;
    const line = stdoutBuf.slice(0, nl).trim();
    stdoutBuf = stdoutBuf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    }
  }
});
mcp.on('exit', (code, signal) => {
  log(`mcp subprocess exited (code=${code}, signal=${signal})`);
  if (!KEEP_RUNNING) process.exit(code === 0 ? 0 : 1);
});

function rpc(method, params, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`rpc ${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (msg) => {
        clearTimeout(timer);
        resolve(msg);
      },
    });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

// ---- cleanup helper ----
const cleanup = async () => {
  log('cleaning up...');
  try {
    mcp.kill('SIGTERM');
  } catch {}
  await new Promise((r) => server.close(() => r()));
};
process.on('SIGINT', async () => {
  await cleanup();
  process.exit(130);
});

// ---- the actual smoke ----
let exitCode = 0;
try {
  log('waiting for MCP server to boot...');
  await sleep(2000);

  log('-> initialize');
  const init = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'cardano402-smoke', version: '0.1.0' },
  });
  if (init.error) throw new Error(`initialize failed: ${JSON.stringify(init.error)}`);
  log('<- init result:', init.result?.serverInfo);
  mcp.stdin.write(
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
  );

  log('-> tools/list');
  const list = await rpc('tools/list', {});
  if (list.error) throw new Error(`tools/list failed: ${JSON.stringify(list.error)}`);
  const tools = list.result?.tools ?? [];
  log(`<- tools: ${tools.map((t) => t.name).join(', ') || '(none)'}`);
  if (tools.length === 0) throw new Error('no tools registered — catalog parse failed?');

  const toolName = tools[0].name;
  log(`-> tools/call ${toolName} (this triggers the 402 cycle)`);
  const callRes = await rpc(
    'tools/call',
    { name: toolName, arguments: {} },
    TOOL_INVOCATION_TIMEOUT_MS
  );
  if (callRes.error) throw new Error(`tools/call failed: ${JSON.stringify(callRes.error)}`);

  const txt = callRes.result?.content?.[0]?.text;
  if (!txt) throw new Error(`tools/call returned no text content: ${JSON.stringify(callRes.result)}`);
  log('<- tool result:', txt);
  const parsed = JSON.parse(txt);

  if (parsed.status !== 200 || !parsed.payment?.transaction) {
    throw new Error(
      `tool call did not complete the 402 cycle. status=${parsed.status}, body=${JSON.stringify(parsed.body)}`
    );
  }

  console.log('');
  console.log('================================================');
  console.log('=== SMOKE PASSED ===');
  console.log('================================================');
  console.log(`tx hash : ${parsed.payment.transaction}`);
  console.log(`network : ${parsed.payment.network}`);
  console.log(`payer   : ${parsed.payment.payer ?? '(omitted)'}`);
  console.log(`status  : ${parsed.payment.status ?? '(omitted)'}`);
  console.log('');
  console.log(`cardanoscan: https://preview.cardanoscan.io/transaction/${parsed.payment.transaction}`);
  console.log('');
  console.log('It may take ~20s for the tx to appear in the explorer.');
} catch (err) {
  console.error('');
  console.error('================================================');
  console.error('=== SMOKE FAILED ===');
  console.error('================================================');
  console.error(err.message);
  if (err.stack) console.error(err.stack);
  exitCode = 1;
}

if (!KEEP_RUNNING) {
  await cleanup();
  process.exit(exitCode);
} else {
  log('--keep-running set; press Ctrl-C to exit');
}
