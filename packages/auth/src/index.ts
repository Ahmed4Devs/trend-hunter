/**
 * `@trendhunter/auth` — authentication and authorization.
 *
 * Better Auth owns credentials, sessions and cookies; this package owns the
 * configuration it runs with and the guards that sit in front of every
 * protected operation.
 *
 * The guards throw rather than return a boolean, because a helper that returns
 * `false` can be called and its result dropped — and that mistake does not look
 * like anything in review.
 */

export * from './config';
export * from './auth';
export * from './authorization';
export * from './provisioning';
