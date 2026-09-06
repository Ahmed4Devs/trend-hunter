-- One source row per provider kind.
--
-- The whole codebase already assumed this and nothing enforced it. A post
-- stores its provider as a `source_kind` enum, never as a source id, so a
-- second row of the same kind is indistinguishable from the first everywhere it
-- matters:
--
--   * `loadAuthorityWeights` builds a Map keyed by kind, so the last row read
--     silently won and the other's authority weight was discarded;
--   * `findByKind` returned whichever row the planner happened to yield first;
--   * the source list attributes a kind's entire post count to every row of
--     that kind, showing the same number several times.
--
-- A provider that covers many endpoints expresses that in `source_configs` —
-- the seeded RSS row already carries a `feedUrls` array — so this constraint
-- costs nothing and closes the gap.

-- CreateIndex
CREATE UNIQUE INDEX "sources_kind_key" ON "sources"("kind");
