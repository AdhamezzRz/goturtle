import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Flashlight, Keyboard, X } from 'lucide-react';
import { isValidTrackingNumber, normalizeTrackingNumber } from '@goturtle/shared';
import { cn } from '@/lib/cn';
import { useI18n } from '@/i18n';

interface DetectorLike {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
}
type DetectorCtor = { new (opts?: { formats: string[] }): DetectorLike; getSupportedFormats?: () => Promise<string[]> };

/** Camera scanning is available (Chrome/Android, Safari 17+ with the flag…). */
export const cameraScanSupported = () => typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

/** Pulls a GoTurtle tracking number out of a scanned value (raw code, AWB QR URL…). */
export function extractTrackingNumber(raw: string): string | null {
  const direct = normalizeTrackingNumber(raw);
  if (isValidTrackingNumber(direct)) return direct;
  const m = raw.toUpperCase().match(/GT\s?\d{10}/);
  if (m) {
    const tn = normalizeTrackingNumber(m[0]);
    if (isValidTrackingNumber(tn)) return tn;
  }
  return null;
}

export type ScanFeedback = { code: string; ok: boolean; message: string; at: number } | null;

/** Full-screen camera scanner using the native BarcodeDetector. */
export function Scanner({ open, onClose, onCode, feedback, count }: { open: boolean; onClose: () => void; onCode: (trackingNumber: string) => void; feedback: ScanFeedback; count: number }) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [torch, setTorch] = useState<boolean | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recent = useRef(new Map<string, number>());
  const handler = useRef(onCode);
  handler.current = onCode;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: number | undefined;
    setError(null);
    (async () => {
      try {
        const Ctor = (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector;
        const wanted = ['code_128', 'qr_code', 'code_39', 'ean_13', 'data_matrix'];
        const supported = (await Ctor.getSupportedFormats?.()) ?? wanted;
        const detector = new Ctor({ formats: wanted.filter((f) => supported.includes(f)) });
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
        if (cancelled) {
          s.getTracks().forEach((tr) => tr.stop());
          return;
        }
        stream.current = s;
        const track = s.getVideoTracks()[0];
        const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
        setTorch(caps.torch ? false : null);
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => undefined);
        }
        const tick = async () => {
          if (cancelled || !video.current || video.current.readyState < 2) {
            timer = window.setTimeout(tick, 250);
            return;
          }
          try {
            const codes = await detector.detect(video.current);
            for (const c of codes) {
              const tn = extractTrackingNumber(c.rawValue);
              if (!tn) continue;
              const last = recent.current.get(tn) ?? 0;
              if (Date.now() - last < 4000) continue;
              recent.current.set(tn, Date.now());
              handler.current(tn);
            }
          } catch {
            /* frame not ready */
          }
          timer = window.setTimeout(tick, 200);
        };
        void tick();
      } catch (e) {
        const name = (e as Error).name;
        setError(name === 'NotAllowedError' ? t('hero.scan.cameraDenied') : t('hero.scan.cameraError'));
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stream.current?.getTracks().forEach((tr) => tr.stop());
      stream.current = null;
    };
  }, [open, t]);

  // Re-render when a feedback banner expires.
  const [, force] = useState(0);
  useEffect(() => {
    if (!feedback) return;
    const id = window.setTimeout(() => force((x) => x + 1), 2600);
    return () => window.clearTimeout(id);
  }, [feedback]);

  const toggleTorch = async () => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      setTorch(null);
    }
  };

  if (!open) return null;
  const fresh = feedback && Date.now() - feedback.at < 2500 ? feedback : null;
  return createPortal(
    <div className="fixed inset-0 z-[55] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={t('hero.scan.title')}>
      <video ref={video} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
      <div className="relative flex items-center justify-between gap-2 p-4 pt-[max(env(safe-area-inset-top),1rem)]">
        <button type="button" onClick={onClose} aria-label={t('action.close')} className="grid h-12 w-12 place-items-center rounded-full bg-black/50">
          <X className="h-6 w-6" />
        </button>
        <span className="rounded-full bg-black/50 px-4 py-2 text-sm font-bold">{t('hero.scan.count', { n: count })}</span>
        {torch !== null ? (
          <button type="button" onClick={toggleTorch} aria-label={t('hero.scan.torch')} aria-pressed={torch} className={cn('grid h-12 w-12 place-items-center rounded-full', torch ? 'bg-sand-400 text-ink-950' : 'bg-black/50')}>
            <Flashlight className="h-6 w-6" />
          </button>
        ) : (
          <span className="w-12" />
        )}
      </div>
      <div className="relative flex flex-1 items-center justify-center">
        <div className={cn('h-44 w-[78%] max-w-sm rounded-3xl border-4 transition-colors', fresh ? (fresh.ok ? 'border-turtle-400' : 'border-red-500') : 'border-white/80')} />
        {error && <p className="absolute inset-x-6 rounded-2xl bg-black/70 p-4 text-center text-sm font-semibold">{error}</p>}
      </div>
      <div className="relative space-y-3 p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
        <div className={cn('flex min-h-[64px] items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold', fresh ? (fresh.ok ? 'bg-turtle-600' : 'bg-red-600') : 'bg-black/60')}>
          {fresh ? (
            <>
              {fresh.ok ? <Check className="h-6 w-6 shrink-0" /> : <X className="h-6 w-6 shrink-0" />}
              <span className="min-w-0">
                <span className="ltr block font-mono text-base">{fresh.code}</span>
                <span className="block text-xs opacity-90">{fresh.message}</span>
              </span>
            </>
          ) : (
            <span className="w-full text-center">{t('hero.scan.aim')}</span>
          )}
        </div>
        <button type="button" onClick={onClose} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white/15 font-bold">
          <Keyboard className="h-5 w-5" /> {t('hero.scan.manual')}
        </button>
      </div>
    </div>,
    document.body,
  );
}
