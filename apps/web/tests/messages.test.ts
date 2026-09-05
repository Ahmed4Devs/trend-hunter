import { describe, expect, it } from 'vitest';

import ar from '../messages/ar.json';
import en from '../messages/en.json';

/**
 * The two catalogues must describe the same interface.
 *
 * A missing Arabic key does not fail a build or a type check — next-intl falls
 * back to the key path and the page renders `dashboard.kpi.newTopics` where a
 * label should be. This is the check that turns that into a failing test
 * instead of something a reader finds.
 */
function flatten(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    flatten(child, prefix === '' ? key : `${prefix}.${key}`),
  );
}

/**
 * The arguments a message expects, e.g. `{count}` and `{name}`.
 *
 * The identifier has to be followed by `,` or `}` to count. Without that
 * lookahead the branch bodies of an ICU plural — `=0 {no posts}` — parse as
 * arguments named "no", and every pluralised message reports a mismatch.
 */
function placeholdersOf(message: string): string[] {
  return [...message.matchAll(/\{\s*([A-Za-z0-9_]+)\s*(?=[,}])/g)]
    .map((match) => match[1] ?? '')
    .sort();
}

function messageAt(catalogue: unknown, path: string): string | undefined {
  const value = path.split('.').reduce<unknown>((node, key) => {
    if (typeof node !== 'object' || node === null) return undefined;
    return (node as Record<string, unknown>)[key];
  }, catalogue);
  return typeof value === 'string' ? value : undefined;
}

describe('message catalogues', () => {
  const english = flatten(en).sort();
  const arabic = flatten(ar).sort();

  it('define exactly the same keys', () => {
    expect(arabic).toStrictEqual(english);
  });

  it('use the same placeholders in both languages', () => {
    for (const key of english) {
      const source = messageAt(en, key);
      const target = messageAt(ar, key);
      if (source === undefined || target === undefined) continue;
      expect(placeholdersOf(target), key).toStrictEqual(placeholdersOf(source));
    }
  });

  it('never leave an Arabic message identical to its English source', () => {
    // Proper nouns and language names are legitimately identical; everything
    // else being identical means it was copied and not translated.
    const allowed = new Set(['locale.en', 'locale.ar', 'auth.emailPlaceholder']);
    const untranslated = english.filter(
      (key) => !allowed.has(key) && messageAt(en, key) === messageAt(ar, key),
    );
    expect(untranslated).toStrictEqual([]);
  });
});
