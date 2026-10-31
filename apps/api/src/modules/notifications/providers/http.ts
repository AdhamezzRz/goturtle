/**
 * Small fetch wrapper for outbound provider calls (SMS gateways, e-mail APIs,
 * Shopify, Paymob): hard timeout via AbortController, body read once, JSON
 * parsed when possible. Never throws for HTTP status codes — callers decide.
 */
export interface HttpResult {
  status: number;
  ok: boolean;
  text: string;
  json: unknown;
  headers: Headers;
}

export class HttpTimeoutError extends Error {
  constructor(url: string, ms: number) {
    super(`Request to ${new URL(url).host} timed out after ${ms} ms`);
  }
}

export async function fetchWithTimeout(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string | URLSearchParams; timeoutMs?: number } = {},
): Promise<HttpResult> {
  const timeoutMs = init.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: init.headers,
      body: init.body,
      signal: controller.signal,
      redirect: 'manual',
    });
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { status: res.status, ok: res.status >= 200 && res.status < 300, text, json, headers: res.headers };
  } catch (err) {
    if (controller.signal.aborted) throw new HttpTimeoutError(url, timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Reads a required environment variable for a provider (fails the send, not the boot). */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

/** First N characters of a provider response, for error messages. */
export const snippet = (text: string, n = 300) => (text.length > n ? `${text.slice(0, n)}…` : text);

/**
 * Runs `fn` over `items` with bounded concurrency and a wall-clock budget:
 * no new item is started once `budgetMs` has elapsed (jobs must stay well
 * under Hostinger's 120 s limit). Returns the items that were not started.
 */
export async function mapWithBudget<T>(items: T[], opts: { concurrency: number; budgetMs: number }, fn: (item: T) => Promise<void>): Promise<T[]> {
  const started = Date.now();
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(opts.concurrency, queue.length)) }, async () => {
    while (queue.length && Date.now() - started < opts.budgetMs) {
      const item = queue.shift()!;
      await fn(item);
    }
  });
  await Promise.all(workers);
  return queue;
}
