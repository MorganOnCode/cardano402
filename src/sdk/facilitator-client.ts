// FacilitatorClient -- HTTP wrapper for the x402 facilitator API.
//
// The implementation lives in @cardano402/core. This module preserves the
// import path `src/sdk/facilitator-client` so existing callers (notably
// src/routes/upload.ts and the test suite) don't need to change.
//
// Behavior note: the new FacilitatorClient throws typed `Cardano402*Error`
// subclasses instead of plain Error. All still subclass Error, so any
// `instanceof Error` check keeps working.

export { FacilitatorClient } from '@cardano402/core';
export type { FacilitatorClientOptions } from '@cardano402/core';
