import type { Source, SourceConfigEntry, SourceKind } from '@trendhunter/types';

import type { PrismaClient } from '../client';
import { type Prisma } from '../client';
import { withDatabaseErrors } from '../errors';
import { SOURCE_SELECT, toSource } from '../mappers';

/**
 * Source configuration.
 *
 * Sources are operator-level configuration rather than user data: there is one
 * row per provider, shared by the whole deployment, and only an administrator
 * may change it. The per-provider settings live in `source_configs` as JSON
 * because their shape genuinely differs per provider — but that JSON is
 * validated by a discriminated union in `@trendhunter/validation` before it is
 * written, so a connector never receives an unchecked object.
 */

export function createSourceRepository(client: PrismaClient) {
  return {
    async list(): Promise<Source[]> {
      return withDatabaseErrors('Source', async () => {
        const [rows, counts] = await Promise.all([
          client.source.findMany({ select: SOURCE_SELECT, orderBy: { name: 'asc' } }),
          client.post.groupBy({ by: ['source'], _count: { _all: true } }),
        ]);
        const countByKind = new Map(counts.map((entry) => [entry.source, entry._count._all]));
        return rows.map((row) => toSource(row, countByKind.get(row.kind) ?? 0));
      });
    },

    async findById(id: string): Promise<Source | null> {
      return withDatabaseErrors('Source', async () => {
        const row = await client.source.findUnique({ where: { id }, select: SOURCE_SELECT });
        return row === null ? null : toSource(row);
      });
    },

    async findByKind(kind: SourceKind): Promise<Source | null> {
      return withDatabaseErrors('Source', async () => {
        const row = await client.source.findFirst({ where: { kind }, select: SOURCE_SELECT });
        return row === null ? null : toSource(row);
      });
    },

    async listEnabled(): Promise<Source[]> {
      return withDatabaseErrors('Source', async () => {
        const rows = await client.source.findMany({
          where: { enabled: true },
          select: SOURCE_SELECT,
          orderBy: { name: 'asc' },
        });
        return rows.map((row) => toSource(row));
      });
    },

    /**
     * Enabled sources whose scan interval has elapsed.
     *
     * The interval is enforced here rather than in the scheduler so that a
     * manual "Scan Now" and the repeatable job cannot together collect the same
     * source twice a minute and burn a rate limit.
     */
    async listDueForScan(now: Date): Promise<Source[]> {
      return withDatabaseErrors('Source', async () => {
        const rows = await client.$queryRaw<
          {
            id: string;
            kind: SourceKind;
            name: string;
            slug: string;
            enabled: boolean;
            authority_weight: number;
            scan_interval_minutes: number;
            last_scanned_at: Date | null;
            created_at: Date;
            updated_at: Date;
          }[]
        >`
          SELECT "id", "kind", "name", "slug", "enabled", "authority_weight",
                 "scan_interval_minutes", "last_scanned_at", "created_at", "updated_at"
          FROM "sources"
          WHERE "enabled" = true
            AND (
              "last_scanned_at" IS NULL
              OR "last_scanned_at" <= ${now} - ("scan_interval_minutes" * INTERVAL '1 minute')
            )
          ORDER BY "last_scanned_at" ASC NULLS FIRST
        `;
        return rows.map((row) =>
          toSource({
            id: row.id,
            kind: row.kind,
            name: row.name,
            slug: row.slug,
            enabled: row.enabled,
            authorityWeight: row.authority_weight,
            scanIntervalMinutes: row.scan_interval_minutes,
            lastScannedAt: row.last_scanned_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }),
        );
      });
    },

    async update(
      id: string,
      data: { enabled?: boolean; authorityWeight?: number; scanIntervalMinutes?: number },
    ): Promise<Source> {
      return withDatabaseErrors('Source', async () => {
        const row = await client.source.update({ where: { id }, data, select: SOURCE_SELECT });
        return toSource(row);
      });
    },

    async markScanned(id: string, scannedAt: Date): Promise<void> {
      await withDatabaseErrors('Source', () =>
        client.source.update({
          where: { id },
          data: { lastScannedAt: scannedAt },
          select: { id: true },
        }),
      );
    },

    async listConfigs(sourceId: string): Promise<SourceConfigEntry[]> {
      return withDatabaseErrors('SourceConfig', async () => {
        const rows = await client.sourceConfig.findMany({
          where: { sourceId },
          orderBy: { key: 'asc' },
        });
        return rows.map((row) => ({
          id: row.id,
          sourceId: row.sourceId,
          key: row.key,
          value: row.value,
          updatedAt: row.updatedAt.toISOString(),
        }));
      });
    },

    /** Merges the stored config rows into one object for a connector. */
    async loadConfig(sourceId: string): Promise<Record<string, unknown>> {
      return withDatabaseErrors('SourceConfig', async () => {
        const rows = await client.sourceConfig.findMany({
          where: { sourceId },
          select: { key: true, value: true },
        });
        const config: Record<string, unknown> = {};
        for (const row of rows) config[row.key] = row.value;
        return config;
      });
    },

    async setConfig(
      sourceId: string,
      key: string,
      value: Prisma.InputJsonValue,
    ): Promise<SourceConfigEntry> {
      return withDatabaseErrors('SourceConfig', async () => {
        const row = await client.sourceConfig.upsert({
          where: { sourceId_key: { sourceId, key } },
          update: { value },
          create: { sourceId, key, value },
        });
        return {
          id: row.id,
          sourceId: row.sourceId,
          key: row.key,
          value: row.value,
          updatedAt: row.updatedAt.toISOString(),
        };
      });
    },

    /** Replaces the entire configuration of a source atomically. */
    async replaceConfig(
      sourceId: string,
      entries: Readonly<Record<string, Prisma.InputJsonValue>>,
    ): Promise<void> {
      await withDatabaseErrors('SourceConfig', () =>
        client.$transaction(async (tx) => {
          await tx.sourceConfig.deleteMany({
            where: { sourceId, key: { notIn: Object.keys(entries) } },
          });
          for (const [key, value] of Object.entries(entries)) {
            await tx.sourceConfig.upsert({
              where: { sourceId_key: { sourceId, key } },
              update: { value },
              create: { sourceId, key, value },
            });
          }
        }),
      );
    },

    /** Authority weight per source kind, used by the relevance engine. */
    async loadAuthorityWeights(): Promise<Map<SourceKind, number>> {
      return withDatabaseErrors('Source', async () => {
        const rows = await client.source.findMany({
          select: { kind: true, authorityWeight: true },
        });
        return new Map(rows.map((row) => [row.kind, row.authorityWeight]));
      });
    },
  };
}

export type SourceRepository = ReturnType<typeof createSourceRepository>;
