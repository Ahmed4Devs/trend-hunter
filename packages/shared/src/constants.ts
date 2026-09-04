/**
 * Platform-wide constants.
 *
 * Anything that would otherwise become a magic number in a service, a worker or
 * a React component belongs here, so that the value has one name, one comment
 * and one place to change.
 */

/** Character budget for a single X post. */
export const X_POST_CHARACTER_LIMIT = 280;

/** Ceiling used by the Content Studio for a "long" post. */
export const X_LONG_POST_CHARACTER_LIMIT = 4_000;

/** Default number of posts generated for a thread. */
export const DEFAULT_THREAD_LENGTH = 7;

/** Bounds accepted by the thread generator. */
export const MIN_THREAD_LENGTH = 2;
export const MAX_THREAD_LENGTH = 25;

/**
 * Room reserved on each thread post for its `n/N` counter, so a generated post
 * plus its numbering still fits inside {@link X_POST_CHARACTER_LIMIT}.
 */
export const THREAD_COUNTER_RESERVED_CHARACTERS = 8;

/** Embedding width produced by every provider in this deployment. */
export const EMBEDDING_DIMENSIONS = 768;

/** Maximum characters fed into one embedding call. */
export const EMBEDDING_INPUT_CHARACTER_LIMIT = 4_000;

/** Redis key namespace. Every key the platform writes starts with this. */
export const CACHE_NAMESPACE = 'trendhunter';

/** Cache time-to-live, in seconds, per cached read model. */
export const CACHE_TTL_SECONDS = {
  dashboardSummary: 60,
  trendingTopics: 120,
  sourceDistribution: 300,
  reportResult: 900,
  searchSuggestions: 300,
  systemHealth: 15,
} as const;

/** How long a worker heartbeat stays valid before the worker is "stale". */
export const WORKER_HEARTBEAT_TTL_SECONDS = 90;
export const WORKER_HEARTBEAT_INTERVAL_SECONDS = 30;

/** Maximum items a single connector call may return. */
export const MAX_COLLECT_LIMIT = 200;
export const DEFAULT_COLLECT_LIMIT = 50;

/** Maximum ids carried in one queue payload, to keep Redis entries small. */
export const MAX_IDS_PER_JOB = 200;

/** Fastify body size ceiling, in bytes. */
export const MAX_REQUEST_BODY_BYTES = 512 * 1024;

/** Longest free-text search query accepted. */
export const MAX_SEARCH_QUERY_LENGTH = 200;

/** Number of results returned by each arm of a hybrid search before fusion. */
export const SEARCH_CANDIDATE_POOL = 100;

/**
 * Technical terms kept in English by default, because rendering them in Arabic
 * makes technical writing harder to read for the target audience rather than
 * easier. Used by the terminology service when the preference is
 * `KEEP_COMMON_ENGLISH_TERMS`.
 */
export const DEFAULT_PRESERVED_TERMS = [
  'API',
  'SaaS',
  'LLM',
  'AI Agent',
  'RAG',
  'MCP',
  'SDK',
  'Backend',
  'Frontend',
  'Open Source',
  'GPU',
  'CLI',
  'UI',
  'UX',
  'REST',
  'GraphQL',
  'Webhook',
  'Token',
  'Prompt',
  'Fine-tuning',
  'Embedding',
  'Vector Database',
  'DevOps',
  'CI/CD',
  'Kubernetes',
  'Docker',
  'Serverless',
  'Startup',
  'MVP',
  'B2B',
  'B2C',
  'ROI',
  'KPI',
] as const;

/**
 * Demo credentials.
 *
 * Seeded only when `ENABLE_DEMO_ACCOUNT` is true, which the environment schema
 * forces to false in production. The password is published in the README on
 * purpose: it exists so a reviewer can sign in to a local instance, and it must
 * never be reachable from a deployed one.
 */
export const DEMO_ACCOUNT = {
  email: 'demo@trendhunter.local',
  password: 'TrendHunter123!', // pragma: allowlist secret -- documented dev-only credential
  name: 'Demo Analyst',
} as const;
