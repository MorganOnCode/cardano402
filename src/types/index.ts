// cardano402 type definitions

import type Redis from 'ioredis';

import type { ServiceCatalog } from '../catalog.js';
import type { ChainProvider } from '../chain/provider.js';
import type { Config } from '../config/index.js';
import type { PaymentResponseHeader } from '../sdk/types.js';
import type { StorageBackend } from '../storage/types.js';

export interface ServerOptions {
  config: Config;
}

// Augment Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    redis: Redis;
    chainProvider: ChainProvider;
    storage: StorageBackend;
    catalog: ServiceCatalog;
  }

  interface FastifyRequest {
    x402Settlement?: PaymentResponseHeader;
  }
}
