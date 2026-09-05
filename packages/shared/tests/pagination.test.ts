import { describe, expect, it } from 'vitest';

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@trendhunter/types';

import { buildPaginationMeta, normalizePaginationParams, toSkipTake } from '../src/pagination';

describe('normalizePaginationParams', () => {
  it('falls back to the documented defaults', () => {
    expect(normalizePaginationParams(undefined)).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
    expect(normalizePaginationParams({})).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  });

  it('caps the page size at the platform maximum', () => {
    expect(normalizePaginationParams({ pageSize: 10_000 }).pageSize).toBe(MAX_PAGE_SIZE);
    expect(normalizePaginationParams({ pageSize: MAX_PAGE_SIZE }).pageSize).toBe(MAX_PAGE_SIZE);
  });

  it('raises a zero or negative page size to one', () => {
    expect(normalizePaginationParams({ pageSize: 0 }).pageSize).toBe(1);
    expect(normalizePaginationParams({ pageSize: -20 }).pageSize).toBe(1);
  });

  it('raises a zero or negative page number to one', () => {
    expect(normalizePaginationParams({ page: 0 }).page).toBe(1);
    expect(normalizePaginationParams({ page: -3 }).page).toBe(1);
  });

  it('floors fractional input rather than passing it to the database', () => {
    expect(normalizePaginationParams({ page: 2.9, pageSize: 10.9 })).toEqual({
      page: 2,
      pageSize: 10,
    });
  });

  it('is idempotent', () => {
    const once = normalizePaginationParams({ page: 0, pageSize: 10_000 });
    expect(normalizePaginationParams(once)).toEqual(once);
  });
});

describe('toSkipTake', () => {
  it('translates the first page to a zero offset', () => {
    expect(toSkipTake({ page: 1, pageSize: 25 })).toEqual({ skip: 0, take: 25 });
  });

  it('translates a later page to the right offset', () => {
    expect(toSkipTake({ page: 3, pageSize: 10 })).toEqual({ skip: 20, take: 10 });
  });
});

describe('buildPaginationMeta', () => {
  it('describes an empty result set without offering a next page', () => {
    expect(buildPaginationMeta({ page: 1, pageSize: 25 }, 0)).toEqual({
      page: 1,
      pageSize: 25,
      totalItems: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
    });
  });

  it('never offers a previous page when there are no pages at all', () => {
    const meta = buildPaginationMeta({ page: 4, pageSize: 25 }, 0);
    expect(meta.hasPreviousPage).toBe(false);
    expect(meta.hasNextPage).toBe(false);
  });

  it('handles a total that is an exact multiple of the page size', () => {
    const meta = buildPaginationMeta({ page: 4, pageSize: 25 }, 100);
    expect(meta.totalPages).toBe(4);
    expect(meta.hasNextPage).toBe(false);
    expect(meta.hasPreviousPage).toBe(true);
  });

  it('adds a partial final page', () => {
    expect(buildPaginationMeta({ page: 1, pageSize: 25 }, 101).totalPages).toBe(5);
    expect(buildPaginationMeta({ page: 1, pageSize: 25 }, 1).totalPages).toBe(1);
  });

  it('offers a next page from every page but the last', () => {
    const total = 100;
    for (let page = 1; page <= 4; page += 1) {
      expect(buildPaginationMeta({ page, pageSize: 25 }, total).hasNextPage).toBe(page < 4);
      expect(buildPaginationMeta({ page, pageSize: 25 }, total).hasPreviousPage).toBe(page > 1);
    }
  });

  it('clamps a negative or fractional total', () => {
    expect(buildPaginationMeta({ page: 1, pageSize: 25 }, -5).totalItems).toBe(0);
    expect(buildPaginationMeta({ page: 1, pageSize: 25 }, 10.9).totalItems).toBe(10);
  });

  it('reports a page beyond the end without claiming there is more', () => {
    const meta = buildPaginationMeta({ page: 99, pageSize: 25 }, 30);
    expect(meta.totalPages).toBe(2);
    expect(meta.hasNextPage).toBe(false);
    expect(meta.hasPreviousPage).toBe(true);
  });
});
