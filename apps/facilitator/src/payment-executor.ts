import { DurableObject } from 'cloudflare:workers';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { getFacilitator } from './facilitator';

// Cardano verification exceeded the ordinary Free Worker CPU allowance in the
// live benchmark. Keep the SDK's cryptography in a Durable Object; the HTTP
// Worker handles validation/rate limits and forwards the exact protocol body.
// JSON preserves the SDK response extensions across the RPC serialization boundary.
export class PaymentExecutor extends DurableObject<CloudflareBindings> {
  async verify(payload: PaymentPayload, requirements: PaymentRequirements) {
    return JSON.stringify(await getFacilitator(this.env).verify(payload, requirements));
  }

  async settle(payload: PaymentPayload, requirements: PaymentRequirements) {
    const settlement = getFacilitator(this.env).settle(payload, requirements);
    // A disconnected client must not interrupt recording a submitted payment.
    this.ctx.waitUntil(settlement.catch(() => undefined));
    return JSON.stringify(await settlement);
  }
}
