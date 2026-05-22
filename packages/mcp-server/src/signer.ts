// CardanoSigner abstraction + Lucid Evolution implementation.
//
// `payment.ts` only depends on the `CardanoSigner` interface, so unit tests
// can swap in a stub without dragging in CML wasm. The concrete Lucid signer
// loads its deps lazily for the same reason.

import type { LucidNetwork } from './config.js';

export interface SignPaymentArgs {
  payTo: string;
  /** Smallest-unit amount (lovelace for ADA, asset units for native tokens). */
  amount: bigint;
  /** "lovelace" or "policyId.assetNameHex" (cardano402 convention). */
  asset: string;
  /** TTL relative to "now", in seconds. */
  ttlSeconds: number;
}

export interface SignedPayment {
  /** Signed CBOR transaction, base64-encoded — the value of `payload.transaction`. */
  cborBase64: string;
  /** UTXO reference of the form `txHash#index`, one of the tx inputs. */
  nonce: string;
  /** Hex transaction id, useful for logging. */
  txHash: string;
}

export interface CardanoSigner {
  /** Bech32 address that will sign and fund the payment. */
  address(): Promise<string>;
  signPayment(args: SignPaymentArgs): Promise<SignedPayment>;
}

const BLOCKFROST_URLS: Record<LucidNetwork, string> = {
  Preview: 'https://cardano-preview.blockfrost.io/api/v0',
  Preprod: 'https://cardano-preprod.blockfrost.io/api/v0',
  Mainnet: 'https://cardano-mainnet.blockfrost.io/api/v0',
};

export interface LucidSeedSignerOptions {
  network: LucidNetwork;
  blockfrostKey: string;
  seedPhrase: string;
  /** Override the Blockfrost base URL — useful for local proxies and tests. */
  blockfrostUrl?: string;
}

/**
 * Create a `CardanoSigner` backed by Lucid Evolution + Blockfrost.
 *
 * Loads `@lucid-evolution/{lucid,provider}` lazily so callers that only
 * use the catalog / config code paths don't pay the CML wasm startup
 * cost or carry the dep in their bundle.
 */
export async function createLucidSeedSigner(
  options: LucidSeedSignerOptions
): Promise<CardanoSigner> {
  const { Lucid } = await import('@lucid-evolution/lucid');
  const { Blockfrost } = await import('@lucid-evolution/provider');

  const url = options.blockfrostUrl ?? BLOCKFROST_URLS[options.network];
  const provider = new Blockfrost(url, options.blockfrostKey);
  const lucid = await Lucid(provider, options.network);
  lucid.selectWallet.fromSeed(options.seedPhrase);

  return {
    async address(): Promise<string> {
      return lucid.wallet().address();
    },
    async signPayment({ payTo, amount, asset, ttlSeconds }: SignPaymentArgs): Promise<SignedPayment> {
      const assets =
        asset === 'lovelace'
          ? { lovelace: amount }
          : { [asset]: amount };

      const txBuilder = lucid.newTx().pay.ToAddress(payTo, assets);
      // Lucid's `validTo` takes an absolute POSIX ms timestamp. Stay a few
      // seconds under the catalog-advertised `maxTimeoutSeconds` so the
      // facilitator's TTL check still passes after broadcast latency and
      // mild client/server clock skew. Floor at 10s for tight TTLs.
      const safetySeconds = Math.min(5, Math.max(1, Math.floor(ttlSeconds * 0.05)));
      const validTo = Date.now() + Math.max(10, ttlSeconds - safetySeconds) * 1000;
      const built = await txBuilder
        .validTo(validTo)
        .complete();
      const signed = await built.sign.withWallet().complete();

      const cborHex = signed.toCBOR();
      const cborBase64 = Buffer.from(cborHex, 'hex').toString('base64');
      const txHash = signed.toHash();

      // Pick the first input as the nonce. Per the x402 Cardano spec the
      // nonce only has to be ONE of the inputs and be currently unspent;
      // Lucid's coin selection guarantees every chosen input was unspent
      // at build time, so [0] is always a valid choice.
      const cmlTx = signed.toTransaction();
      let nonce: string;
      try {
        const body = cmlTx.body();
        const inputs = body.inputs();
        if (inputs.len() === 0) {
          throw new Error('signed transaction has no inputs');
        }
        const first = inputs.get(0);
        const inputHash = first.transaction_id().to_hex();
        const index = Number(first.index());
        nonce = `${inputHash}#${index}`;
      } finally {
        // CML objects are WASM-backed; free aggressively.
        cmlTx.free();
      }

      return { cborBase64, nonce, txHash };
    },
  };
}
