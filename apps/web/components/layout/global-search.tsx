'use client';

import type { SearchMode, SearchResponse, SearchResult } from '@trendhunter/types';
import {
  Badge,
  Button,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Spinner,
} from '@trendhunter/ui';
import { SearchIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { browserFetch } from '@/lib/api/browser';

/** Milliseconds of quiet before a query is sent. */
const DEBOUNCE_MS = 250;

/**
 * Global search.
 *
 * Hybrid by default, which is the mode that answers both "the exact phrase I
 * remember" and "the thing I can only describe". Every keystroke would be a
 * paid embedding call, so the query is debounced and each request aborts the
 * one before it — otherwise a slow early response can land after a fast later
 * one and overwrite the results for what the reader is currently typing.
 *
 * cmdk's own filtering is disabled: the server has already ranked these, and a
 * client-side substring filter would hide exactly the semantic matches that
 * make the search worth running.
 */
export function GlobalSearch() {
  const t = useTranslations('search');
  const common = useTranslations('common');
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const term = query.trim();
  const searchable = term.length >= 2;

  useEffect(() => {
    if (!searchable) return;

    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);

      browserFetch<SearchResponse>('/search', {
        query: { q: term, mode: 'hybrid' satisfies SearchMode, pageSize: 8 },
        signal: controller.signal,
      })
        .then((response) => {
          setResults(response.data.results);
          setDegraded(response.data.degradedToKeyword);
        })
        .catch(() => {
          // A failed search shows nothing rather than an error dialog: the
          // reader is mid-keystroke and the next one may well succeed.
          setResults([]);
        })
        .finally(() => {
          setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [term, searchable]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery('');
      router.push(href);
    },
    [router],
  );

  // Derived rather than cleared in the effect: a query shorter than the
  // threshold simply has no results to show, and writing that back into state
  // would be a render reacting to a render.
  const visible = searchable ? results : [];
  const topics = visible.filter((result) => result.entity === 'topic' && result.topic !== null);
  const posts = visible.filter((result) => result.entity === 'post' && result.post !== null);

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
        className="h-9 w-full justify-start gap-2 px-3 font-normal text-muted-foreground md:w-72 lg:w-96"
      >
        <SearchIcon className="size-4 shrink-0" />
        <span className="truncate">{t('placeholder')}</span>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={t('title')}
        description={t('description')}
        closeLabel={common('close')}
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={t('placeholder')}
          aria-label={t('title')}
        />
        <CommandList>
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner label={common('loading')} />
            </div>
          ) : null}

          {!loading && searchable ? <CommandEmpty>{t('empty')}</CommandEmpty> : null}

          {degraded && searchable ? (
            <div className="px-3 py-2">
              <Badge variant="orange">{t('modeKeyword')}</Badge>
            </div>
          ) : null}

          {topics.length === 0 ? null : (
            <CommandGroup heading={t('groupTopics')}>
              {topics.map((result) => (
                <CommandItem
                  key={`topic-${result.id}`}
                  value={`topic-${result.id}`}
                  onSelect={() => {
                    go(`/topics/${result.id}`);
                  }}
                >
                  <span className="truncate">{result.topic?.name ?? ''}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {posts.length === 0 ? null : (
            <CommandGroup heading={t('groupPosts')}>
              {posts.map((result) => (
                <CommandItem
                  key={`post-${result.id}`}
                  value={`post-${result.id}`}
                  onSelect={() => {
                    go(`/posts/${result.id}`);
                  }}
                >
                  <Badge variant="neutral">{result.post?.source ?? ''}</Badge>
                  <span className="truncate">
                    {result.post?.title ?? result.post?.content ?? ''}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
