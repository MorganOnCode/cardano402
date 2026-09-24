// The AXI home view: what an agent sees on GET /. Content first (live network
// and settlement bounds from /supported), then a few runnable next steps.
// SKILL.md and llms.txt are generated from the same data so they never drift.

import { encode } from '@toon-format/toon';
import { VERSION } from './version';

export const DESCRIPTION =
  'Keyless Cardano x402 facilitator: verifies and broadcasts payer-signed exact-scheme payments (x402 v2)';

export type SupportedKind = {
  x402Version: number;
  scheme: string;
  network: string;
  extra?: Record<string, unknown>;
};

const ENDPOINTS = [
  { method: 'GET', path: '/supported', purpose: 'payment kinds and confirmation bounds' },
  { method: 'POST', path: '/verify', purpose: 'check a PAYMENT-SIGNATURE against requirements' },
  { method: 'POST', path: '/settle', purpose: 'broadcast once, report confirmation evidence' },
  { method: 'GET', path: '/health', purpose: 'liveness; ?deep=1 also probes the chain provider' },
];

export function homeData(origin: string, kinds: SupportedKind[]) {
  return {
    service: 'cardano402',
    version: VERSION,
    description: DESCRIPTION,
    standard: 'x402 v2, exact scheme, @x402/cardano reference implementation',
    custody: 'none - payers sign; this facilitator holds no keys and no funds',
    kinds: kinds.map((k) => ({
      x402Version: k.x402Version,
      scheme: k.scheme,
      network: k.network,
      l1Confirmations: formatRange(k.extra?.l1Confirmations),
    })),
    endpoints: ENDPOINTS,
    help: [
      `Run \`curl -s ${origin}/supported\` for the machine-readable kinds`,
      `Use \`new HTTPFacilitatorClient({ url: "${origin}" })\` from @x402/core as your resource server's facilitator`,
      `Run \`curl -s ${origin}/SKILL.md\` for integration steps`,
    ],
  };
}

function formatRange(value: unknown): string {
  if (value && typeof value === 'object' && 'minimum' in value && 'maximum' in value) {
    return `${String(value.minimum)}..${String(value.maximum)}`;
  }
  return 'unknown';
}

export function homeToon(origin: string, kinds: SupportedKind[]): string {
  // help[] is prose, one step per line (AXI style), not a TOON inline array.
  const { help, ...data } = homeData(origin, kinds);
  return `${encode(data)}\nhelp[${help.length}]:\n${help.map((h) => `  ${h}`).join('\n')}\n`;
}

export function homeHtml(origin: string, kinds: SupportedKind[]): string {
  const body = escapeHtml(homeToon(origin, kinds));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>cardano402</title>
<meta name="description" content="${escapeHtml(DESCRIPTION)}">
<style>
  :root { color-scheme: light dark; --bg: #fafaf7; --fg: #1b1b18; --muted: #6b6b63; --accent: #0033ad; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111210; --fg: #e8e8e2; --muted: #9a9a90; --accent: #7aa2ff; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 48px 16px; }
  h1 { font-size: 22px; margin: 0 0 4px; } p { color: var(--muted); margin: 0 0 24px; }
  pre { overflow-x: auto; padding: 16px; border: 1px solid color-mix(in srgb, var(--fg) 15%, transparent); border-radius: 8px; font: 13px/1.5 ui-monospace, monospace; }
  a { color: var(--accent); }
</style>
</head>
<body>
<main>
<h1>cardano402</h1>
<p>${escapeHtml(DESCRIPTION)}. Agents get this page as <a href="https://toonformat.dev/">TOON</a> by default; see <a href="${origin}/SKILL.md">SKILL.md</a> and <a href="${origin}/supported">/supported</a>.</p>
<pre>${body}</pre>
<p>Source: <a href="https://github.com/MorganOnCode/cardano402">github.com/MorganOnCode/cardano402</a> · Standard: <a href="https://github.com/x402-foundation/x402">x402 Foundation</a></p>
</main>
</body>
</html>
`;
}

export function skillMd(origin: string, kinds: SupportedKind[]): string {
  const networks = kinds.map((k) => k.network).join(', ') || 'none configured';
  return `---
name: cardano402
description: Settle x402 payments on Cardano (${networks}) through the keyless cardano402 facilitator. Use when a resource server needs a Cardano facilitator URL, or an agent must pay an x402 402 that names cardano402.
---

# cardano402

${DESCRIPTION}.

Facilitator URL: \`${origin}\` — standard x402 v2 endpoints, so any @x402/core
resource server can use it unchanged.

## Resource server

\`\`\`ts
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactCardanoScheme } from "@x402/cardano/exact/server";

const facilitator = new HTTPFacilitatorClient({ url: "${origin}" });
// register ExactCardanoScheme for "${kinds[0]?.network ?? 'cardano:mainnet'}" on your x402ResourceServer
\`\`\`

Flow is *authorization*: verify, run your handler, then settle. If your handler
fails, do not settle — nothing is broadcast and the payer is not charged.

## Payer

Sign with \`toClientCardanoSigner\` or any CIP-30 wallet via \`ClientCardanoSigner\`
from @x402/cardano. The payer pays the network fee; the facilitator never signs.

## Settlement

- \`settlement_pending\` is not a failure: retry the same payload once; the
  facilitator resumes observing the same transaction and never re-broadcasts.
- Confirmation bounds per network are in \`GET ${origin}/supported\`.

## Endpoints

${ENDPOINTS.map((e) => `- \`${e.method} ${e.path}\` — ${e.purpose}`).join('\n')}
`;
}

export function llmsTxt(origin: string, kinds: SupportedKind[]): string {
  return `# cardano402

> ${DESCRIPTION}. Networks: ${kinds.map((k) => k.network).join(', ')}.

- [SKILL.md](${origin}/SKILL.md): integration steps for resource servers and payers
- [Supported kinds](${origin}/supported): x402 /supported JSON
- [Source](https://github.com/MorganOnCode/cardano402)
- [x402 Cardano exact spec](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_cardano.md)
`;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
}
