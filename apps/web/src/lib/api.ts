/**
 * API client for the GoTurtle REST API (/api/v1).
 * - Bearer access token kept in memory + localStorage (per session kind).
 * - Transparent refresh on 401 with a single in-flight refresh (rotation-safe).
 * - Errors normalised to ApiError { status, code, message, details }.
 */
export const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type SessionKind = 'user' | 'customer';
const KEY = { user: 'gt.session', customer: 'gt.customer' } as const;

export interface UserSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}
export interface CustomerSession {
  accessToken: string;
  expiresAt: string;
  customer: { phone: string; name: string; id: string | null };
  trackingNumber?: string | null;
}

const read = <T,>(kind: SessionKind): T | null => {
  try {
    const raw = localStorage.getItem(KEY[kind]);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

export const sessionStore = {
  user: () => read<UserSession>('user'),
  customer: () => {
    const s = read<CustomerSession>('customer');
    if (s && new Date(s.expiresAt).getTime() < Date.now()) {
      localStorage.removeItem(KEY.customer);
      return null;
    }
    return s;
  },
  setUser(s: UserSession | null) {
    if (s) localStorage.setItem(KEY.user, JSON.stringify(s));
    else localStorage.removeItem(KEY.user);
    listeners.forEach((l) => l());
  },
  setCustomer(s: CustomerSession | null) {
    if (s) localStorage.setItem(KEY.customer, JSON.stringify(s));
    else localStorage.removeItem(KEY.customer);
    listeners.forEach((l) => l());
  },
};

const listeners = new Set<() => void>();
export const onSessionChange = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

let refreshing: Promise<boolean> | null = null;

async function refreshUserSession(): Promise<boolean> {
  const current = sessionStore.user();
  if (!current?.refreshToken) return false;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: current.refreshToken }),
        });
        if (!res.ok) {
          sessionStore.setUser(null);
          return false;
        }
        const body = (await res.json()) as UserSession;
        sessionStore.setUser({ accessToken: body.accessToken, refreshToken: body.refreshToken, expiresAt: body.expiresAt });
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => (refreshing = null), 0);
      }
    })();
  }
  return refreshing;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined | Array<string | number>>;
  /** Which token to send. Default: user session. */
  auth?: SessionKind | 'none';
  signal?: AbortSignal;
  /** Return the raw Response (downloads). */
  raw?: boolean;
}

export function buildQuery(query: RequestOptions['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((item) => params.append(k, String(item)));
    else params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const auth = opts.auth ?? 'user';
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = auth === 'user' ? sessionStore.user()?.accessToken : auth === 'customer' ? sessionStore.customer()?.accessToken : undefined;
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}${buildQuery(opts.query)}`, { method: opts.method ?? 'GET', headers, body, signal: opts.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Network error — check your connection');
  }

  if (res.status === 401 && auth === 'user' && !retried && sessionStore.user()?.refreshToken) {
    if (await refreshUserSession()) return api<T>(path, opts, true);
  }
  if (res.status === 401 && auth === 'customer') sessionStore.setCustomer(null);

  if (!res.ok) {
    let payload: { message?: string | string[]; code?: string; details?: unknown } = {};
    try {
      payload = await res.json();
    } catch {
      /* non-JSON error */
    }
    const message = Array.isArray(payload.message) ? payload.message.join(' · ') : payload.message ?? res.statusText;
    throw new ApiError(res.status, payload.code ?? (res.status === 422 ? 'VALIDATION' : String(res.status)), message, payload.details);
  }
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? await res.json() : await res.text()) as T;
}

/** Downloads a file from an authenticated endpoint (CSV exports, statements). */
export async function download(path: string, filename: string, query?: RequestOptions['query']) {
  const res = await api<Response>(path, { query, raw: true });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Uploads a file to /files and returns its public URL. */
export async function uploadFile(file: File, purpose: string): Promise<{ id: string; url: string }> {
  const form = new FormData();
  form.append('file', file);
  return api('/files', { method: 'POST', body: form, query: { purpose } });
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}
