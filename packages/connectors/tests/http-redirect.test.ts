import { describe, expect, it } from 'vitest';

import { HttpClient } from '../src/http';

/**
 * Redirects are followed by hand so that every hop passes the SSRF guard, which
 * means the client also inherits the job `fetch` normally does for it: undici
 * strips `authorization` when a redirect crosses origins, and `redirect:
 * 'manual'` opts out of that. These assertions pin the replacement, because the
 * failure is silent — the request succeeds either way, it just hands the
 * provider's bearer token to whoever the redirect names.
 */

interface Hop {
  readonly status: number;
  readonly location?: string;
}

/** Drives the client through a scripted chain of hops, recording what was sent. */
function client(hops: readonly Hop[]) {
  const seen: { url: string; auth: string | undefined; method: string }[] = [];
  let i = 0;
  const fetchImpl = (url: string, init: RequestInit): Promise<Response> => {
    const h = new Headers(init.headers);
    seen.push({ url, auth: h.get('authorization') ?? undefined, method: init.method ?? 'GET' });
    const hop = hops[i];
    i += 1;
    if (hop?.location !== undefined) {
      return Promise.resolve(
        new Response(null, { status: hop.status, headers: { location: hop.location } }),
      );
    }
    return Promise.resolve(
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  return {
    seen,
    http: new HttpClient({
      userAgent: 'probe',
      allowPrivateNetworks: true,
      fetchImpl,
      // The backoff is irrelevant here and would only make the suite slow.
      sleepImpl: () => Promise.resolve(),
    }),
  };
}

describe('redirect credential handling', () => {
  it('keeps Authorization on a same-origin redirect', async () => {
    const { http, seen } = client([{ status: 302, location: 'https://api.example.test/v2/next' }, { status: 200 }]);
    await http.requestText({
      url: 'https://api.example.test/v1/thing',
      headers: { authorization: 'Bearer SECRET' },
      provider: 'probe',
    });
    expect(seen.map((s) => s.auth)).toEqual(['Bearer SECRET', 'Bearer SECRET']);
  });

  it('strips Authorization when the redirect leaves the origin', async () => {
    const { http, seen } = client([{ status: 302, location: 'https://attacker.test/steal' }, { status: 200 }]);
    await http.requestText({
      url: 'https://api.example.test/v1/thing',
      headers: { authorization: 'Bearer SECRET' },
      provider: 'probe',
    });
    expect(seen[0]?.auth).toBe('Bearer SECRET');
    expect(seen[1]?.url).toContain('attacker.test');
    expect(seen[1]?.auth).toBeUndefined();
  });

  it('strips it on a 307 too, where the method and body survive', async () => {
    const { http, seen } = client([{ status: 307, location: 'https://attacker.test/steal' }, { status: 200 }]);
    await http.requestText({
      url: 'https://oauth.example.test/token',
      method: 'POST',
      body: 'grant_type=client_credentials',
      headers: { authorization: 'Basic Q0xJRU5UOlNFQ1JFVA==' },
      provider: 'probe',
    });
    expect(seen[1]?.method).toBe('POST');
    expect(seen[1]?.auth).toBeUndefined();
  });
});
