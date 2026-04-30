// @cardano402/fetch — fetch adapter (scaffold).
//
// Planned surface (subject to refinement during Track D3):
//
//   import cardano402 from '@cardano402/fetch';
//   app.use(cardano402('addr1...', { '/api/analyze': '2 USDM' }));
//
// Until this package is implemented, depend on the root cardano402 repo
// directly. This stub reserves the package name and surfaces the
// intended public API to contributors.

export const STATUS = 'scaffold' as const;

export function notImplemented(): never {
  throw new Error(
    '@cardano402/fetch is scaffolding only. Track D3 in cardano402-upgrade-plan.md.'
  );
}
