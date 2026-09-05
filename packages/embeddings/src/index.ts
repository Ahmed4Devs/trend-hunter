/**
 * `@trendhunter/embeddings` — the embedding layer.
 *
 * The provider is always injected, never constructed here, so the ingestion
 * pipeline, the search layer and the clustering layer all talk to one interface
 * and the vendor choice stays a wiring decision made at the composition root.
 *
 * The only provider that ships in this package is the deterministic one, which
 * needs no API key: it is what makes the whole product runnable offline.
 */

export * from './deterministic-embedder';
export * from './embedding-service';
export * from './errors';
export * from './vector';
