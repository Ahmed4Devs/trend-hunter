-- Remove the deployment-wide `is_saved` flag from posts.
--
-- Saving is per user: `saved_items` is keyed on (user_id, post_id), so a single
-- boolean on `posts` could not describe it. While the column existed, saving a
-- post set the flag for the whole deployment — another user's post list showed
-- it as saved, `?isSaved=true` returned everyone's saves merged together, and
-- an unsave by one user cleared the flag for all of them.
--
-- The reader now joins `saved_items` for a whole page at a time, which is what
-- the topic reader has always done. Nothing is lost with the column: every save
-- it described is already a row in `saved_items`, which the flag was only ever
-- a denormalised copy of.
--
-- `threads.is_saved` and `content_drafts.is_saved` are kept. Both tables carry
-- a `user_id` and belong to exactly one user, so one boolean is a truthful
-- answer there.

-- AlterTable
ALTER TABLE "posts" DROP COLUMN "is_saved";
