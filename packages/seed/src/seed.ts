import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';

/**
 * Database seed.
 *
 * Produces a deployment that is immediately usable: the demo account, the
 * interest profile the relevance engine scores against, the five sources with
 * realistic per-provider configuration, and the system settings.
 *
 * It deliberately does NOT insert posts, topics or trend snapshots. Those come
 * from running the pipeline — `POST /api/v1/scans`, or simply waiting for the
 * scheduled collection — because inserting them here would produce a database
 * that looks populated while proving nothing about whether collection,
 * normalisation, clustering and scoring actually work. A seeded dashboard that
 * cannot be reproduced by the pipeline is worse than an empty one.
 *
 * Idempotent throughout: every write is an upsert keyed on something stable, so
 * running it twice changes nothing.
 */

for (const candidate of ['../../../.env', '../../.env', '.env']) {
  const path = resolve(import.meta.dirname, candidate);
  if (existsSync(path)) {
    loadDotenv({ path });
    break;
  }
}

/** A value a source configuration entry may hold. */
type ConfigValue = string | number | boolean | readonly string[];

const { createAuth, provisionUser } = await import('@trendhunter/auth');
const { DEMO_ACCOUNT } = await import('@trendhunter/shared');
const { createDatabaseClient, disconnectDatabase } = await import('@trendhunter/database');

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined) {
  throw new Error('DATABASE_URL is required to seed the database.');
}

const database = createDatabaseClient({ connectionString, poolMax: 4 });

/**
 * The interest profile.
 *
 * These are the categories from the product specification, with the keyword
 * weights that make relevance scoring meaningful out of the box: a keyword that
 * names the thing exactly ("AI Agents") outranks one that merely co-occurs with
 * it ("automation"). Every weight is 0..1 and multiplies its interest's weight.
 */
const INTERESTS = [
  {
    name: 'AI',
    description: 'Agents, models, retrieval and the tooling around them.',
    weight: 1,
    keywords: [
      ['AI Agents', 1],
      ['LLM', 0.95],
      ['OpenAI', 0.85],
      ['MCP', 0.85],
      ['RAG', 0.85],
      ['AI Coding', 0.8],
      ['fine-tuning', 0.7],
      ['embeddings', 0.7],
      ['vector database', 0.65],
      ['prompt engineering', 0.6],
    ],
  },
  {
    name: 'SaaS',
    description: 'Building, pricing and operating software as a service.',
    weight: 0.9,
    keywords: [
      ['SaaS', 1],
      ['pricing', 0.75],
      ['churn', 0.75],
      ['onboarding', 0.6],
      ['multi-tenant', 0.7],
      ['billing', 0.65],
    ],
  },
  {
    name: 'Automation',
    description: 'Workflow automation and the systems that replace manual work.',
    weight: 0.85,
    keywords: [
      ['automation', 1],
      ['workflow', 0.8],
      ['no-code', 0.7],
      ['orchestration', 0.7],
      ['scheduler', 0.6],
    ],
  },
  {
    name: 'API',
    description: 'API design, integration and developer experience.',
    weight: 0.85,
    keywords: [
      ['API', 1],
      ['SDK', 0.8],
      ['webhook', 0.8],
      ['REST', 0.7],
      ['GraphQL', 0.65],
      ['rate limit', 0.6],
    ],
  },
  {
    name: 'Startups',
    description: 'Company building, funding and go-to-market.',
    weight: 0.75,
    keywords: [
      ['startup', 1],
      ['founder', 0.8],
      ['MVP', 0.75],
      ['product-market fit', 0.75],
      ['fundraising', 0.65],
    ],
  },
  {
    name: 'Sales',
    description: 'Outbound, pipeline and revenue operations.',
    weight: 0.7,
    keywords: [
      ['sales', 1],
      ['outbound', 0.8],
      ['pipeline', 0.7],
      ['CRM', 0.7],
      ['lead generation', 0.65],
    ],
  },
  {
    name: 'Saudi Market',
    description: 'The Saudi and Gulf technology market, and Arabic content.',
    weight: 0.9,
    keywords: [
      ['Saudi', 1],
      ['Gulf', 0.85],
      ['Riyadh', 0.8],
      ['MENA', 0.8],
      ['Arabic', 0.85],
      ['Vision 2030', 0.75],
    ],
  },
] as const;

/**
 * The five sources.
 *
 * `authorityWeight` is a judgement about signal quality, and it is deliberately
 * not uniform: a Hacker News front-page story has survived a vote, an RSS
 * article has an editor behind it, and an X post has neither. The weight feeds
 * both relevance and the trend score's source-authority component.
 *
 * The scan intervals reflect how fast each source actually moves.
 */
const SOURCES = [
  {
    kind: 'X' as const,
    name: 'X',
    slug: 'x',
    authorityWeight: 0.55,
    scanIntervalMinutes: 5,
    config: {
      queries: ['ai agents', 'llm tooling', 'saas pricing', 'developer tools'],
      pageSize: 100,
      excludeRetweets: true,
    },
  },
  {
    kind: 'REDDIT' as const,
    name: 'Reddit',
    slug: 'reddit',
    authorityWeight: 0.6,
    scanIntervalMinutes: 10,
    config: {
      subreddits: ['MachineLearning', 'SaaS', 'startups', 'devops', 'ExperiencedDevs', 'artificial'],
      includeComments: true,
      commentLimit: 20,
    },
  },
  {
    kind: 'HACKERNEWS' as const,
    name: 'Hacker News',
    slug: 'hacker-news',
    authorityWeight: 0.8,
    scanIntervalMinutes: 5,
    config: { feeds: ['top', 'new', 'show'], itemsPerFeed: 40, minScore: 5 },
  },
  {
    kind: 'RSS' as const,
    name: 'RSS Feeds',
    slug: 'rss',
    authorityWeight: 0.85,
    scanIntervalMinutes: 15,
    config: {
      // The offline connector generates its own feeds and ignores these; they
      // are here so that switching DATA_MODE to `live` has somewhere to start.
      feedUrls: [
        'https://signal-and-stack.example.com/feed.xml',
        'https://ledger-and-loop.example.com/atom.xml',
      ],
      itemsPerFeed: 25,
      maxBytes: 4 * 1024 * 1024,
    },
  },
  {
    kind: 'GITHUB' as const,
    name: 'GitHub',
    slug: 'github',
    authorityWeight: 0.75,
    scanIntervalMinutes: 30,
    config: {
      repositories: [],
      topics: ['ai-agents', 'llm', 'developer-tools', 'saas'],
      includeReleases: true,
      minStars: 25,
    },
  },
] as const;

/** Operator-level defaults, editable from the Settings page. */
const SYSTEM_SETTINGS = [
  {
    key: 'relevance.threshold',
    value: 60,
    description: 'Relevance at or above which a post counts as a relevant idea.',
  },
  {
    key: 'arabic.opportunityThreshold',
    value: 70,
    description: 'Arabic opportunity score at or above which a topic is flagged.',
  },
  {
    key: 'ingestion.defaultLimit',
    value: 50,
    description: 'Items requested per source on a manual scan.',
  },
] as const;

async function seed(): Promise<void> {
  const enableDemoAccount = process.env.ENABLE_DEMO_ACCOUNT !== 'false';
  const isProduction = process.env.NODE_ENV === 'production';

  console.log('Seeding TrendHunter…');

  // -------------------------------------------------------------------------
  // Sources
  // -------------------------------------------------------------------------
  for (const source of SOURCES) {
    const row = await database.source.upsert({
      where: { slug: source.slug },
      update: {
        name: source.name,
        authorityWeight: source.authorityWeight,
        scanIntervalMinutes: source.scanIntervalMinutes,
      },
      create: {
        kind: source.kind,
        name: source.name,
        slug: source.slug,
        authorityWeight: source.authorityWeight,
        scanIntervalMinutes: source.scanIntervalMinutes,
        enabled: true,
      },
      select: { id: true },
    });

    // The config objects are heterogeneous by design — each provider has its
    // own shape — so the entries are typed explicitly rather than letting
    // `Object.entries` widen the values to `any`.
    const entries = Object.entries(source.config) as [string, ConfigValue][];
    for (const [key, value] of entries) {
      await database.sourceConfig.upsert({
        where: { sourceId_key: { sourceId: row.id, key } },
        update: { value },
        create: { sourceId: row.id, key, value },
      });
    }
  }
  console.log(`  sources: ${String(SOURCES.length)}`);

  // -------------------------------------------------------------------------
  // System settings
  // -------------------------------------------------------------------------
  for (const setting of SYSTEM_SETTINGS) {
    await database.systemSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value, description: setting.description },
      create: { key: setting.key, value: setting.value, description: setting.description },
    });
  }
  console.log(`  system settings: ${String(SYSTEM_SETTINGS.length)}`);

  // -------------------------------------------------------------------------
  // Demo account
  // -------------------------------------------------------------------------
  if (!enableDemoAccount || isProduction) {
    console.log('  demo account: skipped (disabled or production)');
    console.log('Seed complete.');
    return;
  }

  const auth = createAuth(database, {
    secret: process.env.BETTER_AUTH_SECRET ?? '',
    baseUrl: process.env.BETTER_AUTH_URL ?? 'http://localhost:4000',
    trustedOrigins: [process.env.APP_URL ?? 'http://localhost:3000'],
    isProduction: false,
    allowDemoAccount: true,
  });

  const user = await provisionUser(auth, database, {
    email: DEMO_ACCOUNT.email,
    password: DEMO_ACCOUNT.password,
    name: DEMO_ACCOUNT.name,
    // The demo account is an administrator so that a reviewer can reach the
    // source-configuration screens without a second account.
    role: 'ADMIN',
  });
  console.log(`  demo account: ${user.email} (${user.created ? 'created' : 'already present'})`);

  await database.userSettings.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
  });

  // -------------------------------------------------------------------------
  // Interests
  // -------------------------------------------------------------------------
  for (const interest of INTERESTS) {
    const row = await database.interest.upsert({
      where: { userId_name: { userId: user.id, name: interest.name } },
      update: { description: interest.description, weight: interest.weight },
      create: {
        userId: user.id,
        name: interest.name,
        description: interest.description,
        weight: interest.weight,
        enabled: true,
      },
      select: { id: true },
    });

    for (const [keyword, weight] of interest.keywords) {
      await database.interestKeyword.upsert({
        where: { interestId_keyword: { interestId: row.id, keyword } },
        update: { weight },
        create: { interestId: row.id, keyword, weight },
      });
    }
  }
  const keywordCount = INTERESTS.reduce((total, interest) => total + interest.keywords.length, 0);
  console.log(
    `  interests: ${String(INTERESTS.length)} with ${String(keywordCount)} keywords`,
  );

  console.log('');
  console.log('Seed complete. Sign in with:');
  console.log(`  ${DEMO_ACCOUNT.email} / ${DEMO_ACCOUNT.password}`);
  console.log('');
  console.log('Then run a scan to populate posts, topics and trends:');
  console.log('  POST /api/v1/scans   (or use "Scan Now" on the dashboard)');
}

try {
  await seed();
} finally {
  await disconnectDatabase(database);
}
