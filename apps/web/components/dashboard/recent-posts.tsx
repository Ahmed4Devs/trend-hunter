import type { Post } from '@trendhunter/types';
import {
  Badge,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from '@trendhunter/ui';
import { InboxIcon } from 'lucide-react';
import Link from 'next/link';
import { getFormatter, getNow, getTranslations } from 'next-intl/server';

import { SavePostButton } from '@/components/posts/save-post-button';

import { SourceBadge } from './source-badge';

/**
 * The latest arrivals.
 *
 * Each row is a link to the post's detail page, with the save control as a
 * sibling rather than a nested button: a button inside a link is invalid and
 * activates both.
 */
export async function RecentPosts({ posts }: { readonly posts: readonly Post[] }) {
  const t = await getTranslations('dashboard.recent');
  const common = await getTranslations('common');
  const format = await getFormatter();
  // Explicit, so the server and the client agree on "now". Without it
  // next-intl falls back to each environment's own clock and the rendered
  // string changes on hydration.
  const now = await getNow();

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="space-y-1">
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
        <CardAction>
          <Link href="/posts" className="text-sm font-medium text-primary hover:underline">
            {common('viewAll')}
          </Link>
        </CardAction>
      </CardHeader>

      <CardContent className="p-0 pb-2">
        {posts.length === 0 ? (
          <EmptyState icon={<InboxIcon className="size-5" />} title={t('empty')} />
        ) : (
          <ul className="divide-y divide-border">
            {posts.map((post) => (
              <li
                key={post.id}
                className="flex gap-3 px-5 py-3 transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <SourceBadge source={post.source} />
                    {post.authorName === null ? null : (
                      <span className="truncate text-xs text-muted-foreground">
                        {post.authorName}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {format.relativeTime(new Date(post.publishedAt), now)}
                    </span>
                    <Badge variant="neutral">{post.language}</Badge>
                  </div>

                  <Link href={`/posts/${post.id}`} className="block">
                    <p className="line-clamp-2 text-sm">{post.title ?? post.content}</p>
                  </Link>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="blue" className="tabular">
                      {t('engagement', {
                        value: format.number(post.metrics.engagementScore, {
                          maximumFractionDigits: 0,
                        }),
                      })}
                    </Badge>
                    <Badge variant="green" className="tabular">
                      {t('relevance', {
                        value: format.number(post.relevanceScore, { maximumFractionDigits: 0 }),
                      })}
                    </Badge>
                  </div>
                </div>

                <SavePostButton postId={post.id} initiallySaved={post.isSaved} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
