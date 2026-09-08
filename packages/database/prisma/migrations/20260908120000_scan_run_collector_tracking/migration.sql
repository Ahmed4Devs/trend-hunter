-- Track which collectors have reported into a scan run.
--
-- A manual scan fans out one collect job per enabled source, all sharing one
-- `scan_runs` row (apps/api/src/queues.ts enqueueScan). Nothing closed that row:
-- the worker finished a run only on the branch `payload.scanRunId === null`,
-- which is the SCHEDULED path, where the worker opens a run of its own per
-- source. Every MANUAL run therefore stayed PENDING for ever -- and
-- `markScanRunning` was never called from anywhere, so a run never even reached
-- RUNNING. In the development database all 9 manual runs sat at PENDING with a
-- null `finished_at`, against 439 completed scheduled ones.
--
-- Recording the SET of finished kinds rather than a counter keeps the close
-- decision idempotent: queue delivery is at-least-once, and a counter would let
-- one collector delivered twice close a run whose siblings are still collecting.

-- AlterTable
ALTER TABLE "scan_runs"
  ADD COLUMN "finished_source_kinds" "source_kind"[] NOT NULL DEFAULT ARRAY[]::"source_kind"[];

-- The runs already stranded by the bug above. They collected their items and
-- their counters are real; only the closing write never happened. Marked
-- COMPLETED so the scan history stops showing work that finished long ago as
-- still pending.
UPDATE "scan_runs"
SET "status" = 'COMPLETED',
    "finished_source_kinds" = "source_kinds",
    "finished_at" = COALESCE("finished_at", "started_at"),
    "duration_ms" = COALESCE("duration_ms", 0)
WHERE "status" = 'PENDING';
