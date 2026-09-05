import { z } from 'zod';

/**
 * The GitHub payload contract.
 *
 * GitHub sends large, deeply nested objects; only the fields this platform
 * reads are described. Everything optional stays optional, because the shape of
 * a repository differs between the search endpoint, the repository endpoint and
 * a release payload, and a missing star count must never reject an otherwise
 * usable item.
 */

export const githubOwnerSchema = z.object({
  login: z.string().min(1),
  html_url: z.string().optional(),
});

/**
 * A repository as this package stores it.
 *
 * `kind` is set by the adapter rather than by GitHub: repositories and releases
 * arrive from different endpoints with different shapes, and the normaliser has
 * to know which one it is holding without re-inferring it from field presence.
 */
export const githubRepositorySchema = z.object({
  kind: z.literal('repository'),
  id: z.union([z.number(), z.string()]),
  full_name: z.string().min(1),
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  html_url: z.string().optional(),
  language: z.string().nullable().optional(),
  topics: z.array(z.string()).optional(),
  stargazers_count: z.number().optional(),
  forks_count: z.number().optional(),
  open_issues_count: z.number().optional(),
  watchers_count: z.number().optional(),
  pushed_at: z.string().optional(),
  created_at: z.string().optional(),
  owner: githubOwnerSchema.optional(),
});

export type GithubRepository = z.infer<typeof githubRepositorySchema>;

export const githubReleaseSchema = z.object({
  kind: z.literal('release'),
  id: z.union([z.number(), z.string()]),
  /** Repository the release belongs to, folded in by the adapter. */
  repository_full_name: z.string().min(1),
  tag_name: z.string().min(1),
  name: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  html_url: z.string().optional(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
  published_at: z.string().nullable().optional(),
  created_at: z.string().optional(),
  author: githubOwnerSchema.optional(),
  reactions: z
    .object({
      total_count: z.number().optional(),
      '+1': z.number().optional(),
      heart: z.number().optional(),
      rocket: z.number().optional(),
    })
    .optional(),
  /** Repository language and topics, folded in so the item stands alone. */
  repository_language: z.string().nullable().optional(),
  repository_topics: z.array(z.string()).optional(),
  repository_stars: z.number().optional(),
});

export type GithubRelease = z.infer<typeof githubReleaseSchema>;

/** Either kind of stored item, discriminated by the adapter-set `kind`. */
export const githubItemSchema = z.discriminatedUnion('kind', [
  githubRepositorySchema,
  githubReleaseSchema,
]);

export type GithubItem = z.infer<typeof githubItemSchema>;

/** The `GET /repos/{owner}/{repo}` payload, before the adapter stamps `kind`. */
export const githubRepositoryResponseSchema = githubRepositorySchema.omit({ kind: true });

/** The `GET /search/repositories` envelope. */
export const githubSearchResponseSchema = z.object({
  total_count: z.number().optional(),
  incomplete_results: z.boolean().optional(),
  items: z.array(githubRepositoryResponseSchema).default([]),
});

/** The `GET /repos/{owner}/{repo}/releases` envelope. */
export const githubReleaseListSchema = z.array(
  githubReleaseSchema.omit({ kind: true, repository_full_name: true }),
);

/** Operator-supplied settings for this source. */
export const githubConfigSchema = z.object({
  /** Repositories watched explicitly, in `owner/repo` form. */
  repositories: z
    .array(
      z
        .string()
        .trim()
        .regex(/^[\w.-]+\/[\w.-]+$/u, 'must be in owner/repo form'),
    )
    .max(50)
    .default([]),
  /** Search topics used to discover repositories beyond the watched list. */
  topics: z.array(z.string().trim().min(1)).max(20).default(['ai-agents', 'llm']),
  /** Collects releases as well as the repositories themselves. */
  includeReleases: z.boolean().default(true),
  /** Repositories below this star count are ignored as noise. */
  minStars: z.number().int().min(0).max(1_000_000).default(0),
});

export type GithubConfig = z.infer<typeof githubConfigSchema>;

export const GITHUB_CONFIG_DEFAULTS: GithubConfig = {
  repositories: [],
  topics: ['ai-agents', 'llm'],
  includeReleases: true,
  minStars: 0,
};
