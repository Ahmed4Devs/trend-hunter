/**
 * `@trendhunter/ai` — the provider-independent LLM layer.
 *
 * Everything above this package talks to `LlmProvider` from
 * `@trendhunter/types` and never to a vendor. The default implementation is
 * offline and deterministic, so translation, the Content Studio, summarisation,
 * relevance classification and the embeddings that drive clustering and
 * semantic search all work end to end with no API key and no network.
 *
 * Nothing a provider returns is trusted: every response is validated against
 * the Zod contracts in `./schemas` before it leaves this package.
 */

export * from './analysis';
export * from './composer';
export * from './deterministic';
export * from './factory';
export * from './http-provider';
export * from './lexicon';
export * from './mock-provider';
export * from './schemas';
export * from './translator';
export * from './usage';
