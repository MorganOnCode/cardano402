import { DurableObject } from 'cloudflare:workers';
import { toClientCardanoSigner } from '@x402/cardano';
import { ExactCardanoScheme } from '@x402/cardano/exact/client';
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from '@x402/core/types';
import {
  COOLDOWN_MS,
  DAILY_RUNS,
  MAX_SETTLEMENT_ATTEMPTS,
  NETWORK,
  PROVIDER,
  requirements,
} from './policy';

interface Run {
  started: number;
  state: 'preparing' | 'pending' | 'confirmed' | 'failed';
  attempts: number;
  payload?: PaymentPayload;
  requirements?: PaymentRequirements;
  transaction?: string;
  message: string;
}
export class DemoWallet extends DurableObject<DemoBindings> {
  private running?: Promise<{ body: string; status: number }>;

  async fetch(): Promise<Response> {
    if (
      String(this.env.LIVE_DEMO_ENABLED) !== 'true' ||
      !this.env.DEMO_TESTNET_MNEMONIC ||
      !this.env.BLOCKFROST_PROJECT_ID?.startsWith('preview')
    ) {
      return Response.json({ error: 'Live demo is not enabled yet.' }, { status: 503 });
    }
    // One funded wallet: coalesce concurrent visitors instead of spending twice.
    // Durable state below also prevents a restart from replacing an ambiguous tx.
    if (!this.running) {
      this.running = this.run().then(async (response) => ({
        body: await response.text(),
        status: response.status,
      }));
    }
    const operation = this.running;
    try {
      const result = await operation;
      return new Response(result.body, {
        status: result.status,
        headers: { 'content-type': 'application/json' },
      });
    } finally {
      if (this.running === operation) this.running = undefined;
    }
  }

  private result(run: Run, cached = false) {
    return Response.json(
      {
        state: run.state,
        network: NETWORK,
        transaction: run.transaction,
        recipient: run.requirements?.payTo,
        amount: '2000000',
        started: run.started,
        cached,
        message: run.message,
        steps:
          run.state === 'failed'
            ? []
            : [
                'Payment terms prepared',
                'Project wallet signs a 2 test ADA self-payment',
                'x402 facilitator verifies',
                'Receipt prepared',
                'Facilitator submits and checks Cardano',
              ],
      },
      { status: run.state === 'pending' ? 202 : 200 }
    );
  }

  private async call<T>(path: string, body: unknown): Promise<T> {
    const response = await this.env.FACILITATOR.fetch(`https://facilitator.internal${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(95_000),
    });
    if (!response.ok) throw new Error('Facilitator unavailable');
    return response.json<T>();
  }

  private async run(): Promise<Response> {
    let run = await this.ctx.storage.get<Run>('run');
    if (run?.state === 'preparing') {
      // Signing never submits. A crash during preparation is safe to mark failed.
      run = {
        ...run,
        state: 'failed',
        message: 'Preparation was interrupted; no transaction was submitted.',
      };
      await this.ctx.storage.put('run', run);
    }
    if (run?.state === 'pending') {
      if (run.attempts >= MAX_SETTLEMENT_ATTEMPTS) return this.result(run, true);
      return this.settle(run);
    }
    if (run && Date.now() - run.started < COOLDOWN_MS) return this.result(run, true);
    const day = Math.floor(Date.now() / 86_400_000);
    const allowed = await this.ctx.storage.transaction(async (txn) => {
      const quota = await txn.get<{ day: number; used: number }>('quota');
      if (quota?.day === day && quota.used >= DAILY_RUNS) return false;
      await txn.put('quota', { day, used: quota?.day === day ? quota.used + 1 : 1 });
      return true;
    });
    if (!allowed)
      return Response.json(
        { error: 'Today’s five live demos have been used. Please return tomorrow.' },
        { status: 429 }
      );
    run = {
      started: Date.now(),
      state: 'preparing',
      attempts: 0,
      message: 'Preparing a testnet self-payment',
    };
    await this.ctx.storage.put('run', run);
    let stage = 'wallet initialization';
    try {
      const signer = toClientCardanoSigner({
        mnemonic: this.env.DEMO_TESTNET_MNEMONIC!,
        network: NETWORK,
        provider: {
          blockfrost: { baseUrl: PROVIDER, projectId: this.env.BLOCKFROST_PROJECT_ID! },
          requestTimeoutMs: 30_000,
        },
      });
      const terms = requirements(signer.getAddress());
      stage = 'transaction construction';
      const signed = await new ExactCardanoScheme(signer).createPaymentPayload(2, terms);
      const payload: PaymentPayload = { ...signed, accepted: terms };
      stage = 'facilitator verification';
      const verified = await this.call<VerifyResponse>('/verify', {
        paymentPayload: payload,
        paymentRequirements: terms,
      });
      if (!verified.isValid) throw new Error('Verification failed');
      // Persist the exact signed bytes BEFORE the only code that may submit.
      run = {
        ...run,
        state: 'pending',
        requirements: terms,
        payload,
        message: 'Awaiting testnet confirmation',
      };
      await this.ctx.storage.put('run', run);
    } catch {
      run = {
        ...run,
        state: 'failed',
        message: `Could not complete ${stage}. No payment was submitted.`,
      };
      await this.ctx.storage.put('run', run);
      return this.result(run);
    }
    return this.settle(run);
  }

  private async settle(run: Run): Promise<Response> {
    run.attempts++;
    await this.ctx.storage.put('run', run);
    try {
      const result = await this.call<SettleResponse>('/settle', {
        paymentPayload: run.payload,
        paymentRequirements: run.requirements,
      });
      if (/^[0-9a-f]{64}$/.test(result.transaction)) run.transaction = result.transaction;
      if (result.success) {
        run.state = 'confirmed';
        run.message =
          'Confirmed: the project test wallet sent 2 test ADA to itself and paid the network fee.';
        delete run.payload;
      } else {
        run.message =
          'Not confirmed yet. Check the explorer. No new payment will be created while this transaction is unresolved.';
      }
    } catch {
      run.message =
        'Confirmation unavailable. The transaction may have been submitted. No replacement payment will be created.';
    }
    await this.ctx.storage.put('run', run);
    return this.result(run);
  }
}

export default {
  async fetch(request: Request, env: DemoBindings): Promise<Response> {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/run')
      return new Response('Not found', { status: 404 });
    return env.WALLET.get(env.WALLET.idFromName('project-test-wallet')).fetch(
      'https://wallet.internal/run',
      { method: 'POST' }
    );
  },
};
