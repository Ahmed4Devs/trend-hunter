/**
 * `@trendhunter/content` — the Content Studio engine.
 *
 * Turns a topic into publishable X content: posts, angles, hooks, ideas and
 * threads. The LLM arrives as a constructor argument, so the package depends on
 * the `LlmProvider` interface and never on a vendor; everything a provider
 * returns is re-validated here before it reaches a user, and every post is held
 * to the X character limit counted the way X counts it.
 */

export * from './prompts';
export * from './provider-output';
export * from './hooks';
export * from './content-service';
export * from './thread-service';
