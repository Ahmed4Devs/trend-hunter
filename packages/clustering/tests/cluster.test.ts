import { describe, expect, it } from 'vitest';

import { addToCentroid } from '../src/centroid';
import { assignToTopic, rankTopicCandidates } from '../src/cluster';
import type { ClusterablePost, ClusterableTopic } from '../src/similarity';
import { deriveTopicName } from '../src/topic-naming';
import { CLUSTER_DEFAULTS } from '../src/weights';

import {
  hoursAfter,
  makePost,
  OPENAI_LAUNCH_POSTS,
  SAME_COMPANY_OTHER_STORY,
  T0,
  topicFromPost,
  UNRELATED_POST,
} from './fixtures';

// The Reddit post is exercised through OPENAI_LAUNCH_POSTS as a whole, so
// its slot is skipped rather than bound.
const [X_POST, , HN_POST, RSS_POST] = OPENAI_LAUNCH_POSTS;

interface Cluster {
  topic: ClusterableTopic;
  readonly postIds: string[];
}

/**
 * The loop the clustering worker runs, reduced to what this package decides:
 * score against the topics known so far, then either extend one or open a new
 * one. It exists so the tests exercise assignment, naming and the incremental
 * centroid the way the worker chains them, rather than one call at a time.
 */
function clusterAll(posts: readonly ClusterablePost[]): Cluster[] {
  const clusters: Cluster[] = [];

  for (const post of posts) {
    const decision = assignToTopic(
      post,
      clusters.map((cluster) => cluster.topic),
    );

    if (decision.kind === 'CREATE_TOPIC') {
      clusters.push({
        topic: {
          id: `topic-${post.id}`,
          name: decision.name.name,
          summary: null,
          embedding: post.embedding,
          keyTerms: [post.title ?? ''],
          firstDetectedAt: post.publishedAt,
          lastDetectedAt: post.publishedAt,
          postCount: 1,
        },
        postIds: [post.id],
      });
      continue;
    }

    const cluster = clusters.find((entry) => entry.topic.id === decision.topicId);
    expect(cluster, 'assigned topic must exist').toBeDefined();
    if (!cluster) continue;

    const centroid = addToCentroid(
      { vector: cluster.topic.embedding ?? [], count: cluster.postIds.length },
      post.embedding ?? [],
    );
    cluster.postIds.push(post.id);
    cluster.topic = {
      ...cluster.topic,
      embedding: centroid.vector.length > 0 ? centroid.vector : undefined,
      keyTerms: [...(cluster.topic.keyTerms ?? []), post.title ?? ''],
      firstDetectedAt: new Date(
        Math.min(cluster.topic.firstDetectedAt.getTime(), post.publishedAt.getTime()),
      ),
      lastDetectedAt: new Date(
        Math.max(cluster.topic.lastDetectedAt.getTime(), post.publishedAt.getTime()),
      ),
      postCount: cluster.postIds.length,
    };
  }

  return clusters;
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

describe('assignToTopic — the four-source example', () => {
  it('lands one launch reported by X, Reddit, Hacker News and RSS on a single topic', () => {
    const clusters = clusterAll(OPENAI_LAUNCH_POSTS);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.postIds.sort()).toStrictEqual(['hn-1', 'reddit-1', 'rss-1', 'x-1']);
  });

  it('still lands them on one topic before the embeddings worker has run', () => {
    const unembedded = OPENAI_LAUNCH_POSTS.map((post) =>
      makePost({ ...post, embedding: undefined }),
    );
    const clusters = clusterAll(unembedded);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.postIds).toHaveLength(4);
  });

  it('produces the same single cluster for every order the posts can arrive in', () => {
    const orders = permutations(OPENAI_LAUNCH_POSTS);
    expect(orders).toHaveLength(24);

    for (const order of orders) {
      const clusters = clusterAll(order);
      const label = order.map((post) => post.id).join(' > ');
      expect(clusters, label).toHaveLength(1);
      expect(clusters[0]?.postIds.slice().sort(), label).toStrictEqual([
        'hn-1',
        'reddit-1',
        'rss-1',
        'x-1',
      ]);
    }
  });

  it('does not pull an unrelated launch or a different story into the topic', () => {
    const clusters = clusterAll([...OPENAI_LAUNCH_POSTS, UNRELATED_POST, SAME_COMPANY_OTHER_STORY]);

    expect(clusters).toHaveLength(3);
    expect(clusters[0]?.postIds).toHaveLength(4);
    expect(clusters[1]?.postIds).toStrictEqual([UNRELATED_POST.id]);
    expect(clusters[2]?.postIds).toStrictEqual([SAME_COMPANY_OTHER_STORY.id]);
  });
});

describe('assignToTopic — decisions', () => {
  const topic = topicFromPost(X_POST!);

  it('assigns above the threshold and reports the runner-up it beat', () => {
    const other = topicFromPost(UNRELATED_POST, { id: 'topic-unrelated' });
    const decision = assignToTopic(HN_POST!, [other, topic]);

    expect(decision.kind).toBe('ASSIGN_EXISTING');
    if (decision.kind !== 'ASSIGN_EXISTING') return;
    expect(decision.topicId).toBe(topic.id);
    expect(decision.reason).toBe('ABOVE_THRESHOLD');
    expect(decision.runnerUpTopicId).toBe('topic-unrelated');
    expect(decision.margin).toBeGreaterThan(0);
    expect(decision.similarity.components.embedding).toBeGreaterThan(0);
  });

  it('asks for a new topic when nothing comes close, and says which was closest', () => {
    const decision = assignToTopic(UNRELATED_POST, [topic]);

    expect(decision.kind).toBe('CREATE_TOPIC');
    if (decision.kind !== 'CREATE_TOPIC') return;
    expect(decision.reason).toBe('BELOW_THRESHOLD');
    expect(decision.closestCandidate?.topic.id).toBe(topic.id);
    expect(decision.name.name).toBe('Apple ships the new MacBook Pro');
    expect(decision.name.slug).toBe('apple-ships-the-new-macbook-pro');
  });

  it('reports no candidates separately from a weak one', () => {
    const decision = assignToTopic(X_POST!, []);

    expect(decision.kind).toBe('CREATE_TOPIC');
    if (decision.kind !== 'CREATE_TOPIC') return;
    expect(decision.reason).toBe('NO_CANDIDATES');
    expect(decision.closestCandidate).toBeNull();
    expect(decision.name.name).toBe('OpenAI releases XYZ');
  });

  it('refuses to merge across a large time gap, however well the text matches', () => {
    const stale = topicFromPost(X_POST!, {
      id: 'topic-stale',
      firstDetectedAt: hoursAfter(T0, -240),
      lastDetectedAt: hoursAfter(T0, -216),
    });
    const decision = assignToTopic(X_POST!, [stale]);

    expect(decision.kind).toBe('CREATE_TOPIC');
    if (decision.kind !== 'CREATE_TOPIC') return;
    expect(decision.reason).toBe('TIME_GAP_EXCEEDED');
    // The refusal is about time alone: the text agreed completely.
    expect(decision.closestCandidate?.similarity.textualScore).toBeGreaterThan(0.9);
    expect(decision.closestCandidate?.withinTimeGap).toBe(false);
  });

  it('honours a caller-supplied time gap', () => {
    const stale = topicFromPost(X_POST!, {
      id: 'topic-stale',
      firstDetectedAt: hoursAfter(T0, -100),
      lastDetectedAt: hoursAfter(T0, -100),
    });
    const strict = assignToTopic(X_POST!, [stale], { maxTimeGapHours: 24 });
    const loose = assignToTopic(X_POST!, [stale], {
      maxTimeGapHours: 240,
      assignmentThreshold: 0.3,
    });

    expect(strict.kind).toBe('CREATE_TOPIC');
    expect(loose.kind).toBe('ASSIGN_EXISTING');
  });
});

describe('assignToTopic — stability', () => {
  /** Two topics the post matches identically; only their history differs. */
  const olderTopic = topicFromPost(X_POST!, {
    id: 'topic-older',
    firstDetectedAt: hoursAfter(T0, -6),
    lastDetectedAt: T0,
    postCount: 9,
  });
  const newerTopic = topicFromPost(X_POST!, {
    id: 'topic-newer',
    firstDetectedAt: hoursAfter(T0, -1),
    lastDetectedAt: T0,
    postCount: 2,
  });
  const post = makePost({ ...HN_POST!, publishedAt: hoursAfter(T0, 1) });

  it('gives the same answer whichever order the candidates are loaded in', () => {
    const forward = assignToTopic(post, [olderTopic, newerTopic]);
    const backward = assignToTopic(post, [newerTopic, olderTopic]);

    expect(forward).toStrictEqual(backward);
    expect(forward.kind).toBe('ASSIGN_EXISTING');
  });

  it('breaks a near-tie towards the more established topic', () => {
    const decision = assignToTopic(post, [newerTopic, olderTopic]);

    expect(decision.kind).toBe('ASSIGN_EXISTING');
    if (decision.kind !== 'ASSIGN_EXISTING') return;
    expect(decision.topicId).toBe('topic-older');
    expect(decision.reason).toBe('ESTABLISHED_TOPIC_PREFERRED');
    expect(Math.abs(decision.margin)).toBeLessThanOrEqual(CLUSTER_DEFAULTS.stickinessMargin);
  });

  it('keeps a post on the topic it already has when the margin is small', () => {
    const decision = assignToTopic(post, [olderTopic, newerTopic], {
      incumbentTopicId: 'topic-newer',
    });

    expect(decision.kind).toBe('ASSIGN_EXISTING');
    if (decision.kind !== 'ASSIGN_EXISTING') return;
    expect(decision.topicId).toBe('topic-newer');
    expect(decision.reason).toBe('INCUMBENT_RETAINED');
  });

  it('moves a post off its incumbent topic when a much better one exists', () => {
    const wrongTopic = topicFromPost(UNRELATED_POST, { id: 'topic-wrong' });
    const decision = assignToTopic(post, [wrongTopic, olderTopic], {
      incumbentTopicId: 'topic-wrong',
    });

    expect(decision.kind).toBe('ASSIGN_EXISTING');
    if (decision.kind !== 'ASSIGN_EXISTING') return;
    expect(decision.topicId).toBe('topic-older');
  });

  it('ranks every candidate, including the ones outside the time gap', () => {
    const stale = topicFromPost(X_POST!, {
      id: 'topic-stale',
      firstDetectedAt: hoursAfter(T0, -240),
      lastDetectedAt: hoursAfter(T0, -216),
    });
    const ranked = rankTopicCandidates(post, [stale, newerTopic, olderTopic]);

    expect(ranked).toHaveLength(3);
    expect(ranked.map((entry) => entry.topic.id)).toStrictEqual([
      'topic-older',
      'topic-newer',
      'topic-stale',
    ]);
    expect(ranked.at(-1)?.withinTimeGap).toBe(false);
  });
});

describe('derived names on creation', () => {
  it('names a new topic after the post that opened it', () => {
    const decision = assignToTopic(RSS_POST!, []);
    if (decision.kind !== 'CREATE_TOPIC') throw new Error('expected a new topic');

    expect(decision.name).toStrictEqual(deriveTopicName([RSS_POST!]));
    expect(decision.name.name).toBe('OpenAI announces XYZ');
  });

  it('respects a caller-supplied name length', () => {
    const decision = assignToTopic(RSS_POST!, [], { maxNameLength: 12 });
    if (decision.kind !== 'CREATE_TOPIC') throw new Error('expected a new topic');

    expect(decision.name.name.length).toBeLessThanOrEqual(12);
  });
});
