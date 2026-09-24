import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { blockfrostUrl, ConfigError, getFacilitator } from './facilitator';
import { homeHtml, homeToon, llmsTxt, skillMd, type SupportedKind } from './home';
import { VERSION } from './version';

export { SettlementStore } from './settlement-store';

type Env = { Bindings: CloudflareBindings };

// A signed Cardano transaction is at most 16 KiB of CBOR; base64 plus the
// requirements envelope fits comfortably in 64 KiB.
const MAX_BODY_BYTES = 64 * 1024;

const app = new Hono<Env>();

app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'] }));

app.onError((err, c) => {
  if (err instanceof ConfigError) {
    console.error('config error', err.message);
    return c.json({ error: 'facilitator is not configured for this network' }, 503);
  }
  console.error('unhandled error', err);
  return c.json({ error: err instanceof Error ? err.message : 'internal error' }, 500);
});

function supportedKinds(env: CloudflareBindings): SupportedKind[] {
  return getFacilitator(env).getSupported().kinds;
}

function prefersHtml(c: Context): boolean {
  return (c.req.header('accept') ?? '').includes('text/html');
}

app.get('/', (c) => {
  const origin = new URL(c.req.url).origin;
  const kinds = supportedKinds(c.env);
  c.header('Vary', 'Accept');
  if (prefersHtml(c)) return c.html(homeHtml(origin, kinds));
  return c.text(homeToon(origin, kinds), 200, { 'Content-Type': 'text/plain; charset=utf-8' });
});

app.get('/SKILL.md', (c) =>
  c.text(skillMd(new URL(c.req.url).origin, supportedKinds(c.env)), 200, {
    'Content-Type': 'text/markdown; charset=utf-8',
  })
);

app.get('/llms.txt', (c) => c.text(llmsTxt(new URL(c.req.url).origin, supportedKinds(c.env))));

app.get('/robots.txt', (c) => c.text('User-agent: *\nAllow: /\n'));

app.get('/supported', (c) => c.json(getFacilitator(c.env).getSupported()));

app.get('/health', async (c) => {
  const base = { status: 'ok', version: VERSION, network: c.env.CARDANO_NETWORK };
  if (c.req.query('deep') !== '1') return c.json(base);

  const settlements = await c.env.SETTLEMENTS.get(c.env.SETTLEMENTS.idFromName('global')).stats();
  let provider: 'up' | 'down' = 'down';
  let tip: number | undefined;
  try {
    const res = await fetch(`${blockfrostUrl(c.env.CARDANO_NETWORK)}/blocks/latest`, {
      headers: { project_id: c.env.BLOCKFROST_PROJECT_ID ?? '' },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      provider = 'up';
      tip = ((await res.json()) as { height?: number }).height;
    }
  } catch {
    // provider stays 'down'
  }
  const status = provider === 'up' ? 'ok' : 'degraded';
  return c.json({ ...base, status, provider, tip, settlements }, provider === 'up' ? 200 : 503);
});

type PaymentBody = { paymentPayload?: PaymentPayload; paymentRequirements?: PaymentRequirements };

async function readPaymentBody(c: Context<Env>): Promise<Required<PaymentBody> | Response> {
  const limiter = c.env.PAYMENT_LIMITER;
  if (limiter) {
    const key = c.req.header('cf-connecting-ip') ?? 'unknown';
    const { success } = await limiter.limit({ key });
    if (!success) return c.json({ error: 'rate limited; retry after 60s' }, 429);
  }
  let body: PaymentBody;
  try {
    body = await c.req.json<PaymentBody>();
  } catch {
    return c.json(
      { error: 'body must be JSON: { x402Version, paymentPayload, paymentRequirements }' },
      400
    );
  }
  const { paymentPayload, paymentRequirements } = body ?? {};
  if (!isObject(paymentPayload) || !isObject(paymentRequirements)) {
    return c.json({ error: 'Missing paymentPayload or paymentRequirements' }, 400);
  }
  return { paymentPayload, paymentRequirements };
}

const limitBody = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => c.json({ error: `body exceeds ${MAX_BODY_BYTES} bytes` }, 413),
});

app.post('/verify', limitBody, async (c) => {
  const body = await readPaymentBody(c);
  if (body instanceof Response) return body;
  return c.json(await getFacilitator(c.env).verify(body.paymentPayload, body.paymentRequirements));
});

app.post('/settle', limitBody, async (c) => {
  const body = await readPaymentBody(c);
  if (body instanceof Response) return body;
  const facilitator = getFacilitator(c.env);
  const settlement = facilitator.settle(body.paymentPayload, body.paymentRequirements);
  // If the caller disconnects mid-settle, keep the isolate alive long enough
  // to record the broadcast in the settlement store.
  c.executionCtx.waitUntil(settlement.catch(() => undefined));
  try {
    return c.json(await settlement);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Settlement aborted:')) {
      return c.json({
        success: false,
        errorReason: error.message.replace('Settlement aborted: ', ''),
        network: body.paymentPayload.accepted?.network ?? 'unknown',
        transaction: '',
      });
    }
    throw error;
  }
});

app.notFound((c) =>
  c.json(
    {
      error: `no route ${c.req.method} ${new URL(c.req.url).pathname}`,
      help: 'GET / lists the endpoints',
    },
    404
  )
);

function isObject(v: unknown): v is Record<string, never> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export default app;
