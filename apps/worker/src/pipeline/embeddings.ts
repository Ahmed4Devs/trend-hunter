import { setEmbeddings } from '@trendhunter/database';
import { MAX_IDS_PER_JOB } from '@trendhunter/shared';
import { QUEUE_NAMES, type EmbeddingsJobPayload } from '@trendhunter/types';

import type { JobContext } from '../runtime/processor';
import { enqueue } from '../runtime/queues';
import { chunked } from './collect';

/**
 * Step 3: embeddings.
 *
 * Vectors are written with one `UPDATE ... FROM (VALUES ...)` per batch rather
 * than a statement per row. An ingestion run embeds hundreds of records at a
 * time, and a row-at-a-time loop would spend the whole job in round trips.
 *
 * Only posts continue to clustering. Comments are embedded so that semantic
 * search can reach them, but they are not clustered: a comment belongs to the
 * topic of its parent post, and treating each one as a candidate would flood
 * the topic space with fragments of conversation.
 */
export async function processEmbeddingsJob(
  context: JobContext<EmbeddingsJobPayload>,
): Promise<void> {
  const { payload, logger, container } = context;
  const { repositories, services, database } = container;

  const embedded = { posts: 0, comments: 0 };

  if (payload.postIds.length > 0) {
    embedded.posts = await embedRecords('post', payload.postIds);
  }
  if (payload.commentIds.length > 0) {
    embedded.comments = await embedRecords('comment', payload.commentIds);
  }

  logger.info(embedded, 'embeddings written');

  if (payload.postIds.length === 0) return;

  for (const chunk of chunked([...payload.postIds], MAX_IDS_PER_JOB)) {
    await enqueue(container, QUEUE_NAMES.clustering, 'cluster', {
      scanRunId: payload.scanRunId,
      postIds: chunk,
    });
  }

  async function embedRecords(kind: 'post' | 'comment', ids: readonly string[]): Promise<number> {
    const records = await repositories.ingestion.loadTextsForEmbedding(kind, ids);
    if (records.length === 0) return 0;

    const vectors = await services.embeddings.embedTexts(records.map((record) => record.text));

    const entries: { id: string; embedding: readonly number[] }[] = [];
    for (const [index, record] of records.entries()) {
      const vector = vectors[index];
      // A `null` slot is an input that was blank after trimming; the record is
      // simply left unembedded rather than being given a meaningless vector.
      if (vector === null || vector === undefined) continue;
      entries.push({ id: record.id, embedding: vector });
    }
    if (entries.length === 0) return 0;

    return setEmbeddings(database, kind === 'post' ? 'posts' : 'comments', entries);
  }
}
