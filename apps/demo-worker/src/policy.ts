import type { PaymentRequirements } from '@x402/core/types';
export const NETWORK = 'cardano:preview';
export const PROVIDER = 'https://cardano-preview.blockfrost.io/api/v0';
export const DAILY_RUNS = 5;
export const COOLDOWN_MS = 10 * 60 * 1000;
export const MAX_SETTLEMENT_ATTEMPTS = 2;
export function requirements(address: string): PaymentRequirements {
  if (!address.startsWith('addr_test1')) throw new Error('Expected a testnet address');
  return {
    scheme: 'exact',
    network: NETWORK,
    amount: '2000000',
    asset: 'lovelace',
    payTo: address,
    maxTimeoutSeconds: 300,
    extra: { assetTransferMethod: 'default', confirmationPolicy: { l1Confirmations: 0 } },
  };
}
