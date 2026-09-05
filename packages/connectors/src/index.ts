/**
 * `@trendhunter/connectors` — one interface, five providers.
 *
 * A connector knows how to talk to exactly one external source and how to
 * express what it found as `CollectedItem`s. It knows nothing about PostgreSQL,
 * BullMQ, scoring or the user's interests, and nothing outside this package
 * imports a provider module directly — the registry is the only entry point.
 * That is what lets a sixth provider be added without touching the ingestion
 * pipeline.
 *
 * Every adapter comes in two forms: an offline one that generates a realistic,
 * deterministic corpus, and an HTTP one that talks to the real provider. In
 * `DATA_MODE=mock` the whole platform runs on the offline set with no
 * credentials and no network access.
 */

export * from './connector';
export * from './http';
export * from './normalize';
export * from './registry';

export * from './mock-data';

export * from './x/schema';
export * from './x/normalize';
export { XMockConnector } from './x/mock';
export { XLiveConnector } from './x/live';

export * from './reddit/schema';
export * from './reddit/normalize';
export { RedditMockConnector } from './reddit/mock';
export { RedditLiveConnector } from './reddit/live';

export * from './hackernews/schema';
export * from './hackernews/normalize';
export { HackerNewsMockConnector } from './hackernews/mock';
export { HackerNewsLiveConnector } from './hackernews/live';

export * from './rss/schema';
export * from './rss/normalize';
export * from './rss/parser';
export { RssMockConnector } from './rss/mock';
export { RssLiveConnector } from './rss/live';

export * from './github/schema';
export * from './github/normalize';
export { GithubMockConnector } from './github/mock';
export { GithubLiveConnector } from './github/live';
