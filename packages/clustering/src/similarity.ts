import {
  clamp01,
  cosineSimilarity,
  halfLifeDecay,
  hoursBetween,
  rescaleSimilarity,
  round,
} from '@trendhunter/shared';
import type { SourceKind } from '@trendhunter/types';

import { containment, coverage, extractContentTokens, extractEntities, jaccard } from './text';
import { stripHeadlineBoilerplate } from './topic-naming';
import { SIMILARITY_TUNING, SIMILARITY_WEIGHTS } from './weights';

/**
 * The clustering similarity engine.
 *
 * It answers one question — "is this post about the same event as this topic?" —
 * by combining four independent signals, and it reports all four rather than a
 * single number. The composite is what the `topic_posts` join stores, and the
 * components are what the topic page shows when a user asks why a post ended up
 * where it did; a bare 0.71 explains nothing.
 *
 * Pure and clock-free: the only instants involved are the post's and the
 * topic's own, so re-running the engine over historical data reproduces exactly
 * the assignments that were made at the time.
 */

/** The fields of a post the clustering engine needs. Mirrors the `posts` row. */
export interface ClusterablePost {
  readonly id: string;
  readonly source: SourceKind;
  readonly title: string | null;
  readonly content: string;
  /** Canonicalised URL, as produced by `canonicalizeUrl`. */
  readonly canonicalUrl: string;
  /** Fingerprint of the normalised text, as produced by `contentHash`. */
  readonly contentHash: string;
  readonly publishedAt: Date;
  /** Written by the embeddings worker; absent until that job has run. */
  readonly embedding?: readonly number[] | undefined;
  /** 0..1 authority weight configured for the source. */
  readonly sourceAuthorityWeight?: number | undefined;
  /** 0..100 normalised engagement, used only to pick the strongest headline. */
  readonly engagementScore?: number | undefined;
}

/** The fields of an existing topic a post may be assigned to. */
export interface ClusterableTopic {
  readonly id: string;
  readonly name: string;
  readonly summary?: string | null;
  /** Centroid of the member posts' embeddings; see `./centroid`. */
  readonly embedding?: readonly number[] | undefined;
  /** Extra vocabulary accumulated from member headlines, when the caller has it. */
  readonly keyTerms?: readonly string[] | undefined;
  readonly firstDetectedAt: Date;
  readonly lastDetectedAt: Date;
  readonly postCount: number;
}

/**
 * The comparable form of a post or a topic. Building one costs a full
 * tokenisation pass, so callers that score one post against many topics build
 * the post's profile once and hand it to every comparison.
 */
export interface ClusterProfile {
  /** Content words of the headline — the title, or the opening of the body. */
  readonly headlineTokens: ReadonlySet<string>;
  /** Content words of the headline and the body together. */
  readonly allTokens: ReadonlySet<string>;
  /** Capitalised names, organisations and versioned product names. */
  readonly entities: ReadonlySet<string>;
  readonly embedding: readonly number[] | null;
}

/** Every component is a 0..1 signal, reported whether or not it was usable. */
export interface SimilarityComponents {
  /** Rescaled cosine similarity of the embeddings. */
  readonly embedding: number;
  /** Overlap of content words, blending headline Jaccard with body coverage. */
  readonly tokenOverlap: number;
  /** Overlap of capitalised entities and product names. */
  readonly entityOverlap: number;
  /** Decay over the distance to the topic's activity window. */
  readonly timeProximity: number;
}

export interface SimilarityResult {
  readonly components: SimilarityComponents;
  /** Weighted agreement of the three textual signals, before the time gate. */
  readonly textualScore: number;
  /** Multiplier the time distance applied to {@link textualScore}. */
  readonly timeGate: number;
  /** Final 0..1 composite; this is the value stored on the topic/post join. */
  readonly similarity: number;
  /** False when either side has no embedding yet and the weight was shared out. */
  readonly embeddingAvailable: boolean;
  /** False when neither side carried an entity, e.g. two Arabic headlines. */
  readonly entitiesAvailable: boolean;
  /** Hours between the post and the nearest edge of the topic's window. */
  readonly hoursApart: number;
}

/** Characters of the body treated as the headline when a post has no title. */
const HEADLINE_FALLBACK_CHARACTERS = 160;

/** Stands in for a missing embedding, so the width check is the only guard. */
const NO_VECTOR: readonly number[] = [];

function usableEmbedding(embedding: readonly number[] | undefined): readonly number[] | null {
  return embedding && embedding.length > 0 ? embedding : null;
}

export function buildPostProfile(post: ClusterablePost): ClusterProfile {
  const body = post.content.slice(0, SIMILARITY_TUNING.maxProfileCharacters);
  // The same cleaning the topic name gets, for the same reason: "Show HN:" and
  // " - The Verge" describe the source, not the event, and left in place they
  // pull two reports of one launch apart on every lexical signal.
  const headline = post.title
    ? stripHeadlineBoilerplate(post.title)
    : body.slice(0, HEADLINE_FALLBACK_CHARACTERS);
  return {
    headlineTokens: extractContentTokens(headline),
    allTokens: extractContentTokens(`${headline} ${body}`),
    entities: extractEntities(`${headline} ${body}`),
    embedding: usableEmbedding(post.embedding),
  };
}

export function buildTopicProfile(topic: ClusterableTopic): ClusterProfile {
  // Key terms are usually member headlines, so they carry the same source
  // boilerplate a post's title does, and a topic that has absorbed three of
  // them would otherwise treat "HN" as one of the names it is about.
  const terms = topic.keyTerms?.map(stripHeadlineBoilerplate).join(' ') ?? '';
  const body = `${topic.summary ?? ''} ${terms}`.slice(0, SIMILARITY_TUNING.maxProfileCharacters);
  return {
    headlineTokens: extractContentTokens(topic.name),
    allTokens: extractContentTokens(`${topic.name} ${body}`),
    entities: extractEntities(`${topic.name} ${body}`),
    embedding: usableEmbedding(topic.embedding),
  };
}

/**
 * Hours a post falls outside a topic's activity window, and 0 while it falls
 * inside it. A topic that is still collecting posts keeps extending its window,
 * so a live story stays open while a dormant one drifts out of reach.
 */
export function hoursOutsideWindow(at: Date, from: Date, to: Date): number {
  const instant = at.getTime();
  const start = Math.min(from.getTime(), to.getTime());
  const end = Math.max(from.getTime(), to.getTime());
  if (!Number.isFinite(instant) || !Number.isFinite(start) || !Number.isFinite(end)) {
    return Number.POSITIVE_INFINITY;
  }
  if (instant >= start && instant <= end) return 0;
  return instant < start
    ? hoursBetween(at, new Date(start))
    : hoursBetween(new Date(end), at);
}

/**
 * Time proximity, on the same 0..1 scale as the textual signals.
 *
 * `halfLifeDecay` treats a non-finite age as zero — which would read as "same
 * instant" — so an unusable timestamp is turned into no proximity at all here
 * rather than maximum proximity.
 */
export function timeProximity(hoursApart: number): number {
  if (!Number.isFinite(hoursApart)) return 0;
  return halfLifeDecay(hoursApart, SIMILARITY_TUNING.timeProximityHalfLifeHours);
}

/**
 * Token agreement.
 *
 * The Jaccard is taken over headlines, which is where an event is named. It is
 * a harsh measure for short strings — one extra word in a five-word title costs
 * a fifth of the score — so it is blended with coverage, taken in whichever
 * direction is kinder: how much of the topic's name the post repeats, or how
 * much of the post's headline the topic already knows. That second term is what
 * lets a Reddit thread titled as a question ("Thoughts about the new XYZ?")
 * join a topic named after a news headline: the thread's body says the words
 * its title left out.
 */
function scoreTokens(post: ClusterProfile, topic: ClusterProfile): number {
  const headline = jaccard(post.headlineTokens, topic.headlineTokens);
  const bodyCoverage = Math.max(
    coverage(topic.headlineTokens, post.allTokens),
    coverage(post.headlineTokens, topic.allTokens),
  );
  const share = SIMILARITY_TUNING.headlineJaccardShare;
  return clamp01(headline * share + bodyCoverage * (1 - share));
}

function scoreEntities(post: ClusterProfile, topic: ClusterProfile): number {
  const share = SIMILARITY_TUNING.entityJaccardShare;
  return clamp01(
    jaccard(post.entities, topic.entities) * share +
      containment(post.entities, topic.entities) * (1 - share),
  );
}

function scoreEmbedding(post: ClusterProfile, topic: ClusterProfile): number {
  const a = post.embedding ?? NO_VECTOR;
  const b = topic.embedding ?? NO_VECTOR;
  // A width mismatch means the two vectors came from different models; comparing
  // them would produce a meaningless number, so the signal is dropped instead.
  if (a.length === 0 || a.length !== b.length) return 0;
  return rescaleSimilarity(
    cosineSimilarity(a, b),
    SIMILARITY_TUNING.embeddingFloor,
    SIMILARITY_TUNING.embeddingCeiling,
  );
}

/**
 * Weighted sum over the signals that were actually usable.
 *
 * Redistributing the weight of an unusable signal is what keeps a text-only
 * post — collected before the embeddings worker has run — comparable with one
 * that has a vector: without it every such post would be capped at 0.45 and
 * would silently start its own topic.
 */
function combineTextual(
  parts: readonly { readonly value: number; readonly weight: number; readonly usable: boolean }[],
): number {
  let weighted = 0;
  let totalWeight = 0;
  for (const part of parts) {
    if (!part.usable) continue;
    weighted += part.value * part.weight;
    totalWeight += part.weight;
  }
  return totalWeight === 0 ? 0 : clamp01(weighted / totalWeight);
}

/**
 * Composite similarity between a post and a candidate topic.
 *
 * Pass `postProfile` when scoring one post against several topics; it is
 * derived from `post` and is only a parameter to save the repeated tokenisation.
 */
export function calculateSimilarity(
  post: ClusterablePost,
  topic: ClusterableTopic,
  postProfile: ClusterProfile = buildPostProfile(post),
  topicProfile: ClusterProfile = buildTopicProfile(topic),
): SimilarityResult {
  const embeddingAvailable =
    postProfile.embedding !== null &&
    topicProfile.embedding !== null &&
    postProfile.embedding.length === topicProfile.embedding.length;
  const entitiesAvailable = postProfile.entities.size > 0 || topicProfile.entities.size > 0;

  const embedding = scoreEmbedding(postProfile, topicProfile);
  const tokenOverlap = scoreTokens(postProfile, topicProfile);
  const entityOverlap = scoreEntities(postProfile, topicProfile);

  const hoursApart = hoursOutsideWindow(post.publishedAt, topic.firstDetectedAt, topic.lastDetectedAt);
  const proximity = timeProximity(hoursApart);

  const textualScore = combineTextual([
    { value: embedding, weight: SIMILARITY_WEIGHTS.embedding, usable: embeddingAvailable },
    { value: tokenOverlap, weight: SIMILARITY_WEIGHTS.tokenOverlap, usable: true },
    { value: entityOverlap, weight: SIMILARITY_WEIGHTS.entityOverlap, usable: entitiesAvailable },
  ]);

  const floor = SIMILARITY_TUNING.timeGateFloor;
  const timeGate = floor + (1 - floor) * proximity;
  const precision = SIMILARITY_TUNING.precision;

  return {
    components: {
      embedding: round(embedding, precision),
      tokenOverlap: round(tokenOverlap, precision),
      entityOverlap: round(entityOverlap, precision),
      timeProximity: round(proximity, precision),
    },
    textualScore: round(textualScore, precision),
    timeGate: round(timeGate, precision),
    similarity: round(clamp01(textualScore * timeGate), precision),
    embeddingAvailable,
    entitiesAvailable,
    // Deliberately not rounded through `round`, which maps a non-finite value
    // to 0 — the caller's time-gap refusal reads this field.
    hoursApart: Number.isFinite(hoursApart) ? round(hoursApart, precision) : hoursApart,
  };
}
