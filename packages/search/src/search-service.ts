import {
  hybridSearchPosts,
  keywordSearchComments,
  keywordSearchPosts,
  keywordSearchTopics,
  semanticSearchPosts,
  suggestSearchTerms,
  type Database,
  type SearchFilters,
  type SearchHit,
} from '@trendhunter/database';
import type { EmbeddingService } from '@trendhunter/embeddings';
import { detectLanguage, MAX_SEARCH_QUERY_LENGTH, ValidationError } from '@trendhunter/shared';
import type { ContentLanguage, SearchEntityKind, SearchMode, SourceKind } from '@trendhunter/types';

import { normalizeArabicForSearch } from './arabic';

/**
 * The search service.
 *
 * It owns one decision the SQL layer deliberately does not make: which
 * *language configuration* and which *arm* to use for a given query. Both are
 * chosen from the query itself rather than from a user-supplied parameter,
 * because a caller that picks the wrong text search configuration gets zero
 * results and no error.
 */

export interface SearchOptions {
  readonly query: string;
  readonly mode: SearchMode;
  readonly entities?: readonly SearchEntityKind[];
  readonly limit: number;
  readonly offset?: number;
  readonly filters?: {
    readonly sources?: readonly SourceKind[];
    readonly languages?: readonly ContentLanguage[];
    readonly topicId?: string;
    readonly publishedFrom?: Date;
    readonly publishedTo?: Date;
    readonly minRelevance?: number;
  };
}

export interface SearchOutcome {
  readonly hits: readonly SearchHit[];
  /** The configuration the query was run under, surfaced for debugging. */
  readonly language: ContentLanguage;
  readonly mode: SearchMode;
  /** True when the vector arm was skipped because no embedding was available. */
  readonly degradedToKeyword: boolean;
}

export interface SearchServiceDependencies {
  readonly database: Database;
  readonly embeddings: EmbeddingService;
}

export function createSearchService({ database, embeddings }: SearchServiceDependencies) {
  return {
    /**
     * Runs a search.
     *
     * When a semantic or hybrid search cannot produce a query embedding — the
     * provider is unavailable, or the query is too short to embed — the search
     * degrades to keyword-only and says so, rather than returning nothing. A
     * search box that silently returns zero results is indistinguishable from
     * one that found nothing.
     */
    async search(options: SearchOptions): Promise<SearchOutcome> {
      const query = prepareQuery(options.query);
      const language = detectQueryLanguage(query);
      const searchQuery = language === 'AR' ? normalizeArabicForSearch(query) : query;
      const filters: SearchFilters = { ...options.filters };
      const entities = options.entities ?? ['post'];

      if (options.mode === 'keyword' || !entities.includes('post')) {
        const hits = await this.searchEntities(searchQuery, language, entities, options);
        return { hits, language, mode: 'keyword', degradedToKeyword: options.mode !== 'keyword' };
      }

      const embedding = await this.embedQuery(searchQuery);
      if (embedding === null) {
        const hits = await this.searchEntities(searchQuery, language, entities, options);
        return { hits, language, mode: 'keyword', degradedToKeyword: true };
      }

      if (options.mode === 'semantic') {
        const hits = await semanticSearchPosts(database, {
          embedding,
          limit: options.limit,
          ...(options.offset === undefined ? {} : { offset: options.offset }),
          filters,
        });
        return { hits, language, mode: 'semantic', degradedToKeyword: false };
      }

      const hits = await hybridSearchPosts(database, {
        query: searchQuery,
        embedding,
        language,
        limit: options.limit,
        ...(options.offset === undefined ? {} : { offset: options.offset }),
        filters,
      });
      return { hits, language, mode: 'hybrid', degradedToKeyword: false };
    },

    /** Keyword search across the requested entity kinds, merged by rank. */
    async searchEntities(
      query: string,
      language: ContentLanguage,
      entities: readonly SearchEntityKind[],
      options: SearchOptions,
    ): Promise<SearchHit[]> {
      const filters: SearchFilters = { ...options.filters };
      const perEntity = Math.max(1, Math.ceil(options.limit / Math.max(1, entities.length)));

      const results = await Promise.all([
        entities.includes('post')
          ? keywordSearchPosts(database, {
              query,
              language,
              limit: options.limit,
              ...(options.offset === undefined ? {} : { offset: options.offset }),
              filters,
              withHeadline: true,
            })
          : Promise.resolve([]),
        // Every arm is paged, not just the post arm. While the topic and
        // comment arms ignored the offset they returned their first page
        // again on every request, so page 2 of a multi-entity search repeated
        // the same topics under the posts that had genuinely advanced.
        entities.includes('topic')
          ? keywordSearchTopics(database, {
              query,
              language,
              limit: perEntity,
              ...(options.offset === undefined ? {} : { offset: options.offset }),
            })
          : Promise.resolve([]),
        entities.includes('comment')
          ? keywordSearchComments(database, {
              query,
              language,
              limit: perEntity,
              ...(options.offset === undefined ? {} : { offset: options.offset }),
            })
          : Promise.resolve([]),
      ]);

      // Rank descending across entity kinds. `ts_rank_cd` with normalisation 32
      // is squashed into 0..1, so scores from different tables are comparable.
      return results
        .flat()
        .sort((a, b) => b.score - a.score)
        .slice(0, options.limit);
    },

    /** Suggestions for the search box, backed by the trigram indexes. */
    async suggest(prefix: string, limit: number) {
      const trimmed = prefix.trim();
      if (trimmed.length === 0) return [];
      return suggestSearchTerms(database, { prefix: trimmed.slice(0, 60), limit });
    },

    /**
     * Embeds a query, returning `null` rather than throwing.
     *
     * An embedding failure must degrade search, not break it: the keyword arm
     * still works, and a user typing into a search box should never see an
     * error because a model was briefly unavailable.
     */
    async embedQuery(query: string): Promise<number[] | null> {
      try {
        const vector = await embeddings.embedOne(query);
        return [...vector];
      } catch {
        return null;
      }
    },
  };
}

export type SearchService = ReturnType<typeof createSearchService>;

/** Validates and bounds a query before it reaches PostgreSQL. */
function prepareQuery(raw: string): string {
  const trimmed = raw.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
  if (trimmed.length === 0) {
    throw new ValidationError('A search query must not be empty.');
  }
  return trimmed;
}

/**
 * Picks the text search configuration from the query itself.
 *
 * Asking the caller would mean a mismatched configuration returns nothing with
 * no error to notice. Detection is script-based, so an Arabic query reaches the
 * Arabic configuration and everything else reaches the English one.
 */
export function detectQueryLanguage(query: string): ContentLanguage {
  const detected = detectLanguage(query);
  return detected.language === 'AR' ? 'AR' : 'EN';
}
