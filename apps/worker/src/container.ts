import {
  ApiUsageRecorder,
  createEmbeddingProvider,
  createLlmProvider,
  llmProviderConfigFromEnvironment,
} from '@trendhunter/ai';
import { ContentService, ThreadService } from '@trendhunter/content';
import { createAllConnectors } from '@trendhunter/connectors';
import {
  createAnalyticsRepository,
  createContentRepository,
  createDatabaseClient,
  createIngestionRepository,
  createInterestRepository,
  createOperationsRepository,
  createPostRepository,
  createSourceRepository,
  createTopicRepository,
  createUserRepository,
  type Database,
} from '@trendhunter/database';
import { EmbeddingService } from '@trendhunter/embeddings';
import type { WorkerEnvironment } from '@trendhunter/env';
import { createLogger, type Logger } from '@trendhunter/observability';
import { ThreadTranslatorService, TranslationService } from '@trendhunter/translation';
import type { ContentConnector, SourceKind } from '@trendhunter/types';
import { Redis } from 'ioredis';

/**
 * The worker's composition root.
 *
 * Two Redis connections, deliberately. BullMQ workers issue blocking commands
 * (`BZPOPMIN`) that occupy a connection for as long as the queue is empty, so a
 * worker sharing a client with anything else would stall it. The consumer
 * connection is also required to have `maxRetriesPerRequest: null` — BullMQ
 * throws on start-up otherwise — while the producer side is better off failing
 * fast than queueing commands during an outage.
 */

export interface WorkerContainer {
  readonly env: WorkerEnvironment;
  readonly logger: Logger;
  readonly database: Database;
  /** Blocking commands only: workers and queue events. */
  readonly consumerConnection: Redis;
  /** Non-blocking: queue producers, the heartbeat, cache reads. */
  readonly producerConnection: Redis;
  readonly usage: ApiUsageRecorder;
  readonly connectors: Map<SourceKind, ContentConnector>;
  readonly repositories: {
    readonly posts: ReturnType<typeof createPostRepository>;
    readonly topics: ReturnType<typeof createTopicRepository>;
    readonly sources: ReturnType<typeof createSourceRepository>;
    readonly interests: ReturnType<typeof createInterestRepository>;
    readonly content: ReturnType<typeof createContentRepository>;
    readonly operations: ReturnType<typeof createOperationsRepository>;
    readonly ingestion: ReturnType<typeof createIngestionRepository>;
    readonly analytics: ReturnType<typeof createAnalyticsRepository>;
    readonly users: ReturnType<typeof createUserRepository>;
  };
  readonly services: {
    readonly embeddings: EmbeddingService;
    readonly translation: TranslationService;
    readonly threadTranslator: ThreadTranslatorService;
    readonly content: ContentService;
    readonly threads: ThreadService;
  };
  close(): Promise<void>;
}

export function createWorkerContainer(env: WorkerEnvironment): WorkerContainer {
  const logger = createLogger({
    service: 'worker',
    level: env.LOG_LEVEL,
    pretty: env.NODE_ENV !== 'production',
  });

  const database = createDatabaseClient({
    connectionString: env.DATABASE_URL,
    // Sized for the worker's concurrency plus headroom for the pipeline steps
    // that fan out inside one job.
    poolMax: Math.max(4, env.WORKER_CONCURRENCY * 2),
    logger,
  });

  const consumerConnection = new Redis(env.REDIS_URL, {
    // Required by BullMQ for workers and queue events; it throws otherwise.
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  const producerConnection = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });

  for (const [name, connection] of [
    ['consumer', consumerConnection],
    ['producer', producerConnection],
  ] as const) {
    connection.on('error', (error: Error) => {
      logger.error({ err: error, connection: name }, 'redis connection error');
    });
  }

  const usage = new ApiUsageRecorder();
  const providerConfig = llmProviderConfigFromEnvironment(env, { logger, usageRecorder: usage });
  const llm = createLlmProvider(providerConfig);
  const embeddings = new EmbeddingService(createEmbeddingProvider(providerConfig), logger);

  const connectors = createAllConnectors({
    mode: env.DATA_MODE,
    logger,
    credentials: {
      xBearerToken: env.X_API_BEARER_TOKEN,
      redditClientId: env.REDDIT_CLIENT_ID,
      redditClientSecret: env.REDDIT_CLIENT_SECRET,
      githubToken: env.GITHUB_TOKEN,
    },
    http: { allowPrivateNetworks: env.ALLOW_PRIVATE_NETWORK_FETCH },
  });

  const repositories = {
    posts: createPostRepository(database),
    topics: createTopicRepository(database),
    sources: createSourceRepository(database),
    interests: createInterestRepository(database),
    content: createContentRepository(database),
    operations: createOperationsRepository(database),
    ingestion: createIngestionRepository(database),
    analytics: createAnalyticsRepository(database),
    users: createUserRepository(database),
  };

  const translation = new TranslationService(llm);
  const services = {
    embeddings,
    translation,
    threadTranslator: new ThreadTranslatorService({
      provider: llm,
      translationService: translation,
    }),
    content: new ContentService(llm),
    threads: new ThreadService(llm),
  };

  return {
    env,
    logger,
    database,
    consumerConnection,
    producerConnection,
    usage,
    connectors,
    repositories,
    services,
    async close(): Promise<void> {
      await flushUsage(repositories.operations, usage, logger);
      await database.$disconnect();
      consumerConnection.disconnect();
      producerConnection.disconnect();
    },
  };
}

/** Writes accumulated provider usage to the database. */
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
    logger.warn({ err: error }, 'failed to flush API usage');
  }
}
