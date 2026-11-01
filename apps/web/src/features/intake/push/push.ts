import { api } from '@/lib/api';

/**
 * Browser side of Web Push: service-worker registration, permission and the
 * PushSubscription ↔ /push/subscribe round trip.
 */
export type PushSupport = 'supported' | 'unsupported' | 'ios-needs-install';

export function isIos() {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function pushSupport(): PushSupport {
  const base = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  // iOS / iPadOS 16.4+ only exposes push to web apps added to the home screen.
  if (isIos() && !isStandalone()) return 'ios-needs-install';
  return base ? 'supported' : 'unsupported';
}

export function permission(): NotificationPermission | 'unsupported' {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (!existing) await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'supported') return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export interface ServerKey {
  enabled: boolean;
  publicKey: string | null;
}

export class PushError extends Error {
  constructor(public readonly code: 'DENIED' | 'DISABLED' | 'UNSUPPORTED', message: string) {
    super(message);
  }
}

/** Asks for permission (must run from a user gesture), subscribes and registers the device. */
export async function enablePush(): Promise<void> {
  if (pushSupport() !== 'supported') throw new PushError('UNSUPPORTED', 'Push is not supported on this browser');
  const key = await api<ServerKey>('/push/public-key', { auth: 'none' });
  if (!key.enabled || !key.publicKey) throw new PushError('DISABLED', 'Push notifications are not configured on the server');
  const result = await Notification.requestPermission();
  if (result !== 'granted') throw new PushError('DENIED', 'Notifications are blocked for this site');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  const wanted = urlBase64ToUint8Array(key.publicKey);
  // A subscription made with another VAPID key (keys rotated) must be replaced.
  if (sub && sub.options.applicationServerKey && !sameKey(new Uint8Array(sub.options.applicationServerKey), wanted)) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted });
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api('/push/subscribe', { method: 'POST', body: { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } } });
}

/** Re-registers an existing subscription (idempotent upsert); failures are ignored. */
export async function resync(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return;
  await api('/push/subscribe', { method: 'POST', body: { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } } }).catch(() => undefined);
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('/push/subscribe', { method: 'DELETE', body: { endpoint: sub.endpoint } }).catch(() => undefined);
  await sub.unsubscribe();
}

function sameKey(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
