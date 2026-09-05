import {
  addToCentroid,
  assignToTopic,
  deriveTopicName,
  type ClusterableTopic,
  type TopicCentroid,
} from '@trendhunter/clustering';
import { setEmbedding } from '@trendhunter/database';
import { subtractHours } from '@trendhunter/shared';
import { QUEUE_NAMES, type ClusteringJobPayload } from '@trendhunter/types';

import type { JobContext } from '../runtime/processor';
import { enqueue } from '../runtime/queues';

/**
 * Step 4: topic clustering.
 *
 * Posts are assigned to an existing topic or open a new one. The worked example
 * the product is specified against — the same launch surfacing on X, Reddit,
 * Hacker News and RSS in four different wordings — has to end up as one topic,
 * which is why similarity is composite rather than purely semantic: embeddings
 * carry the meaning, entity overlap carries the proper nouns, and time
 * proximity stops two unrelated events that happen to share vocabulary being
 * merged weeks apart.
 *
 * Posts are processed one at a time, in publication order, and the candidate
 * set is refreshed as topics are created. Batching the decisions would mean
 * four posts about the same brand-new story each opening their own topic,
 * because none of them would see the others.
 */

/** How far back the candidate window reaches. */
const CANDIDATE_WINDOW_HOURS = 24 * 14;

/** Ceiling on candidate topics considered per post. */
const CANDIDATE_LIMIT = 500;

export async function processClusteringJob(
  context: JobContext<ClusteringJobPayload>,
): Promise<void> {
  const { payload, logger, container } = context;
  const { repositories, database } = container;

  const posts = await repositories.ingestion.loadPostsForClustering(payload.postIds);
  if (posts.length === 0) {
    logger.info('no embedded posts to cluster');
    return;
  }

  const now = new Date();
  const candidates = await repositories.topics.findClusterCandidates({
    since: subtractHours(now, CANDIDATE_WINDOW_HOURS),
    limit: CANDIDATE_LIMIT,
  });

  const authorityByKind = await repositories.sources.loadAuthorityWeights();

  // Candidates are held in memory and mutated as topics are created or grow, so
  // a post can join a topic that a post earlier in this same batch opened.
  const workingSet = new Map<string, ClusterableTopic>();
  const centroids = new Map<string, TopicCentroid>();
  for (const candidate of candidates) {
    workingSet.set(candidate.id, {
      id: candidate.id,
      name: candidate.name,
      embedding: candidate.embedding,
      firstDetectedAt: candidate.lastDetectedAt,
      lastDetectedAt: candidate.lastDetectedAt,
      postCount: 1,
    });
    centroids.set(candidate.id, { vector: candidate.embedding, count: 1 });
  }

  const ordered = [...posts].sort(
    (a, b) => a.publishedAt.getTime() - b.publishedAt.getTime(),
  );

  const touchedTopicIds = new Set<string>();
  let created = 0;
  let assigned = 0;

  for (const post of ordered) {
    const clusterable = {
      id: post.id,
      source: post.source,
      title: post.title,
      content: post.content,
      canonicalUrl: '',
      contentHash: '',
      publishedAt: post.publishedAt,
      embedding: post.embedding,
      sourceAuthorityWeight: authorityByKind.get(post.source) ?? 0.5,
    };

    const decision = assignToTopic(clusterable, [...workingSet.values()]);

    if (decision.kind === 'ASSIGN_EXISTING') {
      await repositories.ingestion.assignPostToTopic({
        postId: post.id,
        topicId: decision.topicId,
        similarity: decision.similarity.similarity,
        publishedAt: post.publishedAt,
      });
      touchedTopicIds.add(decision.topicId);
      assigned += 1;
      await growTopic(decision.topicId, post.embedding, post.publishedAt);
      continue;
    }

    const name = decision.name;
    const topic = await repositories.topics.create({
      name: name.name,
      // The slug is unique; a collision means a topic of the same name already
      // exists, so the id is appended rather than failing the whole batch.
      slug: `${name.slug}-${post.id.slice(-6)}`,
      firstDetectedAt: post.publishedAt,
      lastDetectedAt: post.publishedAt,
    });

    await repositories.ingestion.assignPostToTopic({
      postId: post.id,
      topicId: topic.id,
      similarity: 1,
      publishedAt: post.publishedAt,
    });

    workingSet.set(topic.id, {
      id: topic.id,
      name: name.name,
      embedding: post.embedding,
      firstDetectedAt: post.publishedAt,
      lastDetectedAt: post.publishedAt,
      postCount: 1,
    });
    centroids.set(topic.id, { vector: [...post.embedding], count: 1 });
    await setEmbedding(database, 'topics', topic.id, post.embedding);

    touchedTopicIds.add(topic.id);
    created += 1;
  }

  if (payload.scanRunId !== null) {
    await repositories.operations.incrementScanCounters(payload.scanRunId, {
      topicsCreated: created,
    });
  }

  logger.info({ assigned, created, topics: touchedTopicIds.size }, 'clustering finished');

  if (touchedTopicIds.size === 0) return;
  await enqueue(container, QUEUE_NAMES.trendAnalysis, 'analyse', {
    scanRunId: payload.scanRunId,
    topicIds: [...touchedTopicIds],
  });

  /**
   * Folds a post into a topic's centroid.
   *
   * Incremental rather than recomputed from every member: a topic with a
   * thousand posts would otherwise re-read a thousand vectors on every new
   * arrival, and the running mean is exactly equal to the batch mean.
   */
  async function growTopic(
    topicId: string,
    embedding: readonly number[],
    publishedAt: Date,
  ): Promise<void> {
    const centroid = addToCentroid(centroids.get(topicId) ?? null, embedding);
    centroids.set(topicId, centroid);

    const existing = workingSet.get(topicId);
    if (existing) {
      workingSet.set(topicId, {
        ...existing,
        embedding: centroid.vector,
        postCount: existing.postCount + 1,
        lastDetectedAt: publishedAt > existing.lastDetectedAt ? publishedAt : existing.lastDetectedAt,
      });
    }

    if (centroid.vector.length > 0) {
      await setEmbedding(database, 'topics', topicId, centroid.vector);
    }
  }
}

export { deriveTopicName };
