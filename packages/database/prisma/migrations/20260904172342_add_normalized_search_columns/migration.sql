-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "normalized_content" TEXT;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "normalized_content" TEXT,
ADD COLUMN     "normalized_title" TEXT;

-- AlterTable
ALTER TABLE "topics" ADD COLUMN     "normalized_name" TEXT,
ADD COLUMN     "normalized_summary" TEXT;
