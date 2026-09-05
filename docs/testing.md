# Testing

Three layers, each answering a different question.

| | Runs with | Answers |
|---|---|---|
| Unit | `pnpm test` | Does this function do what it says? |
| Integration | `pnpm test` | Do the repositories and services agree with PostgreSQL? |
| End-to-end | `pnpm test:e2e` | Does the product work? |

## Unit and integration

Vitest, per package, with `pnpm test` at the root running them all through
Turborepo. The integration suites in `@trendhunter/database` and
`@trendhunter/search` need the local infrastructure running:

```bash
pnpm docker:up
pnpm db:migrate
pnpm test
```

Two conventions worth knowing:

- **The pure engines take an explicit `now`.** Relevance, trend detection and
  the Arabic opportunity score never read the clock, so their tests assert exact
  numbers rather than ranges, and a scoring change shows up as a failing
  expectation rather than as drift.
- **The offline providers are deterministic.** `DATA_MODE=mock` and
  `AI_PROVIDER=mock` produce the same output for the same input, so a test can
  assert what a connector returned or what a draft says.

## End-to-end

Playwright, driving a real browser against a real stack: a migrated and seeded
PostgreSQL, Redis, the API, the worker, and this application. A mocked API would
test the mock.

```bash
pnpm docker:up                 # PostgreSQL + Redis
pnpm db:migrate && pnpm db:seed
pnpm --filter @trendhunter/api dev      # in its own terminal
pnpm --filter @trendhunter/worker dev   # in its own terminal

pnpm --filter @trendhunter/web test:e2e
```

`test:e2e` builds the web app first and Playwright serves that build. This is
not incidental: `next dev` compiles routes on demand, and its client bundle is
not reliably attached by the time a test clicks — which turns a form submit into
a native navigation and produces failures that have nothing to do with the code
under test.

### Running against something already up

```bash
E2E_BASE_URL=http://127.0.0.1:3100 pnpm --filter @trendhunter/web test:e2e
```

The port in that URL is also the port Playwright starts the server on, so one
variable moves both. The API must trust that origin — it builds its CORS
allowlist from `APP_URL` — so start the API with a matching `APP_URL`.

### How the projects fit together

| Project | What it covers |
|---|---|
| `setup` | Signs in once and saves the session for everything below. |
| `auth` | Sign-in, sign-out, the redirect rules. Signs in for itself. |
| `chromium` | Every other spec, desktop viewport, shared session. |
| `mobile` | The same specs on a phone viewport, for the drawer and stacking. |

The shared session is not an optimisation. Sign-in is rate-limited to five
attempts a minute per address — deliberately, because that is what prices out
credential stuffing — so a suite that signed in per test would spend its run
being refused by a control that is working correctly.

For the same reason `auth.spec.ts` never borrows the shared session: it signs
out, and signing out revokes the session server-side. Doing that to the shared
one produces a redirect loop in an unrelated file a minute later, once the
cookie cache expires. That is a hard failure to read backwards, which is why it
is written down here.

### Writing one

Two rules, both learned from tests that passed while the product was broken:

1. **Assert the page rendered before branching on its contents.** `count()` does
   not wait. A test that reads "if there are no rows, expect the empty state"
   will read an empty page mid-load and take the wrong branch.
2. **Retry an interaction that depends on hydration, not just its result.**
   The global-search shortcut is registered by a client component; a keypress
   that lands before it is listening is simply not heard. `expect(...).toPass()`
   around the press and the assertion is the honest way to say that.

### What they cover

Sign-in and its refusals, the open-redirect guard, sign-out; the dashboard and
its panels; language and direction switching; theme switching and persistence;
posts filtering and search; global search; topics; starting a scan; saving and
unsaving; the translation, draft, thread and report flows; and the mobile drawer
and horizontal-overflow checks.

Some assertions branch on whether the database has content — a freshly seeded
instance has no posts until a scan runs — and assert the empty state instead.
That is deliberate: the empty state is a rendering the product has to get right
too.

## Before a commit

```bash
pnpm verify        # lint + typecheck + test + build
pnpm secrets:scan  # refuses a commit carrying a credential
```
