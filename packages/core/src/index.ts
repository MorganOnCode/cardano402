// @cardano402/core — framework-agnostic SDK surface (scaffold).
//
// Targets:
//   - Re-export wire-format Zod schemas from src/sdk/types.ts and src/verify/types.ts
//   - Provide a tiny FacilitatorClient that depends only on globalThis.fetch
//   - Provide an "x402 client" that handles 402 retries given a WalletSigner
//
// Until this package is fleshed out, importers should pull from the root
// `cardano402/sdk` export. This stub exists to reserve the package name and
// surface the intended import path to consumers and contributors.

export const STATUS = 'scaffold' as const;

export function notImplemented(): never {
  throw new Error(
    '@cardano402/core has not been implemented yet. Use the root "cardano402/sdk" export from this repo.'
  );
}
