// Builds the x402 facilitator from Worker bindings. Keyless by design: the
// reference signer runs provider-only (no mnemonic), so this Worker can verify
// and broadcast payer-signed transactions but can never move funds itself.

import { toFacilitatorCardanoSigner } from '@x402/cardano';
import { ExactCardanoScheme } from '@x402/cardano/exact/facilitator';
import { x402Facilitator } from '@x402/core/facilitator';
import type { Network } from '@x402/core/types';
import { budget } from './budget';
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
export const CONFIRMATION_POLL_MS = 15_000;

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
  if (network !== 'cardano:preview')
    throw new ConfigError('This portfolio demo only supports preview testnet');
  const projectId = env.BLOCKFROST_PROJECT_ID;
  if (!projectId?.startsWith('preview'))
    throw new ConfigError('A preview BLOCKFROST_PROJECT_ID is required');
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
  // Bound upstream work as well as incoming requests. One SDK operation may
  // make multiple HTTP calls, so this is an operation cap, not a billing meter.
  for (const method of [
    'getUtxo',
    'getCurrentSlot',
    'submitTransaction',
    'evaluateTransaction',
    'getTransactionEvidence',
    'getProtocolParameters',
  ] as const) {
    const original = signer[method];
    if (!original) continue;
    // Preserve each method's public signature while wrapping its invocation.
    Object.defineProperty(signer, method, {
      value: async (...args: unknown[]) => {
        if (!(await budget(env, 'provider')))
          throw new Error('Daily chain-provider allowance reached');
        return Reflect.apply(original, signer, args);
      },
      writable: true,
    });
  }
  // Cache only protocol parameters briefly. Never cache UTXO spentness,
  // transaction evidence, submission results, or failures.
  const readParameters = signer.getProtocolParameters?.bind(signer);
  if (readParameters) {
    let value: Awaited<ReturnType<typeof readParameters>> | undefined;
    let expires = 0;
    signer.getProtocolParameters = async (network) => {
      if (value && Date.now() < expires) return value;
      value = await readParameters(network);
      expires = Date.now() + 60_000;
      return value;
    };
  }
  const scheme = new ExactCardanoScheme(signer, {
    settlementStore: durableSettlementStore(env.SETTLEMENTS),
    confirmationTimeoutMs: CONFIRMATION_TIMEOUT_MS,
    confirmationPollMs: CONFIRMATION_POLL_MS,
  });
  const facilitator = new x402Facilitator().register(network as Network, scheme);
  cached = { key, facilitator };
  return facilitator;
}
