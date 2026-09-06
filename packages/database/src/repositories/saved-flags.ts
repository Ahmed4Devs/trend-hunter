import type { PrismaClient } from '../client';

/**
 * Per-user saved state, resolved for a whole page at a time.
 *
 * Posts and topics belong to the deployment, not to a user, so "is this saved"
 * has no answer on the row itself — only `saved_items` knows whose save it is.
 * A boolean column on `posts` tried to answer it once and could not: one user's
 * save set the flag for everyone, and their unsave cleared it.
 *
 * Deliberately not re-exported from the package index. It is an implementation
 * detail shared by two repositories, not part of the surface other packages
 * read the database through.
 */

/** The subset of `postIds` this user has saved. */
export async function loadSavedPostIds(
  client: PrismaClient,
  postIds: readonly string[],
  userId: string | null,
): Promise<Set<string>> {
  // A caller with no user — the worker, a system job — has no saved list, so
  // there is nothing to look up and every row reads back unsaved.
  if (userId === null || postIds.length === 0) return new Set();

  const rows = await client.savedItem.findMany({
    where: { userId, postId: { in: [...postIds] } },
    select: { postId: true },
  });
  return new Set(rows.map((row) => row.postId).filter((id): id is string => id !== null));
}
