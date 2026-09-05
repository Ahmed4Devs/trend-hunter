/**
 * `@trendhunter/search` — keyword, semantic and hybrid search.
 *
 * The SQL lives in `@trendhunter/database`; this package owns the decisions the
 * SQL cannot make for itself: which text search configuration a query belongs
 * to, which arm to run, and what to do when the vector arm is unavailable.
 */

export * from './arabic';
export * from './search-service';
