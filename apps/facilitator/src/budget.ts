import type { Context } from 'hono';
import type { DAILY_LIMITS } from './settlement-store';

export async function budget(env: CloudflareBindings, kind: keyof typeof DAILY_LIMITS) {
  return env.SETTLEMENTS.get(env.SETTLEMENTS.idFromName('global')).takeBudget(kind);
}
export function quotaResponse(c: Context) {
  const retry = Math.ceil((86_400_000 - (Date.now() % 86_400_000)) / 1000);
  c.header('Retry-After', String(retry));
  c.header('Cache-Control', 'no-store');
  return c.json({ error: 'Daily demo allowance reached. Please return tomorrow.' }, 429);
}
