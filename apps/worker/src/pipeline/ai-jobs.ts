import {
  characterCount,
  NotFoundError,
  WORKER_HEARTBEAT_KEY,
  WORKER_HEARTBEAT_TTL_SECONDS,
} from '@trendhunter/shared';
import type {
  ContentGenerationJobPayload,
  MaintenanceJobPayload,
  ReportGenerationJobPayload,
  TranslationJobPayload,
} from '@trendhunter/types';

import type { JobContext } from '../runtime/processor';

/**
 * The queued AI operations and the maintenance job.
 *
 * These are queued rather than run inline for the same reason as collection:
 * they are slow, they can fail transiently, and they cost money. A user waiting
 * on an HTTP response for a thread translation would time out long before the
 * work finished.
 */

/**
 * Translation.
 *
 * A thread is translated as one narrative — never post by post — because the
 * references between posts, the hook and the conclusion only make sense
 * together. Splitting back into posts happens after the Arabic has been
 * optimised, on sentence boundaries and within the character limit.
 */
export async function processTranslationJob(
  context: JobContext<TranslationJobPayload>,
): Promise<void> {
  const { payload, logger, container } = context;
  const { repositories, services } = container;

  const settings = await repositories.users.loadSettings(payload.userId);

  if (payload.targetKind === 'THREAD') {
    const thread = await repositories.content.findThread(payload.userId, payload.targetId);
    if (thread === null) throw new NotFoundError('Thread');

    const result = await services.threadTranslator.translateThread({
      posts: thread.posts.map((post) => post.content),
      sourceLanguage: thread.language,
      targetLanguage: payload.targetLanguage,
      mode: payload.mode,
      terminologyPreference: settings.terminologyPreference,
    });

    await repositories.content.createTranslation({
      userId: payload.userId,
      targetKind: 'THREAD',
      threadId: thread.id,
      topicId: thread.topicId,
      sourceLanguage: thread.language,
      targetLanguage: payload.targetLanguage,
      mode: payload.mode,
      terminologyPreference: settings.terminologyPreference,
      sourceContent: thread.posts.map((post) => post.content).join('\n\n'),
      translatedContent: result.posts.map((post) => post.content).join('\n\n'),
      preservedTerms: result.preservedTerms,
      explanation: result.explanation,
      providerName: result.providerName,
    });

    logger.info({ threadId: thread.id, posts: result.posts.length }, 'thread translated');
    return;
  }

  const post = await repositories.posts.findById(payload.targetId);
  if (post === null) throw new NotFoundError('Post');

  const source = post.title === null ? post.content : `${post.title}\n\n${post.content}`;
  const result = await services.translation.translate({
    text: source,
    sourceLanguage: post.language,
    targetLanguage: payload.targetLanguage,
    mode: payload.mode,
    terminologyPreference: settings.terminologyPreference,
  });

  await repositories.content.createTranslation({
    userId: payload.userId,
    targetKind: 'POST',
    postId: post.id,
    topicId: post.topicId,
    sourceLanguage: post.language,
    targetLanguage: payload.targetLanguage,
    mode: payload.mode,
    terminologyPreference: settings.terminologyPreference,
    sourceContent: source,
    translatedContent: result.translatedText,
    preservedTerms: result.preservedTerms,
    explanation: result.explanation,
    providerName: result.providerName,
  });

  logger.info({ postId: post.id }, 'post translated');
}

/** Content generation requested asynchronously, for long-running drafts. */
export async function processContentGenerationJob(
  context: JobContext<ContentGenerationJobPayload>,
): Promise<void> {
  const { payload, logger, container } = context;
  const { repositories, services } = container;

  const topic = await repositories.topics.findById(payload.topicId);
  if (topic === null) throw new NotFoundError('Topic');

  const excerpts = await repositories.posts.list({
    filters: { topicId: topic.id },
    pagination: { page: 1, pageSize: 5 },
    sortBy: 'trendScore',
    sortDirection: 'desc',
  });
  const interests = await repositories.interests.listForUser(payload.userId);

  const draft = await services.content.generateDraft(payload.draftKind, {
    topicName: topic.name,
    topicSummary: topic.summary,
    sourceExcerpts: excerpts.items.map((post) => post.content.slice(0, 500)),
    interests: interests.filter((interest) => interest.enabled).map((interest) => interest.name),
    arabicOpportunityScore: topic.arabicOpportunityScore,
  });

  await repositories.content.createDraft({
    userId: payload.userId,
    kind: payload.draftKind,
    language: payload.language,
    title: draft.title,
    content: draft.content,
    characterCount: characterCount(draft.content),
    tone: draft.tone,
    providerName: draft.providerName,
    topicId: topic.id,
  });

  logger.info({ topicId: topic.id, kind: payload.draftKind }, 'draft generated');
}

/**
 * Report generation.
 *
 * Reports are computed from aggregate queries rather than from a provider, so
 * they are fast — this job exists for the rare large range, and for the case
 * where a report is requested and the user navigates away.
 */
export async function processReportGenerationJob(
  context: JobContext<ReportGenerationJobPayload>,
): Promise<void> {
  const { payload, logger, container } = context;
  const report = await container.repositories.users.findReport(payload.userId, payload.reportId);
  if (report === null) throw new NotFoundError('Report');
  logger.info({ reportId: report.id, kind: report.kind }, 'report already materialised');
}

/**
 * Housekeeping.
 *
 * The heartbeat is what the readiness probe reads to tell "the worker is
 * running" from "the worker died an hour ago and nothing has been collected
 * since" — a distinction the dashboard has to be able to make, because a silent
 * pipeline looks exactly like a quiet news day.
 */
export async function processMaintenanceJob(
  context: JobContext<MaintenanceJobPayload>,
): Promise<void> {
  const { payload, logger, container } = context;
  const { repositories, env, producerConnection } = container;

  switch (payload.task) {
    case 'heartbeat': {
      await producerConnection.set(
        WORKER_HEARTBEAT_KEY,
        String(Date.now()),
        'EX',
        WORKER_HEARTBEAT_TTL_SECONDS * 3,
      );
      return;
    }
    case 'prune-raw-items': {
      const cutoff = new Date(Date.now() - env.RAW_ITEM_RETENTION_DAYS * 86_400_000);
      const removed = await repositories.ingestion.pruneRawItems(cutoff);
      logger.info({ removed, olderThan: cutoff.toISOString() }, 'pruned raw items');
      return;
    }
    case 'prune-job-runs': {
      const cutoff = new Date(Date.now() - env.JOB_RUN_RETENTION_DAYS * 86_400_000);
      const removed = await repositories.operations.pruneJobRuns(cutoff);
      logger.info({ removed, olderThan: cutoff.toISOString() }, 'pruned job runs');
      return;
    }
    case 'refresh-source-counters': {
      const counts = await repositories.posts.countBySource();
      logger.info({ counts }, 'refreshed source counters');
      return;
    }
  }
}
