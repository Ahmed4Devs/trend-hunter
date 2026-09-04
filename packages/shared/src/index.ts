/**
 * `@trendhunter/shared` — dependency-free helpers used by every service.
 *
 * Rules for this package:
 *  - pure functions only, no I/O beyond the DNS lookup used by the URL guard;
 *  - no framework imports, so it stays usable from the API, the worker, the
 *    Next.js server and the browser bundle alike;
 *  - everything here is unit-tested, because the scoring engines build on it.
 */

export * from './assert';
export * from './constants';
export * from './errors';
export * from './language';
export * from './math';
export * from './pagination';
export * from './text';
export * from './time';
export * from './url-guard';
