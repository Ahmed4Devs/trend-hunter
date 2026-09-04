/**
 * `@trendhunter/ranking` — the scoring engines.
 *
 * Every function in this package is pure: no database, no clock, no randomness.
 * Callers pass in the statistics and the reference instant, which is what makes
 * the trend engine reproducible, unit-testable, and safe to re-run over
 * historical data when the weights change.
 */

export * from './weights';
export * from './engagement';
export * from './relevance';
export * from './trend';
export * from './arabic-opportunity';
export * from './classification';
