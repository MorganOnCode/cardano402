import { loadConfig } from './config/index.js';
import { initSentry, Sentry } from './instrument.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  // Load and validate config (fails fast if invalid)
  const config = loadConfig();

  // Initialize Sentry before anything else
  initSentry(
    config.sentry?.dsn,
    config.sentry?.environment ?? config.env,
    config.sentry?.tracesSampleRate
  );

  // Create server
  const server = await createServer({ config });

  // Start listening
  try {
    const address = await server.listen({
      host: config.server.host,
      port: config.server.port,
    });
    server.log.info(`Server listening at ${address}`);
  } catch (err) {
    server.log.error(err, 'Failed to start server');
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    server.log.info(`Received ${signal}, shutting down...`);
    await server.close();
    // Flush buffered Sentry events before the process dies. Without this,
    // exception events captured by an in-flight /500 response right
    // before shutdown are dropped because Sentry's transport buffers them
    // asynchronously and process.exit() kills the loop before they ship.
    // 2s ceiling so a hung Sentry endpoint doesn't block shutdown
    // indefinitely (audit H9).
    try {
      await Sentry.close(2000);
    } catch (err) {
      server.log.warn({ err }, 'Sentry.close() failed during shutdown');
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
