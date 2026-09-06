import {
  ANALYTICS_RANGES,
  CONTENT_DRAFT_KINDS,
  CONTENT_DRAFT_STATUSES,
  CONTENT_LANGUAGES,
  CONTENT_TONES,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE,
  MAX_PAGE_SIZE,
  REPORT_KINDS,
  SAVED_ITEM_KINDS,
  SEARCH_ENTITY_KINDS,
  SEARCH_MODES,
  SOURCE_KINDS,
  TERMINOLOGY_PREFERENCES,
  THEME_PREFERENCES,
  TOPIC_CLASSIFICATIONS,
  TOPIC_STATUSES,
  TRANSLATION_MODES,
  UI_LOCALES,
} from '@trendhunter/types';
import { MAX_SEARCH_QUERY_LENGTH } from '@trendhunter/shared';
import { z } from 'zod';

/**
 * Validation primitives shared by every request schema.
 *
 * These are the building blocks the route schemas compose. Keeping them here
 * means a rule such as "a page size is never above 100" is stated once and
 * enforced identically on every endpoint — including the ones added later.
 */

/** Identifiers are CUIDs produced by Prisma's `@default(cuid())`. */
export const idSchema = z
  .string()
  .trim()
  .min(1, 'is required')
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/u, 'is not a valid identifier');

export const idListSchema = z.array(idSchema).min(1).max(200);

/** Query-string values arrive as strings, so every numeric input is coerced. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(MAX_PAGE).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export const sortDirectionSchema = z.enum(['asc', 'desc']).default('desc');

export const isoDateTimeSchema = z.iso.datetime({ offset: true });

/**
 * A date range. Validated as a pair so that an inverted or absurd range is
 * rejected at the boundary rather than producing an empty report.
 */
export const dateRangeSchema = z
  .object({
    from: isoDateTimeSchema,
    to: isoDateTimeSchema,
  })
  .refine((range) => new Date(range.from) < new Date(range.to), {
    message: 'from must be earlier than to',
    path: ['from'],
  })
  .refine(
    (range) =>
      new Date(range.to).getTime() - new Date(range.from).getTime() <= 366 * 24 * 60 * 60 * 1000,
    { message: 'range must not exceed one year', path: ['to'] },
  );

/** 0..1 weights used by interests and keywords. */
export const weightSchema = z.coerce.number().min(0).max(1);

/** 0..100 scores used by every filter that bounds a score. */
export const scoreSchema = z.coerce.number().min(0).max(100);

export const sourceKindSchema = z.enum(SOURCE_KINDS);
export const contentLanguageSchema = z.enum(CONTENT_LANGUAGES);
export const uiLocaleSchema = z.enum(UI_LOCALES);
export const themePreferenceSchema = z.enum(THEME_PREFERENCES);
export const topicStatusSchema = z.enum(TOPIC_STATUSES);
export const topicClassificationSchema = z.enum(TOPIC_CLASSIFICATIONS);
export const translationModeSchema = z.enum(TRANSLATION_MODES);
export const terminologyPreferenceSchema = z.enum(TERMINOLOGY_PREFERENCES);
export const contentDraftKindSchema = z.enum(CONTENT_DRAFT_KINDS);
export const contentDraftStatusSchema = z.enum(CONTENT_DRAFT_STATUSES);
export const contentToneSchema = z.enum(CONTENT_TONES);
export const savedItemKindSchema = z.enum(SAVED_ITEM_KINDS);
export const reportKindSchema = z.enum(REPORT_KINDS);
export const searchModeSchema = z.enum(SEARCH_MODES);
export const searchEntityKindSchema = z.enum(SEARCH_ENTITY_KINDS);
export const analyticsRangeSchema = z.enum(ANALYTICS_RANGES);

/**
 * A comma-separated query parameter such as `?sources=X,REDDIT`.
 *
 * Accepts either repeated parameters or one comma-joined value, because both
 * forms reach the server depending on how the client builds the URL.
 */
export function csvEnumQuerySchema<const T extends readonly [string, ...string[]]>(values: T) {
  const member = z.enum(values);
  return z
    .union([z.string(), z.array(z.string())])
    .transform((value) => (Array.isArray(value) ? value : value.split(',')))
    .transform((entries) => entries.map((entry) => entry.trim()).filter((entry) => entry !== ''))
    .pipe(z.array(member).max(values.length));
}

/**
 * Control characters, in two flavours.
 *
 * Declared here rather than inline because the `eslint-disable` each one needs
 * has to sit on the line directly above the pattern - and a formatter is free
 * to move an expression onto a different line than the comment meant to cover
 * it, which turns the directive into an unused-directive error and leaves the
 * rule unsuppressed. A named constant cannot drift away from its comment.
 *
 * `CONTROL_CHARS` is all of them: a search query has no use for any.
 * `CONTROL_CHARS_KEEPING_WHITESPACE` spares tab, newline and carriage
 * return, because stored free text legitimately contains line breaks.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/gu;

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS_KEEPING_WHITESPACE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu;

/**
 * Free-text search input.
 *
 * Bounded in length, stripped of control characters, and non-empty after
 * trimming. The query itself is always passed to PostgreSQL as a bound
 * parameter through `websearch_to_tsquery`, which never raises a syntax error,
 * so no escaping is needed here — only sanity limits.
 */
export const searchQuerySchema = z
  .string()
  .trim()
  .min(1, 'must not be empty')
  .max(MAX_SEARCH_QUERY_LENGTH)
  .transform((value) => value.replace(CONTROL_CHARS, ' ').replace(/\s+/gu, ' ').trim())
  .refine((value) => value.length > 0, 'must not be empty');

/** Free-text a user types and we store: bounded, trimmed, control-free. */
export function boundedTextSchema(maxLength: number, options?: { allowEmpty?: boolean }) {
  const base = z
    .string()
    .max(maxLength, `must be at most ${maxLength} characters`)
    .transform((value) => value.replace(CONTROL_CHARS_KEEPING_WHITESPACE, ''))
    .transform((value) => value.trim());
  return options?.allowEmpty === true ? base : base.pipe(z.string().min(1, 'must not be empty'));
}

/**
 * A URL supplied by a user and stored (for example the X permalink of a manual
 * publication). Only https is accepted: a stored http link would be rendered as
 * a clickable link in the UI.
 */
export const publicHttpsUrlSchema = z
  .url('must be an absolute URL')
  .max(2048)
  .refine((value) => value.startsWith('https://'), 'must use https');
