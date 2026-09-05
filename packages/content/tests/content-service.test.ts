import {
  LlmProviderError,
  ValidationError,
  X_LONG_POST_CHARACTER_LIMIT,
  X_POST_CHARACTER_LIMIT,
  characterCount,
} from '@trendhunter/shared';
import { CONTENT_DRAFT_KINDS } from '@trendhunter/types';
import { describe, expect, it } from 'vitest';

import { ContentService, MAX_CONTENT_IDEAS } from '../src/content-service';
import { characterBudgetFor, isStandardPostKind } from '../src/prompts';
import { createFakeProvider } from './fake-provider';
import { ENGLISH_CONTEXT } from './fixtures';

const SINGLE_POST_KINDS = CONTENT_DRAFT_KINDS.filter((kind) => kind !== 'X_THREAD');

describe('ContentService.generateDraft', () => {
  it('produces every draft kind inside its own budget', async () => {
    const service = new ContentService(createFakeProvider());
    for (const kind of SINGLE_POST_KINDS) {
      const draft = await service.generateDraft(kind, ENGLISH_CONTEXT);
      const budget = characterBudgetFor(kind) ?? 0;

      expect(draft.kind).toBe(kind);
      expect(draft.content.length).toBeGreaterThan(0);
      expect(draft.characterCount).toBe(characterCount(draft.content));
      expect(draft.characterCount).toBeLessThanOrEqual(budget);
      expect(draft.characterBudget).toBe(budget);
      expect(draft.providerName).toBe('fake');
      expect(draft.providerModel).toBe('fake-1');
      expect(draft.trimmed).toBe(false);
    }
  });

  it('keeps every kind published as a standard post inside the X limit', async () => {
    const service = new ContentService(createFakeProvider());
    for (const kind of SINGLE_POST_KINDS.filter(isStandardPostKind)) {
      const draft = await service.generateDraft(kind, ENGLISH_CONTEXT);
      expect(draft.characterCount).toBeLessThanOrEqual(X_POST_CHARACTER_LIMIT);
    }
  });

  it('refuses to generate a thread, which has different guarantees', async () => {
    const service = new ContentService(createFakeProvider());
    await expect(service.generateDraft('X_THREAD', ENGLISH_CONTEXT)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('cuts a provider that overruns the budget and says that it did', async () => {
    const service = new ContentService(
      createFakeProvider({ constantContent: 'x'.repeat(5_000) }),
    );
    const draft = await service.generateDraft('SHORT_X_POST', ENGLISH_CONTEXT);
    expect(draft.characterCount).toBe(X_POST_CHARACTER_LIMIT);
    expect(draft.trimmed).toBe(true);
  });

  it('records the tone and language it asked for', async () => {
    const provider = createFakeProvider();
    const service = new ContentService(provider);
    const draft = await service.generateDraft('OPINION_POST', ENGLISH_CONTEXT, {
      tone: 'ANALYTICAL',
      language: 'AR',
    });
    expect(draft.tone).toBe('ANALYTICAL');
    expect(draft.language).toBe('AR');
    expect(provider.requests[0]?.tone).toBe('ANALYTICAL');
    expect(provider.requests[0]?.language).toBe('AR');
  });

  it('rejects malformed provider output instead of publishing it', async () => {
    const cases: readonly unknown[] = [null, 'a bare string', {}, { content: '   ' }];
    for (const malformedValue of cases) {
      const service = new ContentService(createFakeProvider({ malformedValue }));
      await expect(service.generateDraft('SUMMARY', ENGLISH_CONTEXT)).rejects.toBeInstanceOf(
        LlmProviderError,
      );
    }
  });

  it('rejects a thread returned where a single post was asked for', async () => {
    const service = new ContentService(
      createFakeProvider({ malformedValue: { title: 't', posts: [{ content: 'a' }] } }),
    );
    await expect(service.generateDraft('SUMMARY', ENGLISH_CONTEXT)).rejects.toBeInstanceOf(
      LlmProviderError,
    );
  });

  it('wraps a raw error escaping an adapter', async () => {
    const service = new ContentService(createFakeProvider({ throwRaw: true }));
    await expect(service.generateDraft('SUMMARY', ENGLISH_CONTEXT)).rejects.toBeInstanceOf(
      LlmProviderError,
    );
  });
});

describe('ContentService.regenerate', () => {
  it('produces a different draft under a different angle', async () => {
    const provider = createFakeProvider();
    const service = new ContentService(provider);
    const first = await service.generateDraft('SHORT_X_POST', ENGLISH_CONTEXT);
    const second = await service.regenerate(first);

    expect(second.content).not.toBe(first.content);
    expect(second.kind).toBe(first.kind);
    expect(second.angle).not.toBeNull();
    expect(provider.requests[1]?.context.topicSummary).toContain('DO NOT REPEAT');
  });

  it('keeps moving through the angles on repeated regeneration', async () => {
    const service = new ContentService(createFakeProvider());
    const first = await service.generateDraft('SHORT_X_POST', ENGLISH_CONTEXT);
    const second = await service.regenerate(first);
    const third = await service.regenerate(second);

    expect(third.angle).not.toBe(second.angle);
    expect(third.content).not.toBe(second.content);
  });

  it('reports a provider that answers with the same text under every angle', async () => {
    const provider = createFakeProvider({ constantContent: 'The same sentence every time.' });
    const service = new ContentService(provider);
    const first = await service.generateDraft('SHORT_X_POST', ENGLISH_CONTEXT);
    await expect(service.regenerate(first)).rejects.toBeInstanceOf(LlmProviderError);
    expect(provider.requests).toHaveLength(4);
  });
});

describe('ContentService rewrite operations', () => {
  it('shortens a draft', async () => {
    const provider = createFakeProvider();
    const service = new ContentService(provider);
    const draft = await service.generateDraft('LONG_X_POST', ENGLISH_CONTEXT);
    const shorter = await service.shorten(draft);

    expect(shorter.characterCount).toBeLessThan(draft.characterCount);
    expect(shorter.kind).toBe(draft.kind);
    expect(provider.requests[1]?.context.topicSummary).toContain('so it is shorter');
    expect(provider.requests[1]?.context.topicSummary).toContain('TEXT TO REWORK');
  });

  it('shortens even a provider that ignores the shorter budget', async () => {
    const service = new ContentService(createFakeProvider());
    const draft = await service.generateDraft('SHORT_X_POST', ENGLISH_CONTEXT);
    const shorter = await service.shorten(draft);
    expect(shorter.characterCount).toBeLessThan(draft.characterCount);
  });

  it('refuses to shorten a draft with nothing left to cut', async () => {
    const service = new ContentService(createFakeProvider({ constantContent: 'Agents ship.' }));
    const draft = await service.generateDraft('HOOK', ENGLISH_CONTEXT);
    await expect(service.shorten(draft)).rejects.toBeInstanceOf(ValidationError);
  });

  it('expands a draft and promotes it when its kind has no room left', async () => {
    const service = new ContentService(createFakeProvider());
    const draft = await service.generateDraft('SHORT_X_POST', ENGLISH_CONTEXT);
    const longer = await service.expand(draft);

    expect(longer.characterCount).toBeGreaterThan(draft.characterCount);
    expect(longer.kind).toBe('LONG_X_POST');
    expect(longer.characterCount).toBeLessThanOrEqual(X_LONG_POST_CHARACTER_LIMIT);
  });

  it('reports a provider that cannot make the draft any longer', async () => {
    const service = new ContentService(
      createFakeProvider({ constantContent: 'A sentence that never grows however it is asked.' }),
    );
    const draft = await service.generateDraft('SHORT_X_POST', ENGLISH_CONTEXT);
    await expect(service.expand(draft)).rejects.toBeInstanceOf(LlmProviderError);
  });

  it('refuses to expand a draft already at the longest kind', async () => {
    const service = new ContentService(createFakeProvider({ constantContent: 'x'.repeat(9_000) }));
    const draft = await service.generateDraft('LONG_X_POST', ENGLISH_CONTEXT);
    expect(draft.characterCount).toBe(X_LONG_POST_CHARACTER_LIMIT);
    await expect(service.expand(draft)).rejects.toBeInstanceOf(ValidationError);
  });

  it('changes the tone and keeps the kind', async () => {
    const provider = createFakeProvider();
    const service = new ContentService(provider);
    const draft = await service.generateDraft('SUMMARY', ENGLISH_CONTEXT, { tone: 'NEUTRAL' });
    const retoned = await service.changeTone(draft, 'CONTRARIAN');

    expect(retoned.tone).toBe('CONTRARIAN');
    expect(retoned.kind).toBe('SUMMARY');
    expect(retoned.content).not.toBe(draft.content);
    expect(provider.requests[1]?.context.topicSummary).toContain('only the register changes');
  });

  it('carries a sanitised user instruction into the rewrite brief', async () => {
    const provider = createFakeProvider();
    const service = new ContentService(provider);
    const draft = await service.generateDraft('SHORT_X_POST', ENGLISH_CONTEXT);
    await service.rewrite(draft, { instruction: 'Mention  the‮ rollback.' });

    const brief = provider.requests[1]?.context.topicSummary ?? '';
    expect(brief).toContain('Mention the rollback.');
    expect(brief).not.toContain(' ');
    expect(brief).not.toContain('‮');
  });

  it('rewrites without an instruction', async () => {
    const service = new ContentService(createFakeProvider());
    const draft = await service.generateDraft('SHORT_X_POST', ENGLISH_CONTEXT);
    const rewritten = await service.rewrite(draft);
    expect(rewritten.content).not.toBe(draft.content);
    expect(rewritten.characterCount).toBeLessThanOrEqual(draft.characterBudget);
  });
});

describe('ContentService.generateIdeas', () => {
  it('returns the requested number of distinct ideas', async () => {
    const provider = createFakeProvider();
    const ideas = await new ContentService(provider).generateIdeas(ENGLISH_CONTEXT, 5);

    expect(ideas).toHaveLength(5);
    expect(new Set(ideas.map((idea) => idea.content)).size).toBe(5);
    for (const idea of ideas) {
      expect(idea.kind).toBe('CONTENT_IDEA');
      expect(idea.characterCount).toBeLessThanOrEqual(characterBudgetFor('CONTENT_IDEA') ?? 0);
    }
    expect(provider.requests.length).toBeGreaterThan(5);
  });

  it('clamps the requested count', async () => {
    const ideas = await new ContentService(createFakeProvider()).generateIdeas(ENGLISH_CONTEXT, 99);
    expect(ideas).toHaveLength(MAX_CONTENT_IDEAS);
  });

  it('collapses ideas a provider repeats', async () => {
    const service = new ContentService(createFakeProvider({ constantContent: 'One idea only.' }));
    const ideas = await service.generateIdeas(ENGLISH_CONTEXT, 4);
    expect(ideas).toHaveLength(1);
  });

  it('fails when nothing usable comes back', async () => {
    const service = new ContentService(createFakeProvider({ malformedValue: null }));
    await expect(service.generateIdeas(ENGLISH_CONTEXT, 3)).rejects.toBeInstanceOf(
      LlmProviderError,
    );
  });
});
