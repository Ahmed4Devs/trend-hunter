# Architecture notes

The decisions worth knowing about before changing something, and why they are
the way they are. Not an inventory — the code is the inventory.

## The dependency rule

`apps` may depend on `packages`. A package may depend on packages below it in
the graph. Nothing in `packages` imports from `apps`, and **no package reads
`process.env`**: configuration is validated once at a composition root and
passed down as an argument.

That last rule is what makes the packages testable without infrastructure. A
translation service that reads its own API key from the environment cannot be
constructed in a test; one that takes a provider can.

The seed lives in its own package for the same reason inverted: it composes
persistence with authentication, and `@trendhunter/database` must not depend on
`@trendhunter/auth` because auth already depends on the database. Putting the
seed in either would close a cycle.

## The pipeline is a chain of queues

```text
collect ─► normalize ─► embeddings ─► clustering ─► trend analysis
```

Each step enqueues the next rather than calling it. A failure in clustering must
not roll back a successful collection, each step retries on its own terms, and
no single job holds a lock for the duration of an entire ingestion run.

A BullMQ `FlowProducer` would express the same chain as a parent/child tree, but
the fan-out is uneven — one collection becomes many normalisation jobs, which
become a variable number of embedding jobs — and a flow's parent completes only
when every descendant does, which turns one slow provider into a stalled tree.

Concurrency is set per queue because the work differs. Collection is IO-bound
and rate-limited per provider. Clustering and trend analysis are **deliberately
serial**: clustering decides against the topics it can see, so two concurrent
jobs would each open a topic for the same story because neither would see the
other's. That is also why posts are clustered one at a time, in publication
order.

## Raw payloads are stored before anything is interpreted

`raw_items` holds what the provider actually said, verbatim, before
normalisation. When the normalisation rules, the language detection or the
scoring change, history can be reprocessed from the source rather than from our
earlier interpretation of it. It is the difference between a bug fix that
improves future data and one that improves all of it.

## Every score stores its components

A trend score is written with velocity, engagement, freshness, cross-source
confirmation, authority, novelty, the Arabic opportunity and the saturation
penalty beside it. That is a product requirement, not bookkeeping: the interface
has to explain why a topic is trending, and a stored total with no components
can only assert it.

The engines are pure functions that take an explicit `now`, so re-running a job
over the same topic produces the same numbers. That determinism is what makes a
retry safe.

## Search is hybrid, and says when it is not

Keyword and semantic arms, fused. When the embedding provider is unavailable the
vector arm is skipped and the response says `degradedToKeyword: true` rather
than silently returning keyword results. A reader who searched for a paraphrase
and got nothing needs to know why, instead of concluding that nothing was
collected.

Arabic is folded — normalised alef, stripped diacritics — on both the indexed
column and the query. Applying it to one side only would be worse than applying
it to neither.

## The web app owns no session logic

It asks the service that issued the cookie. One definition of "signed in", one
place a revoked session takes effect. A second local check would eventually
disagree with the first, and the interface would render for a user that every
request then rejects.

Server Components forward the caller's cookies to the API and never cache: every
page shows live collection state, and Next's default fetch caching would serve a
dashboard from before the last scan with no indication that it had.

## Locale is a cookie, not a URL segment

This is a private dashboard behind a session. There is nothing to index and no
link to share in a particular language, so a `[locale]` segment would duplicate
every route and every redirect to buy nothing. The trade is that the locale must
be set server-side — it is a Server Action — because it decides what the server
renders, including the `dir` attribute.

## Colour is measured, not chosen

The chart palette was validated against colour-vision deficiency, a lightness
band and a contrast floor. The providers' own brand colours were tried first and
fail on measurement: X's near-black is outside the band, Reddit's and Hacker
News's oranges are 9.6 apart in normal vision against a floor of 15, and Reddit
against GitHub's blue collapses to 1.3 under deuteranopia.

Sources take fixed slots in that palette, by identity and never by rank, so
filtering one out cannot repaint the others. Colour is never the only encoding:
every chart carries a legend or direct labels, and every status carries a word.

## Where the boundaries are enforced

| Boundary | Enforced by |
|---|---|
| HTTP input | Zod schemas on every route; nothing is cast |
| HTTP output | Declared response schemas, so an undeclared field is dropped |
| Queue input | The same schemas, parsed in the processor wrapper |
| Authorisation | The API, on every request. The UI's role checks are presentation |
| Rendering | `dangerouslySetInnerHTML` banned by lint; all content is third-party |

## What is deliberately not here

- **No publishing.** V1 records what a person published by hand.
- **No down-migrations.** A generated reverse migration is a guess about data it
  has never seen; the rollback path is a restore.
- **No client-side sorting or filtering in tables.** Every list is paged by
  PostgreSQL over the whole collection, so sorting the page in the browser would
  look right and be wrong from the second page onwards.
