import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { ValidationError } from './errors';

/**
 * SSRF protection for every outbound fetch the platform performs.
 *
 * The RSS connector fetches URLs that ultimately originate from user-editable
 * source configuration, so an unguarded fetch would let a user reach the
 * Docker-internal network — PostgreSQL, Redis, the API itself — or a cloud
 * metadata endpoint. The guard therefore validates twice:
 *
 *  1. the URL shape (protocol, credentials, port, obvious internal hostnames);
 *  2. every IP the hostname resolves to, immediately before the request.
 *
 * The second check is what defeats DNS entries that deliberately point at a
 * private address. A rebinding attack that flips the record between this check
 * and the socket connect is still theoretically possible; the connector
 * therefore also refuses redirects to a host it has not re-validated.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** Ports outside this set are refused outright. */
const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  // Compose service names used by this deployment.
  'postgres',
  'redis',
  'api',
  'web',
  'worker',
  'caddy',
]);

const BLOCKED_HOSTNAME_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain'];

export interface UrlGuardOptions {
  /**
   * Set to `false` in local development so that a developer can point the RSS
   * connector at a fixture server on their own machine. Never `false` in
   * production: the environment schema enforces it.
   */
  readonly allowPrivateNetworks?: boolean;
  readonly allowedProtocols?: ReadonlySet<string>;
}

/** Syntactic validation. Throws {@link ValidationError} when the URL is unsafe. */
export function assertSafeUrlShape(rawUrl: string, options: UrlGuardOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ValidationError('The provided URL is not a valid absolute URL.');
  }

  const protocols = options.allowedProtocols ?? ALLOWED_PROTOCOLS;
  if (!protocols.has(url.protocol)) {
    throw new ValidationError(`Unsupported URL protocol: ${url.protocol}`);
  }

  if (url.username !== '' || url.password !== '') {
    throw new ValidationError('URLs containing credentials are not allowed.');
  }

  const port = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port);
  if (!ALLOWED_PORTS.has(port)) {
    throw new ValidationError(`Requests to port ${port} are not allowed.`);
  }

  if (options.allowPrivateNetworks !== true) {
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (BLOCKED_HOSTNAMES.has(hostname)) {
      throw new ValidationError('Requests to internal hosts are not allowed.');
    }
    if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
      throw new ValidationError('Requests to internal hosts are not allowed.');
    }
    if (isIP(hostname) !== 0 && isPrivateAddress(hostname)) {
      throw new ValidationError('Requests to private network addresses are not allowed.');
    }
  }

  return url;
}

/**
 * Full validation: shape plus DNS resolution. Returns the parsed URL and the
 * addresses it resolved to, so a caller can pin the connection if it wants to.
 */
export async function assertSafeUrl(
  rawUrl: string,
  options: UrlGuardOptions = {},
): Promise<{ url: URL; addresses: string[] }> {
  const url = assertSafeUrlShape(rawUrl, options);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  if (options.allowPrivateNetworks === true) {
    return { url, addresses: [] };
  }

  if (isIP(hostname) !== 0) {
    return { url, addresses: [hostname] };
  }

  let records: { address: string }[];
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new ValidationError('The URL hostname could not be resolved.');
  }

  if (records.length === 0) {
    throw new ValidationError('The URL hostname could not be resolved.');
  }

  for (const record of records) {
    if (isPrivateAddress(record.address)) {
      throw new ValidationError('Requests to private network addresses are not allowed.');
    }
  }

  return { url, addresses: records.map((record) => record.address) };
}

/**
 * True for loopback, link-local, private, carrier-grade NAT, multicast,
 * reserved and unique-local addresses, plus the IPv4-mapped IPv6 forms of all
 * of them.
 */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address.toLowerCase());
  return true;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a = 0, b = 0] = parts;

  if (a === 0) return true; // "this" network
  if (a === 10) return true; // RFC 1918
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // RFC 6598 carrier-grade NAT
  if (a === 169 && b === 254) return true; // link-local, includes 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/** Matches the trailing dotted-quad of an IPv4-mapped or -compatible address. */
const IPV4_IN_IPV6 = /(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)$/;

function isPrivateIpv6(address: string): boolean {
  if (address === '::' || address === '::1') return true;
  if (address.startsWith('fe80')) return true; // link-local
  if (address.startsWith('fc') || address.startsWith('fd')) return true; // unique local
  if (address.startsWith('ff')) return true; // multicast

  // IPv4-mapped and IPv4-compatible forms, e.g. ::ffff:169.254.169.254
  const mapped = IPV4_IN_IPV6.exec(address);
  if (mapped?.[1]) return isPrivateIpv4(mapped[1]);

  return false;
}
