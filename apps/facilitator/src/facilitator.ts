// Builds the x402 facilitator from Worker bindings. Keyless by design: the
// reference signer runs provider-only (no mnemonic), so this Worker can verify
// and broadcast payer-signed transactions but can never move funds itself.

import { toFacilitatorCardanoSigner } from '@x402/cardano';
import { ExactCardanoScheme } from '@x402/cardano/exact/facilitator';
import { x402Facilitator } from '@x402/core/facilitator';
import type { Network } from '@x402/core/types';
import { durableSettlementStore } from './settlement-store';

const BLOCKFROST_URLS: Record<string, string> = {
  'cardano:mainnet': 'https://cardano-mainnet.blockfrost.io/api/v0',
  'cardano:preprod': 'https://cardano-preprod.blockfrost.io/api/v0',
  'cardano:preview': 'https://cardano-preview.blockfrost.io/api/v0',
};

// One settle() call must return inside the resource server's facilitator
// timeout (@x402/core defaults to 90s); core retries a pending settlement once
// and the retry resumes observing the same transaction.
export const CONFIRMATION_TIMEOUT_MS = 75_000;

export class ConfigError extends Error {}

export function blockfrostUrl(network: string): string {
  const url = BLOCKFROST_URLS[network];
  if (!url)
    throw new ConfigError(
      `CARDANO_NETWORK must be one of ${Object.keys(BLOCKFROST_URLS).join(', ')}`
    );
  return url;
}

let cached: { key: string; facilitator: x402Facilitator } | undefined;

export function getFacilitator(env: CloudflareBindings): x402Facilitator {
  const network = env.CARDANO_NETWORK;
  const projectId = env.BLOCKFROST_PROJECT_ID;
  if (!projectId) throw new ConfigError('BLOCKFROST_PROJECT_ID secret is not set');
  const key = `${network}:${projectId}`;
  if (cached?.key === key) return cached.facilitator;

  const signer = toFacilitatorCardanoSigner({
    network,
    provider: {
      blockfrost: { baseUrl: blockfrostUrl(network), projectId },
      requestTimeoutMs: 15_000,
    },
    // Return on broadcast; the scheme polls Blockfrost for the policy's evidence.
    awaitConfirmation: false,
  });
  const scheme = new ExactCardanoScheme(signer, {
    settlementStore: durableSettlementStore(env.SETTLEMENTS),
    confirmationTimeoutMs: CONFIRMATION_TIMEOUT_MS,
  });
  const facilitator = new x402Facilitator().register(network as Network, scheme);
  cached = { key, facilitator };
  return facilitator;
}
