import { describe, it, expect } from 'vitest';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { helpText, loadConfig, lucidNetworkFromCaip2, parseArgs } from '../src/config.js';

const VALID_ENV = {
  SEED_PHRASE: 'a b c d e f g h i j k l m n o p q r s t u v w x',
  BLOCKFROST_KEY: 'preview1234567890',
};

describe('lucidNetworkFromCaip2', () => {
  it.each([
    ['cardano:mainnet', 'Mainnet'],
    ['cardano:preprod', 'Preprod'],
    ['cardano:preview', 'Preview'],
    ['CARDANO:MAINNET', 'Mainnet'],
  ])('maps %s to %s', (input, expected) => {
    expect(lucidNetworkFromCaip2(input)).toBe(expected);
  });

  it('returns null for non-cardano chains', () => {
    expect(lucidNetworkFromCaip2('eip155:1')).toBeNull();
    expect(lucidNetworkFromCaip2('cardano:something-else')).toBeNull();
  });
});

describe('parseArgs', () => {
  it('parses --catalog and --transport', () => {
    expect(
      parseArgs(['--catalog', 'https://x/.well-known/x402.json', '--transport', 'http'])
    ).toEqual({ catalog: 'https://x/.well-known/x402.json', transport: 'http' });
  });

  it('accepts --flag=value form', () => {
    expect(parseArgs(['--catalog=https://x.example/.well-known/x402.json'])).toEqual({
      catalog: 'https://x.example/.well-known/x402.json',
    });
  });

  it('parses spend store path and seed phrase file flags', () => {
    expect(
      parseArgs([
        '--spend-store-path',
        '/tmp/cardano402-spend.json',
        '--seed-phrase-file',
        '/run/secrets/cardano402.seed',
      ])
    ).toEqual({
      spendStorePath: '/tmp/cardano402-spend.json',
      seedPhraseFile: '/run/secrets/cardano402.seed',
    });
  });

  it('recognises --help and -h', () => {
    expect(parseArgs(['--help'])).toEqual({ help: true });
    expect(parseArgs(['-h'])).toEqual({ help: true });
  });
});

describe('loadConfig', () => {
  function writeSeedFile(mode = 0o600): string {
    const dir = mkdtempSync(join(tmpdir(), 'cardano402-seed-'));
    const path = join(dir, 'seed.txt');
    writeFileSync(path, `${VALID_ENV.SEED_PHRASE}\n`, { mode });
    chmodSync(path, mode);
    return path;
  }

  it('parses a valid CLI + env combination', () => {
    const config = loadConfig({
      argv: ['--catalog', 'https://api.example.com/.well-known/x402.json'],
      env: VALID_ENV,
    });
    expect(config.catalogUrl).toBe('https://api.example.com/.well-known/x402.json');
    expect(config.transport).toBe('stdio');
    expect(config.network).toBe('Preview');
    expect(config.signer.seedPhrase).toBe(VALID_ENV.SEED_PHRASE);
    expect(config.blockfrostKey).toBe(VALID_ENV.BLOCKFROST_KEY);
  });

  it('falls back to CARDANO402_CATALOG_URL when --catalog is absent', () => {
    const config = loadConfig({
      argv: [],
      env: {
        ...VALID_ENV,
        CARDANO402_CATALOG_URL: 'https://api.example.com/.well-known/x402.json',
      },
    });
    expect(config.catalogUrl).toBe('https://api.example.com/.well-known/x402.json');
  });

  it('errors when SEED_PHRASE is missing', () => {
    expect(() =>
      loadConfig({
        argv: ['--catalog', 'https://api.example.com/.well-known/x402.json'],
        env: { BLOCKFROST_KEY: 'x' },
      })
    ).toThrow(/SEED_PHRASE/);
  });

  it('loads seed phrase from a restrictive file', () => {
    const seedPhraseFile = writeSeedFile();
    const config = loadConfig({
      argv: [
        '--catalog',
        'https://api.example.com/.well-known/x402.json',
        '--seed-phrase-file',
        seedPhraseFile,
      ],
      env: { BLOCKFROST_KEY: VALID_ENV.BLOCKFROST_KEY },
    });
    expect(config.signer.seedPhrase).toBe(VALID_ENV.SEED_PHRASE);
  });

  it('rejects group/world-readable seed phrase files on POSIX', () => {
    if (process.platform === 'win32') return;
    const seedPhraseFile = writeSeedFile(0o644);
    expect(() =>
      loadConfig({
        argv: [
          '--catalog',
          'https://api.example.com/.well-known/x402.json',
          '--seed-phrase-file',
          seedPhraseFile,
        ],
        env: { BLOCKFROST_KEY: VALID_ENV.BLOCKFROST_KEY },
      })
    ).toThrow(/group\/world/);
  });

  it('errors when BLOCKFROST_KEY is missing', () => {
    expect(() =>
      loadConfig({
        argv: ['--catalog', 'https://api.example.com/.well-known/x402.json'],
        env: { SEED_PHRASE: 'x' },
      })
    ).toThrow(/BLOCKFROST_KEY/);
  });

  it('rejects insecure catalog URLs by default', () => {
    expect(() =>
      loadConfig({
        argv: ['--catalog', 'http://api.example.com/.well-known/x402.json'],
        env: VALID_ENV,
      })
    ).toThrow(/HTTPS/);
  });

  it('allows http://localhost loopback even without --allow-insecure', () => {
    const config = loadConfig({
      argv: ['--catalog', 'http://localhost:3000/.well-known/x402.json'],
      env: VALID_ENV,
    });
    expect(config.catalogUrl).toBe('http://localhost:3000/.well-known/x402.json');
  });

  it('honours CARDANO402_ALLOW_INSECURE=true', () => {
    const config = loadConfig({
      argv: ['--catalog', 'http://api.example.com/.well-known/x402.json'],
      env: { ...VALID_ENV, CARDANO402_ALLOW_INSECURE: 'true' },
    });
    expect(config.catalogUrl).toBe('http://api.example.com/.well-known/x402.json');
    expect(config.allowInsecure).toBe(true);
  });

  it('refuses Mainnet without MAINNET=true', () => {
    expect(() =>
      loadConfig({
        argv: [
          '--catalog',
          'https://api.example.com/.well-known/x402.json',
          '--network',
          'Mainnet',
        ],
        env: VALID_ENV,
      })
    ).toThrow(/MAINNET=true/);
  });

  it('requires persistent spend store on Mainnet', () => {
    expect(() =>
      loadConfig({
        argv: [
          '--catalog',
          'https://api.example.com/.well-known/x402.json',
          '--network',
          'Mainnet',
        ],
        env: { ...VALID_ENV, MAINNET: 'true' },
      })
    ).toThrow(/SPEND_STORE_PATH|spend-store-path/);
  });

  it('requires a seed phrase file on Mainnet by default', () => {
    expect(() =>
      loadConfig({
        argv: [
          '--catalog',
          'https://api.example.com/.well-known/x402.json',
          '--network',
          'Mainnet',
          '--spend-store-path',
          '/tmp/cardano402-spend.json',
        ],
        env: { ...VALID_ENV, MAINNET: 'true' },
      })
    ).toThrow(/SEED_PHRASE_FILE|seed-phrase-file/);
  });

  it('permits Mainnet when MAINNET=true, spend store, and seed file are set', () => {
    const seedPhraseFile = writeSeedFile();
    const config = loadConfig({
      argv: [
        '--catalog',
        'https://api.example.com/.well-known/x402.json',
        '--network',
        'Mainnet',
        '--spend-store-path',
        '/tmp/cardano402-spend.json',
        '--seed-phrase-file',
        seedPhraseFile,
      ],
      env: { BLOCKFROST_KEY: VALID_ENV.BLOCKFROST_KEY, MAINNET: 'true' },
    });
    expect(config.network).toBe('Mainnet');
    expect(config.spendStorePath).toBe('/tmp/cardano402-spend.json');
  });

  it('permits Mainnet seed phrase env only with explicit unsafe override', () => {
    const config = loadConfig({
      argv: [
        '--catalog',
        'https://api.example.com/.well-known/x402.json',
        '--network',
        'Mainnet',
        '--spend-store-path',
        '/tmp/cardano402-spend.json',
      ],
      env: {
        ...VALID_ENV,
        MAINNET: 'true',
        CARDANO402_ALLOW_MAINNET_SEED_PHRASE_ENV: 'true',
      },
    });
    expect(config.network).toBe('Mainnet');
  });

  it('loads spend store path from env', () => {
    const config = loadConfig({
      argv: ['--catalog', 'https://api.example.com/.well-known/x402.json'],
      env: {
        ...VALID_ENV,
        CARDANO402_SPEND_STORE_PATH: '/tmp/cardano402-spend.json',
      },
    });
    expect(config.spendStorePath).toBe('/tmp/cardano402-spend.json');
  });

  it('CLI flag overrides CARDANO402_NETWORK env', () => {
    const config = loadConfig({
      argv: [
        '--catalog',
        'https://api.example.com/.well-known/x402.json',
        '--network',
        'Preprod',
      ],
      env: { ...VALID_ENV, CARDANO402_NETWORK: 'Preview' },
    });
    expect(config.network).toBe('Preprod');
  });
});

describe('helpText', () => {
  it('mentions --catalog and SEED_PHRASE', () => {
    const help = helpText();
    expect(help).toMatch(/--catalog/);
    expect(help).toMatch(/--seed-phrase-file/);
    expect(help).toMatch(/SEED_PHRASE_FILE/);
    expect(help).toMatch(/SEED_PHRASE/);
    expect(help).toMatch(/BLOCKFROST_KEY/);
  });
});
