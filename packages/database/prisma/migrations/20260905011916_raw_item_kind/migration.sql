-- Preserve the provider's item kind on the raw record.
--
-- Comments were being lost between collection and normalisation: the raw table
-- had nowhere to record that an item was a comment or which post it belonged
-- to, so every stored item was re-read as a post and Reddit's comments — where
-- problems and questions actually surface — never reached the comments table.
--
-- NOTE: `prisma migrate dev` also generated statements dropping every HNSW, GIN
-- and trigram index and stripping the generation expressions from the
-- search_vector columns. Prisma cannot represent those objects and reports them
-- as drift on every diff; they were removed by hand and
-- scripts/check-migration-safety.mjs fails the build if they reappear.

-- CreateEnum
CREATE TYPE "raw_item_kind" AS ENUM ('POST', 'COMMENT');

-- AlterTable
ALTER TABLE "raw_items"
  ADD COLUMN "kind" "raw_item_kind" NOT NULL DEFAULT 'POST',
  ADD COLUMN "parent_source_item_id" TEXT;

-- Comments are always fetched for a known parent, so this is the access path.
CREATE INDEX "raw_items_kind_parent_idx"
  ON "raw_items" ("kind", "parent_source_item_id");
