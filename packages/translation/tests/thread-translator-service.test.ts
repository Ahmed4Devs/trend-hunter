import {
  THREAD_COUNTER_RESERVED_CHARACTERS,
  ValidationError,
  X_POST_CHARACTER_LIMIT,
  characterCount,
} from '@trendhunter/shared';
import { describe, expect, it } from 'vitest';

import {
  ThreadTranslatorService,
  enforceBudget,
  fallbackContextSummary,
  partitionSentences,
  splitAtWordBoundaries,
} from '../src/thread-translator-service';
import { SameLanguageError, TranslationService } from '../src/translation-service';
import { FakeLlmProvider } from './fake-provider';

const POST_BUDGET = X_POST_CHARACTER_LIMIT - THREAD_COUNTER_RESERVED_CHARACTERS;

/** A seven post thread: a hook, five body posts, a conclusion. */
const THREAD: readonly string[] = [
  'Alpha is the hook that stops the scroll. Read this to the end.',
  'The team released a new model this week. It is faster in production.',
  'Charlie measured the benchmark on real data. The numbers are with the model.',
  'Delta shows that agents can run on it. Developers can build with the API.',
  'Echo is the part that is slower. It returns a token for every request.',
  'Foxtrot and Golf are the caveats. Read the benchmark for the data.',
  'Omega is the conclusion of this thread, so build with it this week.',
];

function makeTranslator(provider: FakeLlmProvider): ThreadTranslatorService {
  return new ThreadTranslatorService({
    provider,
    translationService: new TranslationService(provider),
  });
}

describe('ThreadTranslatorService.translateThread', () => {
  it('returns the whole thread in order, hook first and conclusion last', async () => {
    const provider = new FakeLlmProvider();
    const result = await makeTranslator(provider).translateThread({
      posts: THREAD,
      targetLanguage: 'AR',
    });

    expect(result.posts).toHaveLength(THREAD.length);
    expect(result.postCountChanged).toBe(false);
    expect(result.posts.map((post) => post.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    const first = result.posts[0];
    const last = result.posts.at(-1);
    // `alpha` and `omega` are the hook and the conclusion of the source thread.
    expect(first?.content).toContain('ألفا');
    expect(last?.content).toContain('أوميغا');
    expect(first?.content).not.toContain('أوميغا');
  });

  it('translates the thread once, as a single narrative', async () => {
    const provider = new FakeLlmProvider();
    await makeTranslator(provider).translateThread({ posts: THREAD, targetLanguage: 'AR' });

    expect(provider.translateRequests).toHaveLength(1);
    expect(provider.summarizeRequests).toHaveLength(1);
    const sent = provider.translateRequests[0];
    expect(sent?.contextSummary).toContain('Surrounding narrative');
  });

  it('keeps every post inside the X budget, with room for the counter', async () => {
    const provider = new FakeLlmProvider();
    const result = await makeTranslator(provider).translateThread({
      posts: THREAD,
      targetLanguage: 'AR',
    });

    expect(result.postCharacterBudget).toBe(POST_BUDGET);
    for (const post of result.posts) {
      expect(post.characterCount).toBeLessThanOrEqual(POST_BUDGET);
      expect(post.characterCount).toBe(characterCount(post.content));
    }
  });

  it('never splits a word, even at a punishing character limit', async () => {
    const provider = new FakeLlmProvider();
    const translationService = new TranslationService(provider);
    const translator = new ThreadTranslatorService({ provider, translationService });

    const result = await translator.translateThread({
      posts: THREAD,
      targetLanguage: 'AR',
      characterLimit: 40,
    });
    const direct = await translationService.translate({
      text: THREAD.join('\n\n'),
      targetLanguage: 'AR',
    });

    const producedWords = result.posts
      .map((post) => post.content)
      .join(' ')
      .split(/\s+/u)
      .filter((word) => word.length > 0);
    const expectedWords = direct.translatedText.split(/\s+/u).filter((word) => word.length > 0);

    expect(producedWords).toEqual(expectedWords);
    for (const post of result.posts) {
      expect(post.characterCount).toBeLessThanOrEqual(40 - THREAD_COUNTER_RESERVED_CHARACTERS);
    }
  });

  it('explains itself when the post count has to change', async () => {
    const provider = new FakeLlmProvider();
    const result = await makeTranslator(provider).translateThread({
      posts: THREAD,
      targetLanguage: 'AR',
      characterLimit: 40,
    });

    expect(result.postCountChanged).toBe(true);
    expect(result.posts.length).toBeGreaterThan(THREAD.length);
    expect(result.explanation).toContain('posts');
    expect(result.requestedPostCount).toBe(THREAD.length);
  });

  it('falls back to a deterministic context when the provider cannot summarise', async () => {
    const provider = new FakeLlmProvider({ summarizeThrows: true });
    const result = await makeTranslator(provider).translateThread({
      posts: THREAD,
      targetLanguage: 'AR',
      title: 'Agents in production',
    });

    expect(result.contextSummary).toContain('Thread title: Agents in production.');
    expect(result.contextSummary).toContain('A thread of 7 posts.');
    expect(result.posts.length).toBeGreaterThan(0);
  });

  it('ignores a summary payload that is not a string', async () => {
    const provider = new FakeLlmProvider({ summarizeOverride: () => ({ nope: true }) });
    const result = await makeTranslator(provider).translateThread({
      posts: THREAD,
      targetLanguage: 'AR',
    });

    expect(result.contextSummary).toContain('A thread of 7 posts.');
  });

  it('refuses a thread that is already in the target language', async () => {
    const provider = new FakeLlmProvider();
    await expect(
      makeTranslator(provider).translateThread({
        posts: ['هذا الخيط مكتوب بالعربية بالفعل.', 'ولا يحتاج إلى أي ترجمة إضافية.'],
        targetLanguage: 'AR',
      }),
    ).rejects.toBeInstanceOf(SameLanguageError);
    expect(provider.summarizeRequests).toHaveLength(0);
  });

  it('refuses an empty thread, an over-long one and an impossible limit', async () => {
    const translator = makeTranslator(new FakeLlmProvider());

    await expect(
      translator.translateThread({ posts: ['  ', ''], targetLanguage: 'AR' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      translator.translateThread({
        posts: Array.from({ length: 30 }, (_unused, index) => `Post number ${String(index)}.`),
        targetLanguage: 'AR',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      translator.translateThread({
        posts: THREAD,
        targetLanguage: 'AR',
        characterLimit: THREAD_COUNTER_RESERVED_CHARACTERS,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('translates a single post thread', async () => {
    const provider = new FakeLlmProvider();
    const result = await makeTranslator(provider).translateThread({
      posts: ['Alpha is the only post in this thread.'],
      targetLanguage: 'AR',
    });

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]?.content).toContain('ألفا');
  });
});

describe('partitionSentences', () => {
  const sentences = ['واحد.', 'اثنان.', 'ثلاثة.', 'أربعة.', 'خمسة.', 'ستة.'];

  it('splits into contiguous groups that preserve the order', () => {
    const groups = partitionSentences(sentences, 3, POST_BUDGET);
    expect(groups).toHaveLength(3);
    expect(groups.flat()).toEqual(sentences);
    expect(groups[0]?.[0]).toBe('واحد.');
    expect(groups.at(-1)?.at(-1)).toBe('ستة.');
  });

  it('never returns an empty group', () => {
    const groups = partitionSentences(sentences, 6, POST_BUDGET);
    expect(groups).toHaveLength(6);
    for (const group of groups) expect(group.length).toBeGreaterThan(0);
  });

  it('returns fewer groups than asked for rather than splitting a sentence', () => {
    const groups = partitionSentences(['جملة واحدة فقط.'], 5, POST_BUDGET);
    expect(groups).toEqual([['جملة واحدة فقط.']]);
  });

  it('opens extra groups when the budget cannot hold the requested number', () => {
    const groups = partitionSentences(sentences, 2, 12);
    expect(groups.length).toBeGreaterThan(2);
    expect(groups.flat()).toEqual(sentences);
  });

  it('handles no sentences at all', () => {
    expect(partitionSentences([], 3, POST_BUDGET)).toEqual([]);
  });
});

describe('enforceBudget', () => {
  it('keeps a group that fits as one post', () => {
    expect(enforceBudget(['واحد.', 'اثنان.'], 100)).toEqual(['واحد. اثنان.']);
  });

  it('cuts at a sentence boundary before a word boundary', () => {
    const posts = enforceBudget(['واحد اثنان.', 'ثلاثة أربعة.'], 12);
    expect(posts).toEqual(['واحد اثنان.', 'ثلاثة أربعة.']);
  });

  it('falls back to word boundaries for an over-long sentence', () => {
    const posts = enforceBudget(['واحد اثنان ثلاثة أربعة خمسة ستة.'], 14);
    expect(posts.length).toBeGreaterThan(1);
    for (const post of posts) expect(characterCount(post)).toBeLessThanOrEqual(14);
  });
});

describe('splitAtWordBoundaries', () => {
  it('packs whole words up to the budget', () => {
    const words = 'واحد اثنان ثلاثة أربعة خمسة'.split(' ');
    const chunks = splitAtWordBoundaries(words.join(' '), 12);

    for (const chunk of chunks) {
      expect(characterCount(chunk)).toBeLessThanOrEqual(12);
      for (const word of chunk.split(' ')) expect(words).toContain(word);
    }
    expect(chunks.join(' ')).toBe(words.join(' '));
  });

  it('cuts a single token that cannot fit on its own', () => {
    const chunks = splitAtWordBoundaries('a'.repeat(25), 10);
    expect(chunks).toEqual(['a'.repeat(10), 'a'.repeat(10), 'a'.repeat(5)]);
  });

  it('returns nothing for blank input', () => {
    expect(splitAtWordBoundaries('   ', 10)).toEqual([]);
  });
});

describe('fallbackContextSummary', () => {
  it('names the opening, the closing and the length', () => {
    const summary = fallbackContextSummary(['First one. Second one.', 'Last one.']);
    expect(summary).toContain('A thread of 2 posts.');
    expect(summary).toContain('It opens with: First one.');
    expect(summary).toContain('It closes with: Last one.');
  });

  it('omits the closing line for a single post', () => {
    expect(fallbackContextSummary(['Only one.'])).not.toContain('It closes with');
  });
});
