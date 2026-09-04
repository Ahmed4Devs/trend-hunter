import type { SourceKind } from './enums';

/**
 * The connector boundary.
 *
 * A connector knows how to talk to exactly one external provider and how to
 * express what it found as {@link CollectedItem}s. It knows nothing about
 * PostgreSQL, BullMQ, scoring or the user's interests — that keeps provider
 * quirks from leaking into the core pipeline and lets new providers
 * (YouTube, Product Hunt, LinkedIn, news APIs, custom sites) be added without
 * touching the ingestion pipeline.
 */

/** A single externally collected item, before normalisation. */
export interface CollectedItem {
  readonly source: SourceKind;
  /** Stable identifier assigned by the provider. Unique per source. */
  readonly sourceItemId: string;
  /**
   * The provider's response for this item, preserved verbatim so historical
   * data can be reprocessed when the algorithms change.
   */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly kind: 'post' | 'comment';
  /** Set on comments; references the `sourceItemId` of the parent post. */
  readonly parentSourceItemId?: string;
  readonly collectedAt: Date;
}

export interface CollectOptions {
  /** Hard ceiling on the number of items returned by one call. */
  readonly limit: number;
  /** Only return items published at or after this instant, when supported. */
  readonly since?: Date;
  /** Provider-specific configuration resolved from `SourceConfig` rows. */
  readonly config: Readonly<Record<string, unknown>>;
  /** Aborts long-running network work when the job is cancelled. */
  readonly signal?: AbortSignal;
}

export interface CollectResult {
  readonly source: SourceKind;
  readonly items: readonly CollectedItem[];
  /** Number of provider requests issued, used for API usage accounting. */
  readonly requestCount: number;
  /** Non-fatal problems worth surfacing in the scan history. */
  readonly warnings: readonly string[];
}

/**
 * Every provider adapter implements this interface, and nothing else in the
 * system may import a provider module directly.
 */
export interface ContentConnector {
  readonly source: SourceKind;
  /** Human-readable adapter name, e.g. `reddit:mock` or `reddit:http`. */
  readonly name: string;
  collect(options: CollectOptions): Promise<CollectResult>;
}

/**
 * A post as produced by normalisation — the common internal format all
 * connectors converge on.
 */
export interface NormalizedPost {
  readonly source: SourceKind;
  readonly sourcePostId: string;
  readonly authorId: string | null;
  readonly authorName: string | null;
  readonly authorUsername: string | null;
  readonly title: string | null;
  readonly content: string;
  readonly url: string;
  readonly publishedAt: Date;
  readonly likes: number;
  readonly replies: number;
  readonly reposts: number;
  readonly views: number;
  /** Stable hash of the canonical content, used for duplicate detection. */
  readonly contentHash: string;
  /** Canonicalised URL (tracking parameters removed), used for deduplication. */
  readonly canonicalUrl: string;
}

export interface NormalizedComment {
  readonly source: SourceKind;
  readonly sourceCommentId: string;
  readonly parentSourcePostId: string;
  readonly author: string | null;
  readonly content: string;
  readonly likes: number;
  readonly publishedAt: Date;
  readonly contentHash: string;
}

export interface NormalizationResult {
  readonly posts: readonly NormalizedPost[];
  readonly comments: readonly NormalizedComment[];
  /** Items rejected by validation, with the reason, for observability. */
  readonly rejected: readonly { readonly sourceItemId: string; readonly reason: string }[];
}
