import type { CollectedItem, NormalizationResult } from '@trendhunter/types';

import {
  buildNormalizedPost,
  normalizeItems,
  rejectionFromIssues,
  toDate,
  type NormalizedItem,
} from '../normalize';

import { githubItemSchema, type GithubRelease, type GithubRepository } from './schema';

/**
 * GitHub normalisation.
 *
 * Two shapes arrive from this source and both become posts:
 *
 *  * a repository, whose "content" is its description plus its topics — that is
 *    the text a relevance profile can actually match on;
 *  * a release, whose content is the release notes, which is where a launch is
 *    announced in the words the announcement uses.
 *
 * Stars are the only engagement signal GitHub offers that is comparable to a
 * like, so they map to `likes`; forks are a redistribution of the work and map
 * to `reposts`. Neither is a view count, so `views` stays zero rather than being
 * invented — the engagement model treats a missing signal as absent, not as a
 * guess.
 */

export function normalizeGithubItem(item: CollectedItem): NormalizedItem {
  const parsed = githubItemSchema.safeParse(item.payload);
  if (!parsed.success) return { rejected: rejectionFromIssues(parsed.error.issues) };

  return parsed.data.kind === 'repository'
    ? normalizeRepository(parsed.data)
    : normalizeRelease(parsed.data);
}

function normalizeRepository(repository: GithubRepository): NormalizedItem {
  // `pushed_at` is when the repository last changed; `created_at` is when it
  // first appeared. Recency of activity is the signal the trend engine wants.
  const publishedAt = toDate(repository.pushed_at) ?? toDate(repository.created_at);
  if (!publishedAt) return { rejected: 'The repository has no usable timestamp.' };

  const topics = repository.topics ?? [];
  const description = repository.description ?? '';
  const content = [description, topics.length === 0 ? '' : `Topics: ${topics.join(', ')}`]
    .filter((part) => part.trim().length > 0)
    .join('\n\n');

  // A repository with no description carries no text worth scoring; its name
  // alone would match nothing and only add noise to every cluster.
  if (content.trim().length === 0) {
    return { rejected: 'The repository has no description or topics.' };
  }

  const owner = repository.owner?.login ?? repository.full_name.split('/')[0] ?? null;

  return {
    post: buildNormalizedPost({
      source: 'GITHUB',
      sourcePostId: `repo:${String(repository.id)}`,
      authorId: owner,
      authorName: owner,
      authorUsername: owner,
      title: repository.full_name,
      content,
      url: repository.html_url ?? `https://github.com/${repository.full_name}`,
      publishedAt,
      likes: repository.stargazers_count,
      replies: repository.open_issues_count,
      reposts: repository.forks_count,
      views: 0,
    }),
  };
}

function normalizeRelease(release: GithubRelease): NormalizedItem {
  if (release.draft === true) {
    return { rejected: 'The release is a draft and is not public.' };
  }

  const publishedAt = toDate(release.published_at) ?? toDate(release.created_at);
  if (!publishedAt) return { rejected: 'The release has no usable timestamp.' };

  const notes = release.body ?? '';
  if (notes.trim().length === 0) {
    return { rejected: 'The release has no notes.' };
  }

  const title = `${release.repository_full_name} ${release.tag_name}`;
  const author = release.author?.login ?? release.repository_full_name.split('/')[0] ?? null;

  return {
    post: buildNormalizedPost({
      source: 'GITHUB',
      sourcePostId: `release:${String(release.id)}`,
      authorId: author,
      authorName: author,
      authorUsername: author,
      title: release.name ?? title,
      content: notes,
      url:
        release.html_url ??
        `https://github.com/${release.repository_full_name}/releases/tag/${release.tag_name}`,
      publishedAt,
      // A release has no stars of its own, so the repository's are carried over
      // as the audience signal, and reactions stand in for direct engagement.
      likes: release.reactions?.total_count ?? release.repository_stars ?? 0,
      replies: 0,
      reposts: 0,
      views: 0,
    }),
  };
}

export function normalizeGithubItems(items: readonly CollectedItem[]): NormalizationResult {
  return normalizeItems(items, normalizeGithubItem);
}
