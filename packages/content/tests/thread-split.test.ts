import { THREAD_COUNTER_RESERVED_CHARACTERS, characterCount } from '@trendhunter/shared';
import { describe, expect, it } from 'vitest';

import { THREAD_POST_CHARACTER_BUDGET } from '../src/prompts';
import { splitIntoThreadPosts } from '../src/thread-service';

const ENGLISH_LONG = [
  'Three teams ran coding agents against their own repositories for a full sprint.',
  'Two of them cut review time by roughly a third, mostly on small refactors.',
  'The third reverted everything after a dependency upgrade rewrote a migration nobody had read.',
  'The failure mode is not bad code, it is confidently wrong changes to things the agent cannot test.',
  'Latency per task dropped from nine minutes to forty seconds once the repository index was cached.',
  'None of the teams let an agent merge without a human reviewer, and none of them plan to.',
].join(' ');

const ARABIC_LONG = [
  'شغّلت ثلاثة فرق وكلاء برمجة على مستودعاتها لمدة أسبوعين كاملين.',
  'خفّض فريقان زمن المراجعة بنحو الثلث في التعديلات الصغيرة فقط.',
  'أما الفريق الثالث فتراجع عن كل شيء بعد أن أعاد تحديث الاعتماديات كتابة ترحيل لم يقرأه أحد.',
  'المشكلة ليست في الشيفرة السيئة، بل في تغييرات واثقة وخاطئة لأشياء لا يستطيع الوكيل اختبارها.',
  'انخفض زمن المهمة من تسع دقائق إلى أربعين ثانية بعد تخزين فهرس المستودع.',
].join(' ');

function words(value: string): string[] {
  return value.split(/\s+/u).filter((word) => word.length > 0);
}

describe('splitIntoThreadPosts', () => {
  it('returns nothing for empty or whitespace-only text', () => {
    expect(splitIntoThreadPosts('')).toStrictEqual([]);
    expect(splitIntoThreadPosts('   \n\n  ')).toStrictEqual([]);
  });

  it('keeps text that already fits in a single post', () => {
    const posts = splitIntoThreadPosts('One short claim about agents.');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.position).toBe(1);
    expect(posts[0]?.content).toBe('One short claim about agents.');
    expect(posts[0]?.characterCount).toBe(characterCount('One short claim about agents.'));
  });

  it('splits long English text inside the per-post budget, numbering from one', () => {
    const posts = splitIntoThreadPosts(ENGLISH_LONG);
    expect(posts.length).toBeGreaterThan(1);
    posts.forEach((post, index) => {
      expect(post.position).toBe(index + 1);
      expect(post.characterCount).toBe(characterCount(post.content));
      expect(post.characterCount).toBeLessThanOrEqual(THREAD_POST_CHARACTER_BUDGET);
    });
  });

  it('breaks on sentence boundaries rather than mid-sentence', () => {
    for (const post of splitIntoThreadPosts(ENGLISH_LONG)) {
      expect(post.content.endsWith('.')).toBe(true);
    }
  });

  it('never breaks a word and never loses one', () => {
    const source = words(ENGLISH_LONG);
    const produced = splitIntoThreadPosts(ENGLISH_LONG).flatMap((post) => words(post.content));
    expect(produced).toStrictEqual(source);
  });

  it('splits Arabic text without breaking a word', () => {
    const posts = splitIntoThreadPosts(ARABIC_LONG);
    expect(posts.length).toBeGreaterThan(1);
    for (const post of posts) {
      expect(post.characterCount).toBeLessThanOrEqual(THREAD_POST_CHARACTER_BUDGET);
    }
    expect(posts.flatMap((post) => words(post.content))).toStrictEqual(words(ARABIC_LONG));
  });

  it('counts emoji as one character each, the way X does', () => {
    const text = Array.from({ length: 120 }, (_unused, index) => `Ship 🚀 item ${index} now.`).join(
      ' ',
    );
    const posts = splitIntoThreadPosts(text);

    for (const post of posts) {
      expect(post.characterCount).toBeLessThanOrEqual(THREAD_POST_CHARACTER_BUDGET);
      for (const character of post.content) {
        const codePoint = character.codePointAt(0) ?? 0;
        expect(codePoint < 0xd800 || codePoint > 0xdfff).toBe(true);
      }
    }
    // A UTF-16 length check would have cut these posts short: they are longer in
    // code units than the budget allows in code points.
    expect(posts.some((post) => post.content.length > THREAD_POST_CHARACTER_BUDGET)).toBe(true);
  });

  it('keeps a URL whole when it fits and only cuts one that cannot fit at all', () => {
    const url = `https://example.com/${'a'.repeat(120)}`;
    const posts = splitIntoThreadPosts(`Read the write-up here: ${url} It explains the migration.`);
    expect(posts.some((post) => post.content.includes(url))).toBe(true);

    const monster = `https://example.com/${'b'.repeat(600)}`;
    const cut = splitIntoThreadPosts(monster);
    expect(cut.length).toBeGreaterThan(1);
    for (const post of cut) {
      expect(post.characterCount).toBeLessThanOrEqual(THREAD_POST_CHARACTER_BUDGET);
    }
    expect(cut.map((post) => post.content).join('')).toBe(monster);
  });

  it('honours a custom limit and counter reservation', () => {
    const posts = splitIntoThreadPosts(ENGLISH_LONG, {
      maxCharacters: 100,
      reserveForCounter: 10,
    });
    for (const post of posts) {
      expect(post.characterCount).toBeLessThanOrEqual(90);
    }

    const unreserved = splitIntoThreadPosts(ENGLISH_LONG, { reserveForCounter: 0 });
    const reserved = splitIntoThreadPosts(ENGLISH_LONG, {
      reserveForCounter: THREAD_COUNTER_RESERVED_CHARACTERS,
    });
    expect(unreserved.length).toBeLessThanOrEqual(reserved.length);
  });

  it('keeps separate lines on separate lines when they share a post', () => {
    const posts = splitIntoThreadPosts('First line.\nSecond line.');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.content).toBe('First line.\nSecond line.');
  });

  it('strips control and bidirectional characters from the text it splits', () => {
    const posts = splitIntoThreadPosts('Safe\u202Etext\u0000 about agents.');
    expect(posts[0]?.content).toBe('Safetext about agents.');
  });
});
