import {
  LlmProviderError,
  MAX_THREAD_LENGTH,
  MIN_THREAD_LENGTH,
  ValidationError,
  X_POST_CHARACTER_LIMIT,
  characterCount,
} from '@trendhunter/shared';
import type {
  GenerateRequest,
  GeneratedPost,
  GeneratedThread,
  LlmResult,
} from '@trendhunter/types';
import { describe, expect, it } from 'vitest';

import { scoreHook } from '../src/hooks';
import { THREAD_POST_CHARACTER_BUDGET } from '../src/prompts';
import type { ThreadResult } from '../src/thread-service';
import { ThreadService } from '../src/thread-service';
import { createFakeProvider } from './fake-provider';
import { ARABIC_CONTEXT, ENGLISH_CONTEXT } from './fixtures';

const HOOK_CONTEXT = {
  topicName: ENGLISH_CONTEXT.topicName,
  interests: ENGLISH_CONTEXT.interests,
};

describe('ThreadService.generateThread', () => {
  it('produces the requested number of posts, numbered and inside the per-post budget', async () => {
    const thread = await new ThreadService(createFakeProvider()).generateThread(ENGLISH_CONTEXT, {
      length: 6,
    });

    expect(thread.posts).toHaveLength(6);
    thread.posts.forEach((post, index) => {
      expect(post.position).toBe(index + 1);
      expect(post.content.length).toBeGreaterThan(0);
      expect(post.characterCount).toBe(characterCount(post.content));
      expect(post.characterCount).toBeLessThanOrEqual(THREAD_POST_CHARACTER_BUDGET);
      expect(post.characterCount).toBeLessThanOrEqual(X_POST_CHARACTER_LIMIT);
    });
    expect(thread.title.length).toBeGreaterThan(0);
    expect(thread.providerName).toBe('fake');
  });

  it('opens with a hook at least as strong as the one the provider offered', async () => {
    const bare = await new ThreadService(createFakeProvider()).generateThread(ENGLISH_CONTEXT, {
      length: 4,
      hookCandidates: 0,
    });
    const picked = await new ThreadService(createFakeProvider()).generateThread(ENGLISH_CONTEXT, {
      length: 4,
      hookCandidates: 3,
    });

    const bareScore = scoreHook(bare.posts[0]?.content ?? '', HOOK_CONTEXT).score;
    const pickedScore = scoreHook(picked.posts[0]?.content ?? '', HOOK_CONTEXT).score;
    expect(pickedScore).toBeGreaterThanOrEqual(bareScore);
  });

  it('keeps the provider first post when hook candidates are switched off', async () => {
    const provider = createFakeProvider();
    const thread = await new ThreadService(provider).generateThread(ENGLISH_CONTEXT, {
      length: 3,
      hookCandidates: 0,
    });
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.kind).toBe('X_THREAD');
    expect(thread.posts[0]?.content.length).toBeGreaterThan(0);
  });

  it('ends on a call to action, adding one when the model did not', async () => {
    const thread = await new ThreadService(createFakeProvider()).generateThread(ENGLISH_CONTEXT, {
      length: 4,
    });
    const last = thread.posts[thread.posts.length - 1];
    expect(last?.content).toContain('follow');
    expect(last?.characterCount).toBeLessThanOrEqual(THREAD_POST_CHARACTER_BUDGET);
  });

  it('keeps the call to action the model already wrote', async () => {
    const closing = 'Reply with your own numbers and follow for the next teardown.';
    const thread = await new ThreadService(
      createFakeProvider({ constantContent: closing }),
    ).generateThread(ENGLISH_CONTEXT, { length: 3 });
    expect(thread.posts[thread.posts.length - 1]?.content).toBe(closing);
  });

  it('writes an Arabic call to action for an Arabic thread', async () => {
    const thread = await new ThreadService(createFakeProvider()).generateThread(ARABIC_CONTEXT, {
      length: 3,
      language: 'AR',
    });
    expect(thread.language).toBe('AR');
    expect(thread.posts[thread.posts.length - 1]?.content).toContain('تابعني');
  });

  it('splits posts the provider returned too long and still lands on the requested count', async () => {
    const thread = await new ThreadService(
      createFakeProvider({ threadPostLength: 900 }),
    ).generateThread(ENGLISH_CONTEXT, { length: 5 });

    expect(thread.posts).toHaveLength(5);
    for (const post of thread.posts) {
      expect(post.characterCount).toBeLessThanOrEqual(THREAD_POST_CHARACTER_BUDGET);
    }
  });

  it('clamps the requested length to the supported range', async () => {
    const service = new ThreadService(createFakeProvider());
    const longest = await service.generateThread(ENGLISH_CONTEXT, { length: 999 });
    const shortest = await service.generateThread(ENGLISH_CONTEXT, { length: 1 });

    expect(longest.posts).toHaveLength(MAX_THREAD_LENGTH);
    expect(shortest.posts).toHaveLength(MIN_THREAD_LENGTH);
  });

  it('rejects a thread too short to be a thread', async () => {
    const service = new ThreadService(
      createFakeProvider({ malformedValue: { title: 't', posts: [{ content: 'only one post' }] } }),
    );
    await expect(service.generateThread(ENGLISH_CONTEXT)).rejects.toBeInstanceOf(LlmProviderError);
  });

  it('rejects a malformed thread payload', async () => {
    const service = new ThreadService(createFakeProvider({ malformedValue: { posts: 'nope' } }));
    await expect(service.generateThread(ENGLISH_CONTEXT)).rejects.toBeInstanceOf(LlmProviderError);
  });

  it('still returns the thread when hook generation fails', async () => {
    const base = createFakeProvider();
    const provider = {
      ...base,
      generate(request: GenerateRequest): Promise<LlmResult<GeneratedPost | GeneratedThread>> {
        if (request.kind === 'HOOK') return Promise.reject(new Error('hook outage'));
        return base.generate(request);
      },
    };
    const thread = await new ThreadService(provider).generateThread(ENGLISH_CONTEXT, { length: 3 });
    expect(thread.posts).toHaveLength(3);
  });
});

describe('ThreadService.threadFromPost', () => {
  it('expands a post into a thread built on the post text', async () => {
    const provider = createFakeProvider();
    const thread = await new ThreadService(provider).threadFromPost(
      {
        content: 'Coding agents opened 40 pull requests and broke one migration.',
        context: ENGLISH_CONTEXT,
      },
      { hookCandidates: 0 },
    );

    expect(thread.posts.length).toBeGreaterThanOrEqual(MIN_THREAD_LENGTH);
    const brief = provider.requests[0]?.context.topicSummary ?? '';
    expect(brief).toContain('Expand the post below into a thread.');
    expect(brief).toContain('broke one migration.');
  });

  it('honours an explicit length', async () => {
    const thread = await new ThreadService(createFakeProvider()).threadFromPost(
      { content: 'A short claim about agents.', context: ENGLISH_CONTEXT },
      { length: 8 },
    );
    expect(thread.posts).toHaveLength(8);
  });

  it('refuses an empty post', async () => {
    const service = new ThreadService(createFakeProvider());
    await expect(
      service.threadFromPost({ content: '   ', context: ENGLISH_CONTEXT }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('ThreadService.postFromThread', () => {
  it('condenses a thread into one post that keeps the strongest claim', async () => {
    const provider = createFakeProvider();
    const service = new ThreadService(provider);
    const thread = await service.generateThread(ENGLISH_CONTEXT, {
      length: 5,
      hookCandidates: 0,
    });
    const post = await service.postFromThread(thread);

    expect(post.kind).toBe('SHORT_X_POST');
    expect(post.characterCount).toBeLessThanOrEqual(X_POST_CHARACTER_LIMIT);

    const brief = provider.requests[provider.requests.length - 1]?.context.topicSummary ?? '';
    expect(brief).toContain('Condense the thread below into a single post.');
    expect(brief).toContain('The claim the post must keep is:');
    expect(brief).toContain('TEXT TO REWORK:');
  });

  it('refuses a thread with no posts', async () => {
    const empty: ThreadResult = {
      title: 'Empty',
      language: 'EN',
      tone: 'NEUTRAL',
      posts: [],
      providerName: 'fake',
      providerModel: 'fake-1',
      context: ENGLISH_CONTEXT,
    };
    await expect(
      new ThreadService(createFakeProvider()).postFromThread(empty),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
