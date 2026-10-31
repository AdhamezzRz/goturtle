import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { guardedLookup, isPrivateAddress } from './url-guard';

export interface SendOutcome {
  ok: boolean;
  status: number | null;
  /** First 2 KB of the response body. */
  body: string | null;
  error: string | null;
  durationMs: number;
}

const MAX_STORED_BODY = 2048;
const MAX_READ_BYTES = 64 * 1024;

/**
 * POSTs one webhook. Uses node:http(s) (not fetch) so the SSRF-guarded DNS
 * lookup runs on the actual connection. Never follows redirects (a 3xx is a
 * failure) and never throws — the outcome describes what happened.
 */
export function postWebhook(
  rawUrl: string,
  body: string,
  headers: Record<string, string>,
  opts: { timeoutMs?: number; allowPrivate: boolean },
): Promise<SendOutcome> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 10_000;
  return new Promise<SendOutcome>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const done = (o: Omit<SendOutcome, 'durationMs'>) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ ...o, durationMs: Date.now() - started });
    };
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return done({ ok: false, status: null, body: null, error: 'Invalid URL' });
    }
    // IP literals skip DNS (and therefore the guarded lookup): check them here.
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!opts.allowPrivate && isIP(host) && isPrivateAddress(host)) {
      return done({ ok: false, status: null, body: null, error: 'Refusing to connect to a non-public address' });
    }
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
        lookup: guardedLookup(opts.allowPrivate),
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          if (size < MAX_READ_BYTES) chunks.push(chunk);
          size += chunk.length;
          if (size >= MAX_READ_BYTES) res.destroy();
        });
        const finish = () => {
          const status = res.statusCode ?? 0;
          const text = Buffer.concat(chunks).toString('utf8').slice(0, MAX_STORED_BODY);
          const ok = status >= 200 && status < 300;
          done({ ok, status, body: text, error: ok ? null : status >= 300 && status < 400 ? `Redirect (${status}) is not followed` : `HTTP ${status}` });
        };
        res.on('end', finish);
        res.on('close', finish);
        res.on('error', finish);
      },
    );
    timer = setTimeout(() => {
      req.destroy(new Error(`Timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    req.on('error', (err) => done({ ok: false, status: null, body: null, error: err.message.slice(0, 1000) }));
    req.end(body);
  });
}
