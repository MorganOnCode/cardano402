import { describe, expect, it } from 'vitest';
import { demoEnabled } from '../src/demo';

describe('testnet enablement gate', () => {
  const config = {
    LIVE_DEMO_ENABLED: 'true',
    CARDANO_NETWORK: 'cardano:preview',
    BLOCKFROST_PROJECT_ID: 'preview-test',
  };
  it('requires an explicit enable flag and a matching Preview provider key', () => {
    expect(demoEnabled(config as unknown as CloudflareBindings)).toBe(true);
    for (const change of [
      { LIVE_DEMO_ENABLED: 'false' },
      { BLOCKFROST_PROJECT_ID: undefined },
      { BLOCKFROST_PROJECT_ID: 'mainnet-test' },
      { CARDANO_NETWORK: 'cardano:mainnet' },
      { CARDANO_NETWORK: 'cardano:preprod' },
    ])
      expect(demoEnabled({ ...config, ...change } as unknown as CloudflareBindings)).toBe(false);
  });
});
