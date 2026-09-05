# Security

What is trusted, what is not, and what enforces the difference. This describes
the system as built; where something is a deliberate limitation it says so.

## Trust boundaries

```text
browser ──HTTPS──► Caddy ──► Fastify ──► PostgreSQL / Redis
                              ▲
                              └── the only place authorisation is decided
```

Everything crossing into Fastify is untrusted: query strings, bodies, headers,
cookies, and every provider payload the worker collected. Everything the browser
renders has already been through it.

## Authentication

- Better Auth with email and password. **Sign-up over HTTP is disabled**;
  accounts are provisioned by an operator or by the seed, through Better Auth's
  own internal adapter so the password hash is produced by the same code that
  will verify it.
- Session cookies are `httpOnly`, `SameSite=Lax`, `Secure` in production, and
  carry the `__Secure-` prefix there. Lax rather than None is possible because
  the web app and the API share an origin behind Caddy.
- A signed session snapshot is cached in the cookie for 60 seconds. That is the
  window in which a revoked session still works — short on purpose, because the
  alternative is a database read on every request.
- A banned user is rejected on every request, not only at sign-in: the ban is
  checked when the session is resolved, so an existing cookie stops working
  immediately.
- Sign-in answers the same way for an unknown account and a wrong password.
  Distinguishing them turns the form into an account-enumeration oracle.

## Authorisation

Decided by the API on every request. The web application's role checks are
presentation only — a non-administrator sees a control disabled rather than
hidden, and the API refuses the write regardless of what the interface rendered.

The `proxy.ts` gate in the web app checks only whether a session cookie is
*present*. It does not verify the signature, the expiry, or a ban, and it is not
authorisation: it is a redirect that keeps an anonymous visitor out of the
dashboard without a network call per navigation.

## Input validation

Every route declares a Zod schema for its params, query and body. Nothing is
cast. Two consequences worth stating:

- **Responses are serialised through a declared schema**, so a field that is not
  in the schema is dropped even if a repository starts returning it. Leaking a
  column becomes impossible rather than unlikely.
- **Queue payloads are parsed, not cast.** A job was written by a different
  process, possibly a different release, and may have sat in Redis across a
  deploy. A payload that fails validation fails unrecoverably rather than
  burning three retries on something that can never succeed.

## SQL and the database

- Prisma everywhere; raw SQL only for pgvector and full-text search, always
  parameterised, never string-interpolated.
- The application connects as a non-superuser role.
- Statement timeouts and an explicit pool size, so one pathological query cannot
  hold a connection indefinitely.
- Deletion is explicit in the schema: cascades exist only where a child row is
  meaningless without its parent, and `Restrict` everywhere else, so a mistake
  fails loudly instead of quietly removing history.

## Output and XSS

`dangerouslySetInnerHTML` is banned by an ESLint rule, not by convention. Every
piece of content this product renders came from a third-party feed or from a
language model, and both are untrusted input. Collected text is rendered as
text; the search headline is the only marked-up value and it is escaped.

## Rate limiting

Redis-backed, so the limit is shared across replicas rather than multiplied by
them. Three tiers:

| | |
|---|---|
| Default | Per user when there is one, per address otherwise — an office IP does not let one user exhaust everyone's budget. |
| Auth | Always per address. Keying a sign-in attempt on the account being attacked would let an attacker lock a victim out. |
| Expensive | Anything that costs a provider call: search with embeddings, generation, translation. |

Health and readiness are exempt: a limiter that throttles the probe takes the
service out of rotation under load.

## SSRF

The RSS connector fetches URLs a user supplies. Requests to private address
ranges are refused, `ALLOW_PRIVATE_NETWORK_FETCH` must stay false in production,
and the environment validator enforces that rather than trusting the operator to
remember.

## Secrets

- Never in the repository. `pnpm secrets:scan` fails a commit that contains one.
- `.env` is git-ignored; `.env.example` holds placeholders, and the production
  validator refuses to start when a placeholder survives into a deployment.
- No package reads `process.env`. Configuration is validated once at a
  composition root and passed down, so a missing value fails at start-up rather
  than surfacing as `undefined` inside a connection string.
- Errors are sanitised on the way out: a 4xx explains itself, a 5xx says nothing
  and carries a request id. What is needed to diagnose it is logged, with
  credentials and connection strings masked.

## Headers

Set by Caddy and by Fastify's Helmet configuration: HSTS (two years, preload —
see the caveat in [Deployment](deployment.md#certificates)), `nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a Permissions-Policy
that turns off every device API, and no `Server` or `X-Powered-By`.

## Known limitations

Stated rather than implied:

- **No MFA.** Accounts are operator-provisioned and few; adding TOTP is the
  obvious next step if that changes.
- **No audit log.** Job runs and scans are recorded; who changed a setting is
  not.
- **The 60-second session cache** is a real revocation window.
- **Email is not verified** because there is no email delivery: accounts are
  created by an operator who already knows the address.
- **`NEXT_PUBLIC_*` values are baked into the browser bundle** at build time.
  Nothing secret may ever be given one of those names.

## Reporting

Report a vulnerability privately to the repository owner. Please do not open a
public issue for anything exploitable.
