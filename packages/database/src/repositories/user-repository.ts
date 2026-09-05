import { buildPaginationMeta, normalizePaginationParams, toSkipTake } from '@trendhunter/shared';
import type {
  AuthenticatedUser,
  Paginated,
  PaginationParams,
  Report,
  ReportKind,
  UserSettings,
} from '@trendhunter/types';

import type { PrismaClient } from '../client';
import { type Prisma } from '../client';
import { withDatabaseErrors } from '../errors';
import {
  REPORT_SELECT,
  USER_SETTINGS_SELECT,
  toReport,
  toUserRole,
  toUserSettings,
} from '../mappers';

/**
 * User profile, preferences and generated reports.
 *
 * Credentials are Better Auth's business and are never read here: this
 * repository only ever selects the columns that make up a profile, so there is
 * no query in the codebase capable of returning a password hash.
 */

export function createUserRepository(client: PrismaClient) {
  return {
    async findProfile(userId: string): Promise<AuthenticatedUser | null> {
      return withDatabaseErrors('User', async () => {
        const row = await client.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            role: true,
            emailVerified: true,
            createdAt: true,
          },
        });
        if (row === null) return null;
        return {
          id: row.id,
          email: row.email,
          name: row.name,
          image: row.image,
          role: toUserRole(row.role),
          emailVerified: row.emailVerified,
          createdAt: row.createdAt.toISOString(),
        };
      });
    },

    async updateProfile(
      userId: string,
      data: { name?: string; image?: string | null },
    ): Promise<AuthenticatedUser | null> {
      return withDatabaseErrors('User', async () => {
        const result = await client.user.updateMany({ where: { id: userId }, data });
        if (result.count === 0) return null;
        return this.findProfile(userId);
      });
    },

    /**
     * Settings, created on first read.
     *
     * An upsert rather than a find: a user created by the seed or by an
     * administrator has no settings row, and every screen needs one. Returning
     * defaults without persisting them would mean the first write silently
     * discards whatever the user had not touched.
     */
    async loadSettings(userId: string): Promise<UserSettings> {
      return withDatabaseErrors('UserSettings', async () => {
        const row = await client.userSettings.upsert({
          where: { userId },
          update: {},
          create: { userId },
          select: USER_SETTINGS_SELECT,
        });
        return toUserSettings(row);
      });
    },

    async updateSettings(
      userId: string,
      data: Partial<{
        locale: 'en' | 'ar';
        theme: 'LIGHT' | 'DARK' | 'SYSTEM';
        translationMode: UserSettings['translationMode'];
        terminologyPreference: UserSettings['terminologyPreference'];
        aiClassificationEnabled: boolean;
        emailNotificationsEnabled: boolean;
        emergingTrendAlerts: boolean;
        arabicOpportunityAlerts: boolean;
        defaultAnalyticsRange: string;
      }>,
    ): Promise<UserSettings> {
      return withDatabaseErrors('UserSettings', async () => {
        const row = await client.userSettings.upsert({
          where: { userId },
          update: data,
          create: { userId, ...data },
          select: USER_SETTINGS_SELECT,
        });
        return toUserSettings(row);
      });
    },

    // -----------------------------------------------------------------------
    // Reports
    // -----------------------------------------------------------------------

    async listReports(
      userId: string,
      options: { kind?: ReportKind; pagination?: Partial<PaginationParams> } = {},
    ): Promise<Paginated<Report>> {
      const pagination = normalizePaginationParams(options.pagination);
      const { skip, take } = toSkipTake(pagination);
      const where = {
        userId,
        ...(options.kind === undefined ? {} : { kind: options.kind }),
      };

      return withDatabaseErrors('Report', async () => {
        const [rows, totalItems] = await client.$transaction([
          client.report.findMany({
            where,
            select: REPORT_SELECT,
            orderBy: [{ generatedAt: 'desc' }, { id: 'asc' }],
            skip,
            take,
          }),
          client.report.count({ where }),
        ]);
        return {
          items: rows.map(toReport),
          pagination: buildPaginationMeta(pagination, totalItems),
        };
      });
    },

    async findReport(userId: string, id: string): Promise<Report | null> {
      return withDatabaseErrors('Report', async () => {
        const row = await client.report.findFirst({
          where: { id, userId },
          select: REPORT_SELECT,
        });
        return row === null ? null : toReport(row);
      });
    },

    async createReport(input: {
      userId: string;
      kind: ReportKind;
      title: string;
      rangeFrom: Date;
      rangeTo: Date;
      filters: Prisma.InputJsonValue;
      payload: Prisma.InputJsonValue;
    }): Promise<Report> {
      return withDatabaseErrors('Report', async () => {
        const row = await client.report.create({ data: input, select: REPORT_SELECT });
        return toReport(row);
      });
    },

    async deleteReport(userId: string, id: string): Promise<boolean> {
      return withDatabaseErrors('Report', async () => {
        const result = await client.report.deleteMany({ where: { id, userId } });
        return result.count > 0;
      });
    },
  };
}

export type UserRepository = ReturnType<typeof createUserRepository>;
