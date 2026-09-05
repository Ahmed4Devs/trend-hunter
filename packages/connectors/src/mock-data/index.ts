/**
 * The offline corpus.
 *
 * `DATA_MODE=mock` has to produce data good enough that normalisation,
 * deduplication, clustering, scoring and the dashboard all behave the way they
 * will on live data. That means the same event has to surface on several
 * sources in different words, engagement has to be heavy-tailed, timestamps
 * have to spread realistically, and a proportion of the corpus has to be
 * Arabic. Everything here is generated from a seed string and an explicit
 * `now`, never from `Math.random` or the wall clock.
 */

export * from './plan';
export * from './random';
export * from './tail';
export * from './topics';
export * from './types';
