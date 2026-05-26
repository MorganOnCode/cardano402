import { chmodSync, writeFileSync, unlinkSync, mkdirSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { loadConfig } from '../../src/config/index.js';

const TEST_CONFIG_DIR = join(process.cwd(), 'tests', 'fixtures');
const TEST_CONFIG_PATH = join(TEST_CONFIG_DIR, 'test-config.json');

// Minimal chain config required by schema (sensitive fields use test values)
const minimalChainConfig = {
  blockfrost: { projectId: 'test-project-id' },
  facilitator: { seedPhrase: 'test seed phrase for unit testing only' },
};

function writeSecretFile(
  contents = 'test seed phrase for unit testing only',
  mode = 0o600
): string {
  const dir = mkdtempSync(join(tmpdir(), 'cardano402-config-secret-'));
  const path = join(dir, 'secret.txt');
  writeFileSync(path, `${contents}\n`, { mode });
  chmodSync(path, mode);
  return path;
}

describe('Config Loading', () => {
  beforeEach(() => {
    if (!existsSync(TEST_CONFIG_DIR)) {
      mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_CONFIG_PATH)) {
      unlinkSync(TEST_CONFIG_PATH);
    }
  });

  it('should load valid config with defaults', () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({ chain: minimalChainConfig }));
    const config = loadConfig(TEST_CONFIG_PATH);

    expect(config.server.host).toBe('0.0.0.0');
    expect(config.server.port).toBe(3000);
    expect(config.logging.level).toBe('info');
    expect(config.env).toBe('development');
    // Chain defaults
    expect(config.chain.network).toBe('Preview');
    expect(config.chain.blockfrost.tier).toBe('free');
    expect(config.chain.cache.utxoTtlSeconds).toBe(60);
    expect(config.chain.redis.host).toBe('127.0.0.1');
    expect(config.chain.redis.port).toBe(6379);
    expect(config.chain.facilitator.signerMode).toBe('local-file');
  });

  it('should override defaults with provided values', () => {
    const customConfig = {
      server: { port: 8080, trustProxy: true },
      logging: { level: 'debug' },
      chain: minimalChainConfig,
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(customConfig));
    const config = loadConfig(TEST_CONFIG_PATH);

    expect(config.server.port).toBe(8080);
    expect(config.server.trustProxy).toBe(true);
    expect(config.logging.level).toBe('debug');
  });

  it('should throw ConfigMissingError for non-existent file', () => {
    try {
      loadConfig('/nonexistent/path/config.json');
      expect.fail('Expected error to be thrown');
    } catch (error) {
      expect((error as { code: string }).code).toBe('CONFIG_MISSING');
    }
  });

  it('should throw ConfigParseError for invalid JSON', () => {
    writeFileSync(TEST_CONFIG_PATH, 'not valid json');
    try {
      loadConfig(TEST_CONFIG_PATH);
      expect.fail('Expected error to be thrown');
    } catch (error) {
      expect((error as { code: string }).code).toBe('CONFIG_PARSE_ERROR');
    }
  });

  it('should throw ConfigInvalidError for invalid schema', () => {
    const invalidConfig = {
      server: { port: 'not a number' },
      chain: minimalChainConfig,
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(invalidConfig));
    try {
      loadConfig(TEST_CONFIG_PATH);
      expect.fail('Expected error to be thrown');
    } catch (error) {
      expect((error as { code: string }).code).toBe('CONFIG_INVALID');
    }
  });

  it('should validate port range', () => {
    const invalidPort = { server: { port: 70000 }, chain: minimalChainConfig };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(invalidPort));
    try {
      loadConfig(TEST_CONFIG_PATH);
      expect.fail('Expected error to be thrown');
    } catch (error) {
      expect((error as { code: string }).code).toBe('CONFIG_INVALID');
    }
  });

  it('should validate logging level enum', () => {
    const invalidLevel = { logging: { level: 'verbose' }, chain: minimalChainConfig };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(invalidLevel));
    try {
      loadConfig(TEST_CONFIG_PATH);
      expect.fail('Expected error to be thrown');
    } catch (error) {
      expect((error as { code: string }).code).toBe('CONFIG_INVALID');
    }
  });

  it('should reject config without chain section', () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({}));
    try {
      loadConfig(TEST_CONFIG_PATH);
      expect.fail('Expected error to be thrown');
    } catch (error) {
      expect((error as { code: string }).code).toBe('CONFIG_INVALID');
    }
  });

  it('should reject chain config without facilitator credentials', () => {
    const noCredentials = {
      chain: { blockfrost: { projectId: 'test123' }, facilitator: {} },
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(noCredentials));
    try {
      loadConfig(TEST_CONFIG_PATH);
      expect.fail('Expected error to be thrown');
    } catch (error) {
      expect((error as { code: string }).code).toBe('CONFIG_INVALID');
    }
  });

  it('should load facilitator seed phrase from a restrictive file', () => {
    const seedPhraseFile = writeSecretFile();
    writeFileSync(
      TEST_CONFIG_PATH,
      JSON.stringify({
        chain: {
          blockfrost: { projectId: 'test123' },
          facilitator: { seedPhraseFile },
        },
      })
    );

    const config = loadConfig(TEST_CONFIG_PATH);

    expect(config.chain.facilitator.seedPhrase).toBe('test seed phrase for unit testing only');
    expect(config.chain.facilitator.signerMode).toBe('local-file');
    expect(config.chain.facilitator.credentialSource).toBe('seedPhraseFile');
  });

  it('should reject group/world-readable facilitator credential files on POSIX', () => {
    if (process.platform === 'win32') return;
    const seedPhraseFile = writeSecretFile('test seed phrase', 0o644);
    writeFileSync(
      TEST_CONFIG_PATH,
      JSON.stringify({
        chain: {
          blockfrost: { projectId: 'test123' },
          facilitator: { seedPhraseFile },
        },
      })
    );

    expect(() => loadConfig(TEST_CONFIG_PATH)).toThrowError(/CONFIG_INVALID|group\/world/);
  });

  it('should reject multiple facilitator credential sources', () => {
    const seedPhraseFile = writeSecretFile();
    writeFileSync(
      TEST_CONFIG_PATH,
      JSON.stringify({
        chain: {
          blockfrost: { projectId: 'test123' },
          facilitator: {
            seedPhrase: 'inline seed',
            seedPhraseFile,
          },
        },
      })
    );

    expect(() => loadConfig(TEST_CONFIG_PATH)).toThrowError(/CONFIG_INVALID|exactly one/);
  });

  describe('Redis password production guardrail', () => {
    it('rejects production env with no chain.redis.password', () => {
      const cfg = {
        env: 'production',
        chain: {
          ...minimalChainConfig,
          redis: { host: 'redis', port: 6379 },
        },
      };
      writeFileSync(TEST_CONFIG_PATH, JSON.stringify(cfg));
      expect(() => loadConfig(TEST_CONFIG_PATH)).toThrowError(/CONFIG_INVALID|password/);
    });

    it('rejects production env with empty chain.redis.password', () => {
      const cfg = {
        env: 'production',
        chain: {
          ...minimalChainConfig,
          redis: { host: 'redis', port: 6379, password: '' },
        },
      };
      writeFileSync(TEST_CONFIG_PATH, JSON.stringify(cfg));
      expect(() => loadConfig(TEST_CONFIG_PATH)).toThrowError(/CONFIG_INVALID|password/);
    });

    it('rejects production env with whitespace-only chain.redis.password', () => {
      const cfg = {
        env: 'production',
        chain: {
          ...minimalChainConfig,
          redis: { host: 'redis', port: 6379, password: '   ' },
        },
      };
      writeFileSync(TEST_CONFIG_PATH, JSON.stringify(cfg));
      expect(() => loadConfig(TEST_CONFIG_PATH)).toThrowError(/CONFIG_INVALID|password/);
    });

    it('accepts production env with a non-empty chain.redis.password', () => {
      const cfg = {
        env: 'production',
        metrics: { bearerToken: 'test-metrics-bearer-token' },
        chain: {
          ...minimalChainConfig,
          redis: { host: 'redis', port: 6379, password: 'a-real-password' },
        },
      };
      writeFileSync(TEST_CONFIG_PATH, JSON.stringify(cfg));
      expect(() => loadConfig(TEST_CONFIG_PATH)).not.toThrow();
    });

    it('accepts development env with no chain.redis.password (dev compose has no auth)', () => {
      const cfg = {
        env: 'development',
        chain: {
          ...minimalChainConfig,
          redis: { host: 'localhost', port: 6379 },
        },
      };
      writeFileSync(TEST_CONFIG_PATH, JSON.stringify(cfg));
      expect(() => loadConfig(TEST_CONFIG_PATH)).not.toThrow();
    });
  });

  describe('Metrics production guardrail', () => {
    it('rejects production env without metrics.bearerToken', () => {
      const cfg = {
        env: 'production',
        chain: {
          ...minimalChainConfig,
          redis: { host: 'redis', port: 6379, password: 'a-real-password' },
        },
      };
      writeFileSync(TEST_CONFIG_PATH, JSON.stringify(cfg));
      expect(() => loadConfig(TEST_CONFIG_PATH)).toThrowError(/CONFIG_INVALID|metrics/);
    });

    it('accepts production env with metrics.bearerToken', () => {
      const cfg = {
        env: 'production',
        metrics: { bearerToken: 'test-metrics-bearer-token' },
        chain: {
          ...minimalChainConfig,
          redis: { host: 'redis', port: 6379, password: 'a-real-password' },
        },
      };
      writeFileSync(TEST_CONFIG_PATH, JSON.stringify(cfg));
      expect(() => loadConfig(TEST_CONFIG_PATH)).not.toThrow();
    });
  });

  describe('Demo credential guardrail', () => {
    it('loads demo seed phrase from a restrictive file', () => {
      const seedPhraseFile = writeSecretFile('test demo seed phrase');
      writeFileSync(
        TEST_CONFIG_PATH,
        JSON.stringify({
          chain: minimalChainConfig,
          demo: {
            blockfrostProjectId: 'preview-demo-key',
            seedPhraseFile,
            network: 'Preview',
          },
        })
      );

      const config = loadConfig(TEST_CONFIG_PATH);

      expect(config.demo?.seedPhrase).toBe('test demo seed phrase');
      expect(config.demo?.seedPhraseFile).toBe(seedPhraseFile);
      expect(config.demo?.credentialSource).toBe('seedPhraseFile');
    });

    it('rejects group/world-readable demo seed files on POSIX', () => {
      if (process.platform === 'win32') return;
      const seedPhraseFile = writeSecretFile('test demo seed phrase', 0o644);
      writeFileSync(
        TEST_CONFIG_PATH,
        JSON.stringify({
          chain: minimalChainConfig,
          demo: {
            blockfrostProjectId: 'preview-demo-key',
            seedPhraseFile,
          },
        })
      );

      expect(() => loadConfig(TEST_CONFIG_PATH)).toThrowError(/CONFIG_INVALID|group\/world/);
    });

    it('rejects multiple demo seed sources', () => {
      const seedPhraseFile = writeSecretFile('test demo seed phrase');
      writeFileSync(
        TEST_CONFIG_PATH,
        JSON.stringify({
          chain: minimalChainConfig,
          demo: {
            blockfrostProjectId: 'preview-demo-key',
            seedPhrase: 'inline demo seed',
            seedPhraseFile,
          },
        })
      );

      expect(() => loadConfig(TEST_CONFIG_PATH)).toThrowError(/CONFIG_INVALID|exactly one/);
    });

    it('rejects inline demo seed material in production', () => {
      writeFileSync(
        TEST_CONFIG_PATH,
        JSON.stringify({
          env: 'production',
          metrics: { bearerToken: 'test-metrics-bearer-token' },
          chain: {
            ...minimalChainConfig,
            redis: { host: 'redis', port: 6379, password: 'a-real-password' },
          },
          demo: {
            blockfrostProjectId: 'preview-demo-key',
            seedPhrase: 'inline demo seed',
          },
        })
      );

      expect(() => loadConfig(TEST_CONFIG_PATH)).toThrowError(
        /CONFIG_INVALID|demo\.seedPhraseFile/
      );
    });

    it('accepts production demo config with seedPhraseFile', () => {
      const seedPhraseFile = writeSecretFile('test demo seed phrase');
      writeFileSync(
        TEST_CONFIG_PATH,
        JSON.stringify({
          env: 'production',
          metrics: { bearerToken: 'test-metrics-bearer-token' },
          chain: {
            ...minimalChainConfig,
            redis: { host: 'redis', port: 6379, password: 'a-real-password' },
          },
          demo: {
            blockfrostProjectId: 'preview-demo-key',
            seedPhraseFile,
          },
        })
      );

      expect(() => loadConfig(TEST_CONFIG_PATH)).not.toThrow();
    });
  });

  it('should reject mainnet without MAINNET=true env var', () => {
    const mainnetConfig = {
      chain: {
        network: 'Mainnet',
        blockfrost: { projectId: 'mainnet-key' },
        facilitator: { seedPhrase: 'test seed phrase' },
      },
    };
    // Ensure MAINNET is not set
    const original = process.env.MAINNET;
    delete process.env.MAINNET;

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(mainnetConfig));
    try {
      loadConfig(TEST_CONFIG_PATH);
      expect.fail('Expected error to be thrown');
    } catch (error) {
      expect((error as { code: string }).code).toBe('CONFIG_INVALID');
    } finally {
      // Restore env
      if (original !== undefined) {
        process.env.MAINNET = original;
      }
    }
  });

  it('should reject inline mainnet facilitator credentials by default', () => {
    const mainnetConfig = {
      chain: {
        network: 'Mainnet',
        blockfrost: { projectId: 'mainnet-key' },
        facilitator: { seedPhrase: 'test seed phrase' },
      },
    };
    const originalMainnet = process.env.MAINNET;
    const originalAllow = process.env.CARDANO402_ALLOW_MAINNET_INLINE_SIGNING_KEY;
    process.env.MAINNET = 'true';
    delete process.env.CARDANO402_ALLOW_MAINNET_INLINE_SIGNING_KEY;

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(mainnetConfig));
    try {
      expect(() => loadConfig(TEST_CONFIG_PATH)).toThrowError(/CONFIG_INVALID|seedPhraseFile/);
    } finally {
      if (originalMainnet === undefined) delete process.env.MAINNET;
      else process.env.MAINNET = originalMainnet;
      if (originalAllow === undefined)
        delete process.env.CARDANO402_ALLOW_MAINNET_INLINE_SIGNING_KEY;
      else process.env.CARDANO402_ALLOW_MAINNET_INLINE_SIGNING_KEY = originalAllow;
    }
  });

  it('should accept mainnet facilitator seed file', () => {
    const seedPhraseFile = writeSecretFile();
    const mainnetConfig = {
      chain: {
        network: 'Mainnet',
        blockfrost: { projectId: 'mainnet-key' },
        facilitator: { seedPhraseFile },
      },
    };
    const original = process.env.MAINNET;
    process.env.MAINNET = 'true';

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(mainnetConfig));
    try {
      const config = loadConfig(TEST_CONFIG_PATH);
      expect(config.chain.facilitator.credentialSource).toBe('seedPhraseFile');
    } finally {
      if (original === undefined) delete process.env.MAINNET;
      else process.env.MAINNET = original;
    }
  });
});
