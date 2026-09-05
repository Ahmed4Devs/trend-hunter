/**
 * `@trendhunter/clustering` — grouping posts that describe one event.
 *
 * Four sources report the same launch four different ways; the product only
 * works if those land on one topic. This package holds that decision and
 * nothing else: it is pure, it never reads the database, and it always reports
 * the components behind a verdict rather than a bare score, so the UI can
 * explain a cluster and an operator can tune it.
 *
 * The caller loads the candidate topics (by recency, and by an approximate
 * vector search when embeddings exist) and applies whatever comes back.
 */

export * from './weights';
export * from './text';
export * from './similarity';
export * from './deduplication';
export * from './centroid';
export * from './topic-naming';
export * from './cluster';
