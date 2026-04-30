// Plutus V3 script-payment verification (stub).
//
// Per the x402 Cardano spec, the `script` asset transfer method requires:
//   - The transaction pays to a script address derived from
//       (script code + applied parameters + network)
//   - The output at `payTo` carries the expected datum encoding the
//     parameters
//   - At least one of `scriptHash` or `script` is provided in `extra`
//
// Building the script-address derivation correctly demands:
//   1. A Plutus parameter applier compatible with @lucid-evolution/lucid
//   2. Type-aware encoding for `bytes`, `bigint`, `bool`, `list`, `map`,
//      `constr` parameter shapes
//   3. Datum decoding for the expected output
//
// Until that lands, this verifier returns a structured failure rather than
// silently passing or rejecting.

import type { FastifyBaseLogger } from 'fastify';

import type { VerifyContext, VerifyResponse } from '../types.js';

export async function verifyScript(
  _ctx: VerifyContext,
  logger?: FastifyBaseLogger
): Promise<VerifyResponse> {
  logger?.warn(
    'Received request with assetTransferMethod="script" but the Script verifier is not implemented yet'
  );
  return Promise.resolve({
    isValid: false,
    invalidReason: 'method_not_implemented',
    invalidMessage:
      'The "script" assetTransferMethod is recognised but not yet implemented in this facilitator. Set assetTransferMethod="default" for address-to-address payments.',
    extensions: {
      method: 'script',
      status: 'unimplemented',
    },
  });
}
