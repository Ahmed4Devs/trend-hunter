-- Make job_runs.job_id required.
--
-- Every BullMQ job has an id, and the (queue, job_id, attempt) unique key is
-- what lets a retry record its own row instead of overwriting the failure that
-- caused it. A nullable column cannot participate in that key.
--
-- NOTE: `prisma migrate dev` generated eleven further statements here that
-- dropped every HNSW, GIN and trigram index and removed the generation
-- expressions from the search_vector columns. Prisma cannot represent those
-- objects, so it reports them as drift on every diff. They were removed by
-- hand; `scripts/check-migration-safety.mjs` fails the build if they ever
-- reappear.

ALTER TABLE "job_runs" ALTER COLUMN "job_id" SET NOT NULL;
