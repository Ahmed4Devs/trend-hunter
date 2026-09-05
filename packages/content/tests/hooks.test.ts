import { LlmProviderError, characterCount } from '@trendhunter/shared';
import { describe, expect, it } from 'vitest';

import {
  MAX_HOOK_CANDIDATES,
  generateHooks,
  pickStrongestHook,
  rankHooks,
  scoreHook,
} from '../src/hooks';
import { createFakeProvider } from './fake-provider';
import { ARABIC_CONTEXT, ENGLISH_CONTEXT } from './fixtures';

const TOPIC = { topicName: ENGLISH_CONTEXT.topicName, interests: ENGLISH_CONTEXT.interests };

const STRONG_HOOK =
  'Coding agents opened 40 pull requests last week and 9 of them broke the migration nobody reviewed.';
const VAGUE_HOOK = 'This is an amazing thing and it changes everything for all of us.';

describe('scoreHook', () => {
  it('is deterministic', () => {
    expect(scoreHook(STRONG_HOOK, TOPIC)).toStrictEqual(scoreHook(STRONG_HOOK, TOPIC));
  });

  it('returns zeros for an empty hook rather than throwing', () => {
    expect(scoreHook('   ')).toStrictEqual({
      specificity: 0,
      curiosityGap: 0,
      concreteness: 0,
      length: 0,
      score: 0,
    });
  });

  it('ranks a specific, concrete hook above a vague one', () => {
    const strong = scoreHook(STRONG_HOOK, TOPIC);
    const vague = scoreHook(VAGUE_HOOK, TOPIC);
    expect(strong.score).toBeGreaterThan(vague.score);
    expect(strong.specificity).toBeGreaterThan(vague.specificity);
    expect(strong.concreteness).toBeGreaterThan(vague.concreteness);
  });

  it('rewards a number and a verb that asserts a change', () => {
    expect(scoreHook('Agents cut review time by 40%.').concreteness).toBe(100);
    expect(scoreHook('Agents are interesting to consider.').concreteness).toBe(0);
  });

  it('rewards a curiosity gap from a question, a cue or an early colon', () => {
    expect(scoreHook('Why did the migration fail?').curiosityGap).toBeGreaterThan(
      scoreHook('The migration failed on Tuesday.').curiosityGap,
    );
    expect(
      scoreHook('The catch nobody mentions: the agent never reads the diff.').curiosityGap,
    ).toBeGreaterThan(0);
  });

  it('scores length on a window, penalising both extremes', () => {
    expect(scoreHook('Too short.').length).toBe(0);
    expect(scoreHook('a'.repeat(400)).length).toBe(0);
    expect(scoreHook('Coding agents opened forty pull requests in a single week.').length).toBe(
      100,
    );
  });

  it('is anchored to the topic: naming it raises specificity', () => {
    const anchored = scoreHook(STRONG_HOOK, TOPIC).specificity;
    const unanchored = scoreHook(STRONG_HOOK).specificity;
    expect(anchored).toBeGreaterThan(unanchored);
  });

  it('scores Arabic hooks, including the Arabic question mark', () => {
    const arabic = scoreHook('لماذا فشلت 3 من كل 10 مهام للوكلاء على المستودعات الحقيقية؟', {
      topicName: ARABIC_CONTEXT.topicName,
      interests: ARABIC_CONTEXT.interests,
    });
    expect(arabic.curiosityGap).toBeGreaterThan(0);
    expect(arabic.concreteness).toBeGreaterThan(0);
    expect(arabic.score).toBeGreaterThan(0);
  });

  it('penalises hooks that promise significance without supplying it', () => {
    const plain = scoreHook('Coding agents opened 40 pull requests last week.', TOPIC);
    const hyped = scoreHook(
      'Coding agents opened 40 pull requests last week and this changes everything.',
      TOPIC,
    );
    expect(hyped.specificity).toBeLessThan(plain.specificity);
  });
});

describe('rankHooks', () => {
  it('orders strongest first and does not depend on the input order', () => {
    const forwards = rankHooks([VAGUE_HOOK, STRONG_HOOK, 'Agents cut review time by 40%.'], TOPIC);
    const backwards = rankHooks(['Agents cut review time by 40%.', STRONG_HOOK, VAGUE_HOOK], TOPIC);
    expect(forwards.map((hook) => hook.content)).toStrictEqual(
      backwards.map((hook) => hook.content),
    );
    expect(forwards[0]?.content).toBe(STRONG_HOOK);
    expect(forwards[0]?.score).toBeGreaterThanOrEqual(forwards[1]?.score ?? 0);
  });

  it('collapses candidates that differ only in case and punctuation', () => {
    const ranked = rankHooks(['Agents cut review time!', 'agents cut review time'], TOPIC);
    expect(ranked).toHaveLength(1);
  });

  it('drops blank candidates and reports the counted length', () => {
    const ranked = rankHooks(['', '   ', STRONG_HOOK], TOPIC);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.characterCount).toBe(characterCount(STRONG_HOOK));
  });

  it('returns null when there is nothing to pick', () => {
    expect(pickStrongestHook([])).toBeNull();
    expect(pickStrongestHook(['  '])).toBeNull();
  });
});

describe('generateHooks', () => {
  it('generates ranked candidates inside the hook budget', async () => {
    const provider = createFakeProvider();
    const hooks = await generateHooks(provider, ENGLISH_CONTEXT, { count: 3 });

    expect(hooks.length).toBeGreaterThan(0);
    expect(hooks.length).toBeLessThanOrEqual(3);
    expect(provider.requests).toHaveLength(3);
    for (const hook of hooks) {
      expect(hook.characterCount).toBeLessThanOrEqual(140);
    }
    for (let index = 1; index < hooks.length; index += 1) {
      expect(hooks[index - 1]?.score).toBeGreaterThanOrEqual(hooks[index]?.score ?? 0);
    }
  });

  it('asks for each candidate under a different angle', async () => {
    const provider = createFakeProvider();
    await generateHooks(provider, ENGLISH_CONTEXT, { count: 3 });
    const briefs = provider.requests.map((request) => request.context.topicSummary);
    expect(new Set(briefs).size).toBe(3);
  });

  it('clamps the requested candidate count', async () => {
    const provider = createFakeProvider();
    await generateHooks(provider, ENGLISH_CONTEXT, { count: 50 });
    expect(provider.requests).toHaveLength(MAX_HOOK_CANDIDATES);
  });

  it('fails only when no candidate survives validation', async () => {
    const provider = createFakeProvider({ malformedValue: { content: '' } });
    await expect(generateHooks(provider, ENGLISH_CONTEXT, { count: 2 })).rejects.toBeInstanceOf(
      LlmProviderError,
    );
  });
});
