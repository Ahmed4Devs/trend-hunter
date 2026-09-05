/**
 * `@trendhunter/database` — the persistence layer.
 *
 * Everything that touches PostgreSQL lives behind this package: the Prisma
 * client, the repositories, and the hand-written SQL for pgvector and full-text
 * search. No other package builds SQL, and no other package imports the
 * generated Prisma client.
 */

export * from './client';
export * from './errors';
export * from './sql/vector';
export * from './sql/search';
export * from './mappers';
export * from './repositories/post-repository';
export * from './repositories/topic-repository';
export * from './repositories/ingestion-repository';
export * from './repositories/source-repository';
export * from './repositories/interest-repository';
export * from './repositories/content-repository';
export * from './repositories/operations-repository';
export * from './repositories/saved-repository';
