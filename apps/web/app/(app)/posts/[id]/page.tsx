import type { PostDetail } from '@trendhunter/types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Separator,
} from '@trendhunter/ui';
import { ExternalLinkIcon, MessageSquareIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getNow, getTranslations } from 'next-intl/server';

import { SourceBadge } from '@/components/dashboard/source-badge';
import { PostActions } from '@/components/posts/post-actions';
import { SavePostButton } from '@/components/posts/save-post-button';
import { ScoreMeter } from '@/components/posts/score-meter';
import { ApiError } from '@/lib/api/errors';
import { apiData } from '@/lib/api/server';

async function loadPost(id: string): Promise<PostDetail> {
  try {
    return await apiData<PostDetail>(`/posts/${id}`);
  } catch (error) {
    // A missing post is a 404 page, not an error page: the id came from a URL
    // and may simply be stale.
    if (error instanceof ApiError && error.isNotFound) notFound();
    throw error;
  }
}

export async function generateMetadata(props: {
  readonly params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await props.params;
  const post = await loadPost(id);
  return { title: post.title ?? post.content.slice(0, 60) };
}

export default async function PostDetailPage(props: { readonly params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const post = await loadPost(id);

  const t = await getTranslations('posts.detail');
  const format = await getFormatter();
  // Explicit, so the server and the client agree on "now". Without it
  // next-intl falls back to each environment's own clock and the rendered
  // string changes on hydration.
  const now = await getNow();

  const metrics = [
    { labelKey: 'likes', value: post.metrics.likes },
    { labelKey: 'replies', value: post.metrics.replies },
    { labelKey: 'reposts', value: post.metrics.reposts },
    { labelKey: 'views', value: post.metrics.views },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <SourceBadge source={post.source} />
        {post.authorName === null ? null : (
          <span className="text-sm text-muted-foreground">{post.authorName}</span>
        )}
        <span className="text-sm text-muted-foreground">
          {format.dateTime(new Date(post.publishedAt), { dateStyle: 'medium', timeStyle: 'short' })}
        </span>
        <Badge variant="neutral">{post.language}</Badge>
        {post.topicId === null ? null : (
          <Link href={`/topics/${post.topicId}`}>
            <Badge variant="blue">{post.topicName}</Badge>
          </Link>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-4 p-6">
              {post.title === null ? null : (
                <h1 className="text-xl font-semibold tracking-tight">{post.title}</h1>
              )}
              {/* Collected text, rendered as text. Never as markup: every word
                  here came from a third-party feed. */}
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{post.content}</p>

              <div className="flex flex-wrap items-center gap-2">
                <Button asChild variant="outline" size="sm">
                  {/* `noreferrer` as well as `noopener`: the destination is an
                      arbitrary third-party URL and should not learn where the
                      reader came from. */}
                  <a href={post.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLinkIcon className="size-4" />
                    {t('openOriginal')}
                  </a>
                </Button>
                <PostActions postId={post.id} isRead={post.isRead} isHidden={post.isHidden} />
                <SavePostButton postId={post.id} initiallySaved={post.isSaved} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('comments')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0 pb-2">
              {post.comments.length === 0 ? (
                <EmptyState
                  icon={<MessageSquareIcon className="size-5" />}
                  title={t('noComments')}
                />
              ) : (
                <ul className="divide-y divide-border">
                  {post.comments.map((comment) => (
                    <li key={comment.id} className="space-y-1.5 px-5 py-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-medium">{comment.author ?? '—'}</span>
                        <span className="text-muted-foreground">
                          {format.relativeTime(new Date(comment.publishedAt), now)}
                        </span>
                        <Badge variant="neutral">{comment.language}</Badge>
                        <span className="tabular text-muted-foreground">
                          {format.number(comment.likes)}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{comment.content}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('translations')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {post.translations.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noTranslations')}</p>
              ) : (
                post.translations.map((translation) => (
                  <div key={translation.id} className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="purple">{translation.mode}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {translation.providerName}
                      </span>
                    </div>
                    {/* The translated text is Arabic regardless of the
                        interface language, so it carries its own direction. */}
                    <p dir="rtl" lang="ar" className="text-sm leading-loose whitespace-pre-wrap">
                      {translation.translatedContent}
                    </p>
                    {translation.preservedTerms.length === 0 ? null : (
                      <div className="flex flex-wrap gap-1.5">
                        {translation.preservedTerms.map((term) => (
                          <Badge key={term} variant="neutral" dir="ltr">
                            {term}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('metrics')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-2 gap-3">
                {metrics.map((metric) => (
                  <div key={metric.labelKey}>
                    <dt className="text-xs text-muted-foreground">{t(metric.labelKey)}</dt>
                    <dd className="tabular text-sm font-medium">{format.number(metric.value)}</dd>
                  </div>
                ))}
              </dl>

              <Separator />

              <ScoreMeter label={t('relevance')} value={post.relevanceScore} />
              <ScoreMeter label={t('trend')} value={post.trendScore} tone="blue" />
              <ScoreMeter label={t('opportunity')} value={post.opportunityScore} tone="purple" />

              {post.relevanceBreakdown === null ||
              post.relevanceBreakdown.matchedKeywords.length === 0 ? null : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{t('breakdown')}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {post.relevanceBreakdown.matchedKeywords.map((keyword) => (
                      <Badge key={keyword} variant="green">
                        {keyword}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                {t('collected', { time: format.relativeTime(new Date(post.collectedAt), now) })}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('related')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0 pb-2">
              {post.relatedPosts.length === 0 ? (
                <p className="px-5 pb-3 text-sm text-muted-foreground">{t('noRelated')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {post.relatedPosts.map((related) => (
                    <li key={related.id}>
                      <Link
                        href={`/posts/${related.id}`}
                        className="block space-y-1 px-5 py-3 transition-colors hover:bg-muted/50"
                      >
                        <SourceBadge source={related.source} />
                        <span className="line-clamp-2 block text-sm">
                          {related.title ?? related.content}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
