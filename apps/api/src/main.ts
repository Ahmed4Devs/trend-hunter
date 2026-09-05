import { assertProductionReadiness, loadApiEnvironment } from '@trendhunter/env';
import closeWithGrace from 'close-with-grace';

import { buildApp } from './app';
import { createContainer, flushUsage } from './container';

/**
 * Service entry point.
 *
 * Configuration is validated before anything is constructed, so a
 * misconfigured deployment fails immediately and loudly rather than starting
 * and then failing on the first request that happens to need the missing value.
 */

/** How often accumulated provider usage is written to the database. */
const USAGE_FLUSH_INTERVAL_MS = 60_000;

/** Time allowed for in-flight requests to finish before the process is killed. */
const SHUTDOWN_GRACE_MS = 15_000;

async function main(): Promise<void> {
  const env = loadApiEnvironment();
  assertProductionReadiness(env);

  const container = createContainer(env);
  const app = buildApp(container);

  // Usage is accumulated in memory and written periodically: recording it on
  // every call would add a database write to the hot path of the most expensive
  // endpoints, which is exactly where latency already matters most.
  const usageTimer = setInterval(() => {
    void flushUsage(container.repositories.operations, container.usage, container.logger);
  }, USAGE_FLUSH_INTERVAL_MS);
  usageTimer.unref();

  closeWithGrace({ delay: SHUTDOWN_GRACE_MS }, async ({ err, signal }) => {
    if (err) container.logger.error({ err }, 'shutting down after an unhandled error');
    else container.logger.info({ signal }, 'shutting down');

    clearInterval(usageTimer);
    // Stop accepting connections and let in-flight requests drain before the
    // connections they depend on are closed.
    await app.close();
    await container.close();
  });

  await app.listen({ port: env.PORT, host: env.HOST });

  container.logger.info(
    {
      port: env.PORT,
      dataMode: env.DATA_MODE,
      aiProvider: env.AI_PROVIDER,
      docs: env.ENABLE_API_DOCS ? `${env.API_URL}/docs` : 'disabled',
    },
    'TrendHunter API ready',
  );
}

main().catch((error: unknown) => {
  // The logger may not exist yet — a configuration failure happens before the
  // container is built — so this is the one place stderr is written directly.
  console.error('Failed to start the TrendHunter API:');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
