import { HttpStatus } from '@nestjs/common';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { DomainError } from '../../common/errors';

/**
 * SSRF protection for outbound webhooks.
 *
 * In production a webhook URL must be https, must not carry credentials and
 * its host must resolve only to public unicast addresses. The same check runs
 * again at connection time (`guardedLookup` is passed to http(s).request), so a
 * DNS record that later flips to an internal IP (DNS rebinding) is refused too.
 * Outside production http:// and private/loopback hosts are allowed so local
 * receivers work in development and tests.
 */
const blocked = new BlockList();
const V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (cloud metadata 169.254.169.254)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];
const V6: Array<[string, number]> = [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['::ffff:0:0', 96], // IPv4-mapped (checked against the v4 list instead)
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard-only
  ['2001::', 23], // IETF protocol assignments (Teredo, ORCHID …)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4 (can embed private IPv4)
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
];
for (const [net, prefix] of V4) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of V6) blocked.addSubnet(net, prefix, 'ipv6');

/** True for loopback, private, link-local, reserved and other non-public addresses (and for non-IPs). */
export function isPrivateAddress(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, '').split('%')[0];
  const family = isIP(addr);
  if (family === 4) return blocked.check(addr, 'ipv4');
  if (family === 6) {
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(addr);
    if (mapped) return isPrivateAddress(mapped[1]);
    return blocked.check(addr, 'ipv6');
  }
  return true;
}

export type Resolver = (hostname: string) => Promise<string[]>;

const systemResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) =>
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses: LookupAddress[]) => (err ? reject(err) : resolve(addresses.map((a) => a.address)))),
  );

const INTERNAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.intranet', '.corp'];

export interface UrlGuardOptions {
  /** Enforce https + public addresses. Default: NODE_ENV === 'production'. */
  production?: boolean;
  /** DNS resolver (injectable for tests). */
  resolve?: Resolver;
}

const invalid = (message: string) => new DomainError('INVALID_WEBHOOK_URL', message, HttpStatus.BAD_REQUEST);

/** Validates a webhook URL and returns it normalised. Throws INVALID_WEBHOOK_URL. */
export async function validateWebhookUrl(raw: string, opts: UrlGuardOptions = {}): Promise<string> {
  const production = opts.production ?? process.env.NODE_ENV === 'production';
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw invalid('Enter a valid absolute URL');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !production)) {
    throw invalid(production ? 'Webhook URLs must use https://' : 'Webhook URLs must use http:// or https://');
  }
  if (url.username || url.password) throw invalid('Webhook URLs must not contain credentials');
  if (url.href.length > 500) throw invalid('URL is too long (max 500 characters)');
  url.hash = '';
  if (!production) return url.toString();

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || INTERNAL_SUFFIXES.some((s) => host.endsWith(s))) throw invalid('Webhook URLs must point to a public host');
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw invalid('Webhook URLs must not point to private, loopback or link-local addresses');
    return url.toString();
  }
  let addresses: string[];
  try {
    addresses = await (opts.resolve ?? systemResolver)(host);
  } catch {
    throw invalid(`Host ${host} does not resolve`);
  }
  if (!addresses.length) throw invalid(`Host ${host} does not resolve`);
  if (addresses.some(isPrivateAddress)) throw invalid('Webhook URLs must not resolve to private, loopback or link-local addresses');
  return url.toString();
}

/**
 * `lookup` for http(s).request that refuses private addresses at connect time
 * (defeats DNS rebinding between validation and delivery).
 */
export function guardedLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
      if (err) return (callback as (e: NodeJS.ErrnoException | null, a: string | LookupAddress[], f?: number) => void)(err, '', 4);
      const list = addresses ?? [];
      if (!allowPrivate && (!list.length || list.some((a) => isPrivateAddress(a.address)))) {
        const e = Object.assign(new Error(`Refusing to connect to ${hostname}: resolves to a non-public address`), { code: 'EBLOCKED' });
        return (callback as (e: NodeJS.ErrnoException | null, a: string | LookupAddress[], f?: number) => void)(e, '', 4);
      }
      if ((options as { all?: boolean }).all) return (callback as (e: null, a: LookupAddress[]) => void)(null, list);
      const first = list[0];
      return (callback as (e: null, a: string, f: number) => void)(null, first.address, first.family);
    });
  };
}
