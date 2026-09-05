import { describe, expect, it } from 'vitest';

import { ValidationError } from '../src/errors';
import { assertSafeUrl, assertSafeUrlShape, isPrivateAddress } from '../src/url-guard';

/** Asserts the guard refuses `rawUrl`, and that it refuses it as a ValidationError. */
function expectRejected(rawUrl: string): void {
  expect(() => assertSafeUrlShape(rawUrl), rawUrl).toThrow(ValidationError);
}

describe('assertSafeUrlShape — accepted URLs', () => {
  it('accepts an ordinary public https URL and returns the parsed URL', () => {
    const url = assertSafeUrlShape('https://example.com/feed.xml?page=2');
    expect(url.hostname).toBe('example.com');
    expect(url.pathname).toBe('/feed.xml');
  });

  it('accepts plain http on the default port', () => {
    expect(assertSafeUrlShape('http://blog.example.com/rss').protocol).toBe('http:');
  });

  it('accepts the allow-listed non-default ports', () => {
    for (const url of [
      'https://example.com:443/a',
      'http://example.com:80/a',
      'http://example.com:8080/a',
      'https://example.com:8443/a',
    ]) {
      expect(() => assertSafeUrlShape(url)).not.toThrow();
    }
  });

  it('accepts a public IP literal', () => {
    expect(() => assertSafeUrlShape('https://8.8.8.8/feed')).not.toThrow();
    expect(() => assertSafeUrlShape('https://[2606:4700:4700::1111]/feed')).not.toThrow();
  });

  it('accepts addresses just outside the private ranges', () => {
    for (const url of [
      'http://172.15.0.1/',
      'http://172.32.0.1/',
      'http://100.63.255.255/',
      'http://100.128.0.1/',
      'http://11.0.0.1/',
      'http://192.167.1.1/',
      'http://169.253.0.1/',
    ]) {
      expect(() => assertSafeUrlShape(url), url).not.toThrow();
    }
  });

  it('accepts a host whose name merely contains a blocked word', () => {
    expect(() => assertSafeUrlShape('https://api.example.com/v1')).not.toThrow();
    expect(() => assertSafeUrlShape('https://localhost.example.com/')).not.toThrow();
    expect(() => assertSafeUrlShape('https://internal.example.com/')).not.toThrow();
  });
});

describe('assertSafeUrlShape — loopback and localhost', () => {
  it('rejects every spelling of the local machine', () => {
    for (const url of [
      'http://localhost/',
      'http://LOCALHOST/',
      'http://localhost:8080/',
      'http://localhost.localdomain/',
      'http://127.0.0.1/',
      'http://127.1.2.3/',
      'http://[::1]/',
      'http://ip6-localhost/',
      'http://ip6-loopback/',
      'http://0.0.0.0/',
    ]) {
      expectRejected(url);
    }
  });
});

describe('assertSafeUrlShape — private and reserved networks', () => {
  it('rejects the cloud metadata endpoint', () => {
    expectRejected('http://169.254.169.254/latest/meta-data/');
    expectRejected('http://metadata.google.internal/computeMetadata/v1/');
    expectRejected('http://metadata/');
    expectRejected('http://metadata.goog/');
    expectRejected('http://instance-data/');
  });

  it('rejects every RFC 1918 range', () => {
    for (const url of [
      'http://10.0.0.1/',
      'http://10.255.255.255/',
      'http://172.16.0.1/',
      'http://172.20.5.5/',
      'http://172.31.255.255/',
      'http://192.168.0.1/',
      'http://192.168.255.255/',
    ]) {
      expectRejected(url);
    }
  });

  it('rejects carrier-grade NAT, benchmarking, protocol-assignment and multicast space', () => {
    for (const url of [
      'http://100.64.0.1/',
      'http://100.127.255.255/',
      'http://198.18.0.1/',
      'http://198.19.255.255/',
      'http://192.0.0.1/',
      'http://224.0.0.1/',
      'http://255.255.255.255/',
    ]) {
      expectRejected(url);
    }
  });

  it('rejects IPv4-mapped IPv6 forms of a private address', () => {
    // `new URL()` re-serialises these as `::ffff:a00:1`, so the guard has to
    // recover the embedded IPv4 rather than pattern-matching a dotted quad.
    for (const url of [
      'http://[::ffff:10.0.0.1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:169.254.169.254]/',
      'http://[::ffff:192.168.1.1]/',
      'http://[::ffff:172.16.0.1]/',
      'http://[0:0:0:0:0:ffff:7f00:1]/',
    ]) {
      expectRejected(url);
    }
  });

  it('rejects IPv6 link-local, unique-local and multicast addresses', () => {
    for (const url of [
      'http://[fe80::1]/',
      'http://[fd00::1]/',
      'http://[fc00::1]/',
      'http://[ff02::1]/',
      'http://[::]/',
    ]) {
      expectRejected(url);
    }
  });
});

describe('assertSafeUrlShape — internal hostnames', () => {
  it('rejects the Compose service names of this deployment', () => {
    for (const name of ['postgres', 'redis', 'api', 'web', 'worker', 'caddy']) {
      expectRejected(`http://${name}/`);
    }
  });

  it('rejects internal-only domain suffixes', () => {
    for (const url of [
      'http://printer.local/',
      'http://vault.internal/',
      'http://box.localdomain/',
      'http://app.localhost/',
      'http://MAIL.LOCAL/',
    ]) {
      expectRejected(url);
    }
  });
});

describe('assertSafeUrlShape — protocol, credentials and ports', () => {
  it('rejects non-http protocols', () => {
    for (const url of [
      'ftp://example.com/a',
      'file:///etc/passwd',
      'data:text/plain,hello',
      'gopher://example.com/',
      'ws://example.com/',
    ]) {
      expectRejected(url);
    }
  });

  it('rejects embedded credentials, which are a classic guard bypass', () => {
    expectRejected('https://user:pass@example.com/');
    expectRejected('https://user@example.com/');
    expectRejected('https://:pass@example.com/');
  });

  it('rejects a port outside the allow-list', () => {
    for (const url of [
      'http://example.com:22/',
      'http://example.com:5432/',
      'http://example.com:6379/',
      'http://example.com:3000/',
      'https://example.com:1/',
    ]) {
      expectRejected(url);
    }
  });

  it('names the refused port in the message without echoing the whole URL', () => {
    expect(() => assertSafeUrlShape('http://example.com:5432/')).toThrow(/port 5432/);
  });

  it('rejects input that is not an absolute URL', () => {
    for (const url of ['', 'example.com/feed', '/relative/path', 'not a url', '://broken']) {
      expectRejected(url);
    }
  });

  it('honours a custom protocol allow-list', () => {
    expect(() =>
      assertSafeUrlShape('https://example.com/a', { allowedProtocols: new Set(['http:']) }),
    ).toThrow(ValidationError);
    expect(() =>
      assertSafeUrlShape('http://example.com/a', { allowedProtocols: new Set(['http:']) }),
    ).not.toThrow();
  });
});

describe('assertSafeUrlShape — the development escape hatch', () => {
  it('allows private targets only when explicitly opted in', () => {
    for (const url of [
      'http://localhost:8080/feed',
      'http://127.0.0.1:8080/feed',
      'http://[::1]/',
    ]) {
      expect(() => assertSafeUrlShape(url, { allowPrivateNetworks: true }), url).not.toThrow();
    }
  });

  it('still enforces protocol, credentials and ports when private networks are allowed', () => {
    expect(() => assertSafeUrlShape('file:///etc/passwd', { allowPrivateNetworks: true })).toThrow(
      ValidationError,
    );
    expect(() =>
      assertSafeUrlShape('http://user:pass@localhost/', { allowPrivateNetworks: true }),
    ).toThrow(ValidationError);
    expect(() =>
      assertSafeUrlShape('http://localhost:5432/', { allowPrivateNetworks: true }),
    ).toThrow(ValidationError);
  });

  it('treats any value other than true as not opted in', () => {
    expect(() => assertSafeUrlShape('http://localhost/', { allowPrivateNetworks: false })).toThrow(
      ValidationError,
    );
    expect(() => assertSafeUrlShape('http://localhost/', {})).toThrow(ValidationError);
  });
});

describe('isPrivateAddress', () => {
  it('is true for every private, reserved and loopback IPv4 address', () => {
    for (const address of [
      '0.0.0.0',
      '0.1.2.3',
      '10.1.2.3',
      '127.0.0.1',
      '100.64.0.1',
      '100.127.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.0.1',
      '192.0.0.1',
      '192.168.1.1',
      '198.18.0.1',
      '198.19.0.1',
      '224.0.0.1',
      '239.255.255.255',
      '255.255.255.255',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it('is false for ordinary public IPv4 addresses', () => {
    for (const address of [
      '1.1.1.1',
      '8.8.8.8',
      '93.184.216.34',
      '172.15.255.255',
      '172.32.0.1',
      '100.63.255.255',
      '100.128.0.1',
      '169.253.255.255',
      '223.255.255.255',
    ]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it('is true for private IPv6 addresses in both dotted and hextet forms', () => {
    for (const address of [
      '::',
      '::1',
      'fe80::1',
      'FE80::1',
      'fc00::1',
      'fd12:3456::1',
      'ff02::1',
      '::ffff:10.0.0.1',
      '::ffff:169.254.169.254',
      '::ffff:a00:1',
      '::ffff:a9fe:a9fe',
      '::ffff:c0a8:0101',
      '0:0:0:0:0:ffff:7f00:1',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it('is false for public IPv6 addresses, mapped or native', () => {
    for (const address of [
      '2606:4700:4700::1111',
      '2001:4860:4860::8888',
      '::ffff:8.8.8.8',
      '::ffff:808:808',
    ]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it('refuses anything that is not an IP address at all', () => {
    for (const value of ['', 'example.com', '999.999.999.999', '10.0.0', 'fg80::1', '::ffff:zz']) {
      expect(isPrivateAddress(value), value).toBe(true);
    }
  });
});

describe('assertSafeUrl', () => {
  it('resolves a public IP literal without touching DNS', async () => {
    const result = await assertSafeUrl('https://8.8.8.8/feed.xml');
    expect(result.url.hostname).toBe('8.8.8.8');
    expect(result.addresses).toEqual(['8.8.8.8']);
  });

  it('returns no addresses when private networks are allowed, skipping resolution', async () => {
    const result = await assertSafeUrl('http://localhost:8080/feed', {
      allowPrivateNetworks: true,
    });
    expect(result.url.hostname).toBe('localhost');
    expect(result.addresses).toEqual([]);
  });

  it('rejects on shape before it would ever resolve a hostname', async () => {
    await expect(assertSafeUrl('http://metadata.google.internal/')).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(assertSafeUrl('http://[::ffff:10.0.0.1]/')).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(assertSafeUrl('file:///etc/passwd')).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a private IP literal without a lookup', async () => {
    await expect(assertSafeUrl('http://10.0.0.1/')).rejects.toBeInstanceOf(ValidationError);
  });
});
