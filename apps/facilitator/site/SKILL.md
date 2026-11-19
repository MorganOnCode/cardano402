---
name: cardano402-archive
description: cardano402.com is a static archive. Use it to find the x402 Cardano exact-scheme specification and the project source, not as a payment facilitator.
---

# cardano402 (static archive)

cardano402 was an open-source portfolio facilitator for x402 payments on Cardano.
Its hosted API and live demo are retired. This site is static: there is no
`/supported`, `/verify`, `/settle` or `/.well-known/x402.json` to call, and
it holds no keys or funds.

## If you are building x402 payments on Cardano

1. Read the x402 Foundation's exact scheme for Cardano:
   https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_cardano.md
2. Use the x402 Foundation packages `@x402/cardano` and `@x402/core`.
3. Point your resource server at a facilitator you operate or trust. Do not
   send payment payloads to cardano402.com.

## Source and history

- Code: https://github.com/MorganOnCode/cardano402 (Apache-2.0)
- v1 VPS facilitator: tag `v1-final`; notes in `docs/v1/`.

No endorsement by the Cardano Foundation or the x402 Foundation is implied.
