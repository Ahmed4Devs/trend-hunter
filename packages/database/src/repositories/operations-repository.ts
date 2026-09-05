import { buildPaginationMeta, normalizePaginationParams, toSkipTake } from '@trendhunter/shared';
import type {
  ApiUsage,
  JobRun,
  JobStatus,
  Paginated,
  PaginationParams,
  ScanRun,
  ScanTrigger,
  SourceKind,
} from '@trendhunter/types';

import type { PrismaClient } from '../client';
import { withDatabaseErrors } from '../errors';
import {
  API_USAGE_SELECT,
  JOB_RUN_SELECT,
  SCAN_RUN_SELECT,
  toApiUsage,
  toJobRun,
  toScanRun,
} from '../mappers';

/**
 * Operational history: scan runs, job runs and external API usage.
 *
 * This is what makes the pipeline explainable after the fact — which scan
 * collected what, which job failed and why, and how much provider quota the
 * deployment has spent. It is also the only place counters are incremented
 * concurrently, so every counter update is an atomic `increment` rather than a
 * read-modify-write.
 */

export function createOperationsRepository(client: PrismaClient) {
  return {
    // -----------------------------------------------------------------------
    // Scan runs
    // -----------------------------------------------------------------------

    async createScanRun(input: {
      userId: string | null;
      trigger: ScanTrigger;
      sourceKinds: readonly SourceKind[];
    }): Promise<ScanRun> {
      return withDatabaseErrors('ScanRun', async () => {
        const row = await client.scanRun.create({
          data: {
            userId: input.userId,
            trigger: input.trigger,
            sourceKinds: [...input.sourceKinds],
            status: 'PENDING',
          },
          select: SCAN_RUN_SELECT,
        });
        return toScanRun(row);
      });
    },

    async markScanRunning(id: string): Promise<void> {
      await withDatabaseErrors('ScanRun', () =>
        client.scanRun.update({
          where: { id },
          data: { status: 'RUNNING' },
          select: { id: true },
        }),
      );
    },

    /**
     * Adds to a scan's counters.
     *
     * Five collectors report into the same scan concurrently, so these are
     * atomic increments: a read-modify-write here would lose counts under
     * exactly the conditions the feature exists to measure.
     */
    async incrementScanCounters(
      id: string,
      counters: Partial<{
        itemsCollected: number;
        itemsStored: number;
        duplicatesSkipped: number;
        postsCreated: number;
        commentsCreated: number;
        topicsCreated: number;
      }>,
    ): Promise<void> {
      const data = Object.fromEntries(
        Object.entries(counters)
          .filter(([, value]) => typeof value === 'number' && value !== 0)
          .map(([key, value]) => [key, { increment: value }]),
      );
      if (Object.keys(data).length === 0) return;

      await withDatabaseErrors('ScanRun', () =>
        client.scanRun.update({ where: { id }, data, select: { id: true } }),
      );
    },

    async finishScanRun(
      id: string,
      outcome: {
        status: Extract<JobStatus, 'COMPLETED' | 'FAILED' | 'CANCELLED'>;
        failureReason?: string | null;
      },
    ): Promise<ScanRun> {
      return withDatabaseErrors('ScanRun', async () => {
        const existing = await client.scanRun.findUniqueOrThrow({
          where: { id },
          select: { startedAt: true },
        });
        const finishedAt = new Date();
        const row = await client.scanRun.update({
          where: { id },
          data: {
            status: outcome.status,
            finishedAt,
            durationMs: finishedAt.getTime() - existing.startedAt.getTime(),
            failureReason: outcome.failureReason ?? null,
          },
          select: SCAN_RUN_SELECT,
        });
        return toScanRun(row);
      });
    },

    async listScanRuns(
      options: { status?: JobStatus; pagination?: Partial<PaginationParams> } = {},
    ): Promise<Paginated<ScanRun>> {
      const pagination = normalizePaginationParams(options.pagination);
      const { skip, take } = toSkipTake(pagination);
      const where = options.status === undefined ? {} : { status: options.status };

      return withDatabaseErrors('ScanRun', async () => {
        const [rows, totalItems] = await client.$transaction([
          client.scanRun.findMany({
            where,
            select: SCAN_RUN_SELECT,
            orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
            skip,
            take,
          }),
          client.scanRun.count({ where }),
        ]);
        return {
          items: rows.map(toScanRun),
          pagination: buildPaginationMeta(pagination, totalItems),
        };
      });
    },

    async findScanRun(id: string): Promise<ScanRun | null> {
      return withDatabaseErrors('ScanRun', async () => {
        const row = await client.scanRun.findUnique({ where: { id }, select: SCAN_RUN_SELECT });
        return row === null ? null : toScanRun(row);
      });
    },

    /** A scan the user started recently, used to rate-limit "Scan Now". */
    async findRecentManualScan(userId: string, since: Date): Promise<ScanRun | null> {
      return withDatabaseErrors('ScanRun', async () => {
        const row = await client.scanRun.findFirst({
          where: {
            userId,
            trigger: 'MANUAL',
            startedAt: { gte: since },
            status: { in: ['PENDING', 'RUNNING'] },
          },
          select: SCAN_RUN_SELECT,
          orderBy: { startedAt: 'desc' },
        });
        return row === null ? null : toScanRun(row);
      });
    },

    // -----------------------------------------------------------------------
    // Job runs
    // -----------------------------------------------------------------------

    /**
     * Records a job attempt.
     *
     * Keyed on `(queue, jobId, attempt)` so a retry produces a new row rather
     * than overwriting the failure that caused it — the history of why a job
     * kept failing is the whole point of the table.
     */
    async startJobRun(input: {
      queue: string;
      jobName: string;
      jobId: string;
      scanRunId: string | null;
      attempt: number;
      maxAttempts: number;
    }): Promise<string> {
      return withDatabaseErrors('JobRun', async () => {
        const row = await client.jobRun.upsert({
          where: {
            queue_jobId_attempt: {
              queue: input.queue,
              jobId: input.jobId,
              attempt: input.attempt,
            },
          },
          update: { status: 'RUNNING', startedAt: new Date() },
          create: {
            queue: input.queue,
            jobName: input.jobName,
            jobId: input.jobId,
            scanRunId: input.scanRunId,
            attempt: input.attempt,
            maxAttempts: input.maxAttempts,
            status: 'RUNNING',
          },
          select: { id: true },
        });
        return row.id;
      });
    },

    async finishJobRun(
      id: string,
      outcome: {
        status: Extract<JobStatus, 'COMPLETED' | 'FAILED' | 'CANCELLED'>;
        durationMs: number;
        failureReason?: string | null;
      },
    ): Promise<void> {
      await withDatabaseErrors('JobRun', () =>
        client.jobRun.update({
          where: { id },
          data: {
            status: outcome.status,
            durationMs: outcome.durationMs,
            failureReason: outcome.failureReason ?? null,
            finishedAt: new Date(),
          },
          select: { id: true },
        }),
      );
    },

    async listJobRuns(
      options: {
        queue?: string;
        status?: JobStatus;
        scanRunId?: string;
        pagination?: Partial<PaginationParams>;
      } = {},
    ): Promise<Paginated<JobRun>> {
      const pagination = normalizePaginationParams(options.pagination);
      const { skip, take } = toSkipTake(pagination);
      const where = {
        ...(options.queue === undefined ? {} : { queue: options.queue }),
        ...(options.status === undefined ? {} : { status: options.status }),
        ...(options.scanRunId === undefined ? {} : { scanRunId: options.scanRunId }),
      };

      return withDatabaseErrors('JobRun', async () => {
        const [rows, totalItems] = await client.$transaction([
          client.jobRun.findMany({
            where,
            select: JOB_RUN_SELECT,
            orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
            skip,
            take,
          }),
          client.jobRun.count({ where }),
        ]);
        return {
          items: rows.map(toJobRun),
          pagination: buildPaginationMeta(pagination, totalItems),
        };
      });
    },

    async countFailedJobsSince(since: Date): Promise<number> {
      return withDatabaseErrors('JobRun', () =>
        client.jobRun.count({ where: { status: 'FAILED', startedAt: { gte: since } } }),
      );
    },

    async pruneJobRuns(olderThan: Date): Promise<number> {
      return withDatabaseErrors('JobRun', async () => {
        const result = await client.jobRun.deleteMany({
          where: { startedAt: { lt: olderThan }, status: { in: ['COMPLETED', 'CANCELLED'] } },
        });
        return result.count;
      });
    },

    // -----------------------------------------------------------------------
    // API usage
    // -----------------------------------------------------------------------

    /**
     * Accumulates provider usage into the hour bucket it belongs to.
     *
     * Aggregating on write keeps the table small enough to query directly for
     * the dashboard widget, instead of scanning a row per request.
     */
    async recordApiUsage(
      entries: readonly {
        provider: string;
        operation: string;
        requestCount: number;
        successCount: number;
        failureCount: number;
        estimatedCost: number;
        recordedAt: Date;
      }[],
    ): Promise<void> {
      if (entries.length === 0) return;

      await withDatabaseErrors('ApiUsage', () =>
        client.$transaction(
          entries.map((entry) => {
            const hour = new Date(entry.recordedAt);
            hour.setUTCMinutes(0, 0, 0);
            return client.apiUsage.upsert({
              where: {
                provider_operation_recordedAt: {
                  provider: entry.provider,
                  operation: entry.operation,
                  recordedAt: hour,
                },
              },
              update: {
                requestCount: { increment: entry.requestCount },
                successCount: { increment: entry.successCount },
                failureCount: { increment: entry.failureCount },
                estimatedCost: { increment: entry.estimatedCost },
              },
              create: {
                provider: entry.provider,
                operation: entry.operation,
                recordedAt: hour,
                requestCount: entry.requestCount,
                successCount: entry.successCount,
                failureCount: entry.failureCount,
                estimatedCost: entry.estimatedCost,
              },
            });
          }),
        ),
      );
    },

    async listApiUsage(since: Date): Promise<ApiUsage[]> {
      return withDatabaseErrors('ApiUsage', async () => {
        const rows = await client.apiUsage.findMany({
          where: { recordedAt: { gte: since } },
          select: API_USAGE_SELECT,
          orderBy: { recordedAt: 'desc' },
          take: 1000,
        });
        return rows.map(toApiUsage);
      });
    },

    /** Usage totalled per provider and operation over a window. */
    async summariseApiUsage(since: Date): Promise<
      {
        provider: string;
        operation: string;
        requestCount: number;
        successCount: number;
        failureCount: number;
        estimatedCost: number;
      }[]
    > {
      return withDatabaseErrors('ApiUsage', async () => {
        const grouped = await client.apiUsage.groupBy({
          by: ['provider', 'operation'],
          where: { recordedAt: { gte: since } },
          _sum: {
            requestCount: true,
            successCount: true,
            failureCount: true,
            estimatedCost: true,
          },
        });
        return grouped.map((entry) => ({
          provider: entry.provider,
          operation: entry.operation,
          requestCount: entry._sum.requestCount ?? 0,
          successCount: entry._sum.successCount ?? 0,
          failureCount: entry._sum.failureCount ?? 0,
          estimatedCost: entry._sum.estimatedCost ?? 0,
        }));
      });
    },
  };
}

export type OperationsRepository = ReturnType<typeof createOperationsRepository>;
