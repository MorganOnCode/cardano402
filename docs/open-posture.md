# Open posture: registry-free, federated, no central party

cardano402 is built around a single design choice: any Cardano wallet
holder should be able to publish a priced API endpoint, and any Cardano
wallet holder should be able to pay one. No accounts, no API keys, no
agent identifiers, no review process, no whitelist.

## Four commitments

1. **Zero mandatory registration.** You do not register your server with
   anyone to accept payments. You stand up an HTTP server, point it at a
   facilitator (yours or a public one), and accept payments. There is no
   approval gate.

2. **Zero mandatory identity.** The `default` (address-to-address)
   asset transfer method requires no off-chain identity record. The
   Cardano address you list as `payTo` is the only identity needed.
   Optional richer methods (e.g. `script` for Plutus V3 escrows) exist
   for use cases that genuinely need additional contract structure, but
   they are never required for plain payment flows.

3. **Zero mandatory central party.** Any party can run a facilitator. The
   reference implementation in this repo runs on commodity Node.js,
   Redis, and Blockfrost (or any other Cardano node access). The hosted
   instance at `cardano402.com` is a convenience, not a requirement. If
   you do not trust it, run your own.

4. **Federated discovery.** Server discovery happens via
   `/.well-known/x402.json`. Any agent or crawler can walk the public
   internet and find priced endpoints. Multiple indexers can scrape and
   re-publish their views; none is authoritative. The server is the
   directory.

## Why this matters

Centralised payment registries (Stripe accounts, app stores, the
Coinbase Bazaar via the CDP API) are good products. They are also
permission-shaped: an entity decides who can sell, often what can be
sold, and frequently keeps a percentage of every transaction. That is
fine for many workflows.

It is not fine for every workflow. Some agents and some operators want
the ability to publish a priced endpoint at midnight on a holiday and
have a paying agent reach it ten minutes later, with no third party
between them other than the chain. cardano402 is the path that supports
that workflow.

## Where this posture stops

cardano402 is open and registry-free for the `default` method. Richer
methods such as `script` (Plutus V3 with applied parameters) carry
additional contract structure by virtue of what they are. If you opt
into one of those, you have already opted into a richer model — that
is yours to define, not the protocol's to require.

## What this is not

This posture is not a claim that cardano402 is decentralised. The
facilitator backend has operators, and a server's hosting provider
matters. What it is: a commitment that those choices are yours, not
ours, and that nothing in the protocol forces you through a single
gateway.
