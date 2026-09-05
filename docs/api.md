# API

REST over `/api/v1`, documented by the service itself. With
`ENABLE_API_DOCS=true` the explorer is at `/docs` and the OpenAPI document at
`/docs/json`. It is off by default in production: an explorer is a map of the
attack surface, and the document is generated from the same schemas either way.

## Conventions

**One envelope, two shapes.** Every endpoint answers with exactly one of these,
so a client never has to guess where the payload is:

```jsonc
{ "data": … , "meta": { "requestId": "…", "pagination": { … } } }
{ "error": { "code": "…", "message": "…", "details": { … }, "requestId": "…" } }
```

**Errors are identified by code, not by message.** The message is for a person
and may be translated; `code` is what a client branches on:

```text
VALIDATION_ERROR  UNAUTHENTICATED  FORBIDDEN  NOT_FOUND  CONFLICT
RATE_LIMITED  PAYLOAD_TOO_LARGE  UNSUPPORTED_MEDIA_TYPE
UPSTREAM_UNAVAILABLE  FEATURE_DISABLED  INTERNAL_ERROR
```

A 4xx explains itself. A 5xx says nothing beyond a request id — everything
needed to diagnose it is in the logs against that id, and the client is given
the id to quote.

**Input is parsed, never cast.** Every route declares Zod schemas for its
params, query and body. Responses are serialised through a declared schema too,
so a field that is not in the schema is dropped even if a repository starts
returning it.

**Pagination is offset-based** — `page` and `pageSize`, with `pageSize` capped
at 100. Relevance-ranked lists cannot produce an honest total cheaply, so page
with `meta.pagination.hasNextPage` rather than trusting `totalPages` there.

## Authentication

A session cookie issued by `POST /api/auth/sign-in/email`. Sign-up over HTTP is
disabled: accounts are provisioned by the seed or by an administrator.

```bash
curl -c jar -X POST https://trendhunter.example.com/api/auth/sign-in/email \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"…"}'

curl -b jar https://trendhunter.example.com/api/v1/dashboard?range=7d
```

Rate limits are three-tiered: a default per-user (or per-address) limit, a
tighter one on authentication that always keys on the address, and a tighter
one still on anything that costs a provider call.

## The surface

| Group | Endpoints |
|---|---|
| Health | `GET /health`, `GET /ready` |
| Dashboard | `GET /dashboard`, `GET /dashboard/usage` |
| Posts | `GET /posts`, `GET /posts/:id`, `PATCH /posts/:id`, `GET /posts/:id/related`, `GET /comments` |
| Topics | `GET /topics`, `GET /topics/:id`, `PATCH /topics/:id`, `GET /topics/:id/posts`, `GET /topics/:id/trend` |
| Trends | `GET /trends`, `GET /trends/emerging`, `GET /trends/hidden-gems` |
| Search | `GET /search`, `GET /search/suggestions` |
| Sources | `GET /sources`, `GET /sources/:id`, `PATCH /sources/:id`, `GET|PUT /sources/:id/config` |
| Interests | `GET|POST /interests`, `GET|PATCH|DELETE /interests/:id` |
| Translations | `POST|GET /translations`, `GET|PATCH|DELETE /translations/:id` |
| Content | `POST /content/generate`, `GET /content/drafts`, `GET|PATCH|DELETE /content/drafts/:id`, `POST /content/drafts/:id/rewrite`, `POST /content/drafts/:id/regenerate` |
| Threads | `POST|GET /threads`, `GET|PATCH|DELETE /threads/:id`, `POST /threads/:id/translate` |
| Saved | `GET|POST /saved`, `DELETE /saved/:id`, `DELETE /saved/target`, `GET /saved/collections` |
| Publications | `GET|POST /manual-publications`, `GET|PATCH|DELETE /manual-publications/:id` |
| Operations | `POST|GET /scans`, `GET /scans/:id`, `GET /jobs` |
| Reports | `POST|GET /reports`, `GET|DELETE /reports/:id` |
| Settings | `GET|PATCH /settings`, `GET|PATCH /settings/profile`, `GET /settings/me` |

Administrator-only writes: source configuration and enablement. The check is on
the server; the interface only decides what to render.

## Two behaviours worth knowing

**`POST /scans` never collects inside the request.** Five providers, each rate
limited and retried, take minutes and would be lost if the client disconnected.
It enqueues one job per enabled source and answers with the scan run — 202 when
it accepted one, 200 when a manual scan was already in flight, because a button
that is pressed twice should not start two scans.

**`GET /search` reports its own degradation.** When the embedding provider is
unavailable the vector arm is skipped and the response carries
`degradedToKeyword: true`. A reader who searched for a paraphrase and got
nothing needs to know why, rather than concluding that nothing was collected.
