import type { SourceKind } from '@trendhunter/types';
import { SOURCE_COLOR } from '@trendhunter/ui';

const SOURCE_LABEL: Record<SourceKind, string> = {
  X: 'X',
  REDDIT: 'Reddit',
  HACKERNEWS: 'Hacker News',
  RSS: 'RSS',
  GITHUB: 'GitHub',
};

/**
 * A source marker.
 *
 * The names are proper nouns and stay in Latin script in both languages —
 * translating "Hacker News" would make it harder to recognise, not easier —
 * so this is one of the few components that carries literal text.
 */
export function SourceBadge({ source }: { readonly source: SourceKind }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: SOURCE_COLOR[source] }}
      />
      <span dir="ltr">{SOURCE_LABEL[source]}</span>
    </span>
  );
}
