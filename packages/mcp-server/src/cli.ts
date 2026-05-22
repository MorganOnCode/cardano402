#!/usr/bin/env node
// CLI entry for @cardano402/mcp-server.
//
// Reads config from argv + env, boots the MCP server, traps SIGINT/SIGTERM
// for clean shutdown. Errors go to stderr so the stdio transport's stdout
// channel stays JSON-RPC-clean.

import { helpText, loadConfig, parseArgs } from './config.js';
import { startCardano402Mcp } from './server.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${helpText()}\n`);
    return;
  }

  const config = loadConfig({ argv, env: process.env });
  const handle = await startCardano402Mcp(config);

  const shutdown = (signal: NodeJS.Signals): void => {
    process.stderr.write(`[cardano402-mcp] received ${signal}, shutting down\n`);
    handle
      .stop()
      .catch((err: unknown) => {
        process.stderr.write(
          `[cardano402-mcp] shutdown error: ${(err as Error).message}\n`
        );
      })
      .finally(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  // Never include the seed phrase or Blockfrost key in error output.
  process.stderr.write(`[cardano402-mcp] fatal: ${message}\n`);
  process.exit(1);
});
