import {
  ApiUsageRecorder,
  createEmbeddingProvider,
  createLlmProvider,
  llmProviderConfigFromEnvironment,
} from '@trendhunter/ai';
import { createAuth, type Auth } from '@trendhunter/auth';
import { ContentService, ThreadService } from '@trendhunter/content';
import {
  createAnalyticsRepository,
  createContentRepository,
  createDatabaseClient,
  createIngestionRepository,
  createInterestRepository,
  createOperationsRepository,
  createPostRepository,
  createSavedRepository,
  createSourceRepository,
  createTopicRepository,
  createUserRepository,
  type Database,
} from '@trendhunter/database';
import { EmbeddingService } from '@trendhunter/embeddings';
import type { ApiEnvironment } from '@trendhunter/env';
import { createLogger, type Logger } from '@trendhunter/observability';
import { createSearchService } from '@trendhunter/search';
import { TranslationService, ThreadTranslatorService } from '@trendhunter/translation';
import { Redis } from 'ioredis';

import { createQueueProducers, type QueueProducers } from './queues';

/**
 * The composition root.
 *
 * Everything the API needs is constructed exactly once, here, and passed down.
 * No module reaches for a global: that is what makes a route testable by
 * building a container with fakes, and what makes shutdown deterministic —
 * there is one place that owns the connections and one place that closes them.
 */

export interface Container {
  readonly env: ApiEnvironment;
  readonly logger: Logger;
  readonly database: Database;
  readonly redis: Redis;
  readonly auth: Auth;
  readonly usage: ApiUsageRecorder;
  readonly queues: QueueProducers;
  readonly repositories: {
    readonly posts: ReturnType<typeof createPostRepository>;
    readonly topics: ReturnType<typeof createTopicRepository>;
    readonly sources: ReturnType<typeof createSourceRepository>;
    readonly interests: ReturnType<typeof createInterestRepository>;
    readonly content: ReturnType<typeof createContentRepository>;
    readonly saved: ReturnType<typeof createSavedRepository>;
    readonly operations: ReturnType<typeof createOperationsRepository>;
    readonly ingestion: ReturnType<typeof createIngestionRepository>;
    readonly analytics: ReturnType<typeof createAnalyticsRepository>;
    readonly users: ReturnType<typeof createUserRepository>;
  };
  readonly services: {
    readonly search: ReturnType<typeof createSearchService>;
    readonly translation: TranslationService;
    readonly threadTranslator: ThreadTranslatorService;
    readonly content: ContentService;
    readonly threads: ThreadService;
    readonly embeddings: EmbeddingService;
  };
  close(): Promise<void>;
}

export function createContainer(env: ApiEnvironment): Container {
  const logger = createLogger({
    service: 'api',
    level: env.LOG_LEVEL,
    pretty: env.NODE_ENV !== 'production',
  });

  const database = createDatabaseClient({
    connectionString: env.DATABASE_URL,
    logger,
    logQueries: env.LOG_LEVEL === 'trace',
  });

  const redis = new Redis(env.REDIS_URL, {
    // BullMQ requires this on its own connections, and the API shares the same
    // setting so a queue producer and the cache behave identically under a
    // Redis restart: fail the call rather than queue commands indefinitely.
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  redis.on('error', (error: Error) => {
    // Redis backs the cache and the rate limiter, both of which degrade rather
    // than fail, so a connection error is logged and not thrown.
    logger.error({ err: error }, 'redis connection error');
  });

  const auth = createAuth(database, {
    secret: env.BETTER_AUTH_SECRET,
    baseUrl: env.BETTER_AUTH_URL,
    trustedOrigins: [env.APP_URL, ...env.CORS_ALLOWED_ORIGINS],
    isProduction: env.NODE_ENV === 'production',
    redis,
    allowDemoAccount: env.ENABLE_DEMO_ACCOUNT,
  });

  // BullMQ needs its own connection: a blocking command on a shared client
  // would stall every cache read behind it.
  const queues = createQueueProducers(redis.duplicate());

  const usage = new ApiUsageRecorder();
  const providerConfig = llmProviderConfigFromEnvironment(env, { logger, usageRecorder: usage });
  const llm = createLlmProvider(providerConfig);
  const embeddingProvider = createEmbeddingProvider(providerConfig);

  const embeddings = new EmbeddingService(embeddingProvider, logger);

  const repositories = {
    posts: createPostRepository(database),
    topics: createTopicRepository(database),
    sources: createSourceRepository(database),
    interests: createInterestRepository(database),
    content: createContentRepository(database),
    saved: createSavedRepository(database),
    operations: createOperationsRepository(database),
    ingestion: createIngestionRepository(database),
    analytics: createAnalyticsRepository(database),
    users: createUserRepository(database),
  };

  const translation = new TranslationService(llm);
  const services = {
    search: createSearchService({ database, embeddings }),
    translation,
    threadTranslator: new ThreadTranslatorService({
      provider: llm,
      translationService: translation,
    }),
    content: new ContentService(llm),
    threads: new ThreadService(llm),
    embeddings,
  };

  return {
    env,
    logger,
    database,
    redis,
    auth,
    usage,
    queues,
    repositories,
    services,
    async close(): Promise<void> {
      // Order matters: stop accepting work, flush what was measured, then let
      // the connections go.
      await flushUsage(repositories.operations, usage, logger);
      await queues.close();
      await database.$disconnect();
      redis.disconnect();
    },
  };
}

/**
 * Writes accumulated provider usage to the database.
 *
 * Called on shutdown and periodically while running, so the usage widget
 * reflects work this process did even if it is killed.
 */
export async function flushUsage(
  operations: ReturnType<typeof createOperationsRepository>,
  usage: ApiUsageRecorder,
  logger: Logger,
): Promise<void> {
  const entries = usage.drain();
  if (entries.length === 0) return;
  try {
    const recordedAt = new Date();
    await operations.recordApiUsage(entries.map((entry) => ({ ...entry, recordedAt })));
  } catch (error) {
    // Usage accounting must never take down a request or a shutdown.
    logger.warn({ err: error }, 'failed to flush API usage');
  }
}
