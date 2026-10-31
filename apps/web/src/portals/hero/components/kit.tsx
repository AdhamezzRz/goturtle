import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Camera, Check, ChevronLeft, ChevronRight, Eraser, ImagePlus, LoaderCircle, RefreshCw, Trash2, WifiOff, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { money } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Button } from '@/components/ui';
import { canvasToFile, uploadPhoto } from '../lib/media';

// ---------------------------------------------------------------- text helpers

export function Money({ cents, className, sign }: { cents: number | null | undefined; className?: string; sign?: boolean }) {
  return <span className={cn('ltr tabular inline-block', className)}>{money(cents, { sign })}</span>;
}

export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('ltr inline-block', className)}>{children}</span>;
}

export function SectionTitle({ children, action, count }: { children: ReactNode; action?: ReactNode; count?: number }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between gap-2 px-1">
      <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400">
        {children}
        {count !== undefined && <span className="rounded-full bg-ink-200/70 px-2 py-0.5 text-[11px] text-ink-700 dark:bg-ink-800 dark:text-ink-200">{count}</span>}
      </h2>
      {action}
    </div>
  );
}

export function Panel({ className, children, as: As = 'div' }: { className?: string; children: ReactNode; as?: 'div' | 'section' }) {
  return <As className={cn('rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900', className)}>{children}</As>;
}

/** Back link + title row at the top of detail pages. */
export function PageTop({ to = '/hero', title, subtitle, end }: { to?: string; title: ReactNode; subtitle?: ReactNode; end?: ReactNode }) {
  const { t, dir } = useI18n();
  const Chevron = dir === 'rtl' ? ChevronRight : ChevronLeft;
  return (
    <div className="mb-4 flex items-center gap-2">
      <Link to={to} aria-label={t('action.back')} className="-ms-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800">
        <Chevron className="h-6 w-6" />
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-display text-xl font-bold text-ink-900 dark:text-white">{title}</h1>
        {subtitle && <div className="truncate text-xs text-ink-500">{subtitle}</div>}
      </div>
      {end}
    </div>
  );
}

export function RefreshButton({ onClick, spinning }: { onClick: () => void; spinning?: boolean }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('action.refresh')}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-500 hover:bg-ink-100 active:bg-ink-200 dark:hover:bg-ink-800"
    >
      <RefreshCw className={cn('h-5 w-5', spinning && 'animate-spin')} />
    </button>
  );
}

/** "You are offline" notice for money actions. */
export function OfflineBlock({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <div className={cn('flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900', className)}>
      <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
      {t('hero.offline.money')}
    </div>
  );
}

// ---------------------------------------------------------------- layout

function useNavHeight() {
  const [h, setH] = useState(76);
  useLayoutEffect(() => {
    const nav = document.querySelector('nav.safe-bottom') as HTMLElement | null;
    if (!nav) return;
    const update = () => setH(nav.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(nav);
    return () => ro.disconnect();
  }, []);
  return h;
}

/** Primary action area pinned above the tab bar (thumb zone). */
export function StickyBar({ children, className }: { children: ReactNode; className?: string }) {
  const navH = useNavHeight();
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(84);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver(() => setH(el.getBoundingClientRect().height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <>
      <div aria-hidden style={{ height: Math.max(0, h - 40) }} />
      <div
        ref={ref}
        className={cn('fixed inset-x-0 z-20 mx-auto max-w-lg bg-gradient-to-t from-ink-50 from-60% to-ink-50/0 px-4 pb-3 pt-6 dark:from-ink-950 dark:to-ink-950/0', className)}
        style={{ bottom: navH }}
      >
        {children}
      </div>
    </>
  );
}

function useLockScroll(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
}

/** Bottom sheet tuned for one-hand use: big header close, scrollable body, sticky footer. */
export function Sheet({ open, onClose, title, subtitle, children, footer, tall }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; tall?: boolean }) {
  const { t } = useI18n();
  useLockScroll(open);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
      <div className="absolute inset-0 animate-fade-in bg-ink-950/60 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cn('relative flex w-full max-w-lg animate-slide-up flex-col rounded-t-3xl bg-white shadow-pop dark:bg-ink-900', tall ? 'h-[92dvh]' : 'max-h-[92dvh]')}>
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-ink-200 dark:bg-ink-700" />
        <div className="flex items-start gap-3 px-5 pb-2 pt-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-bold text-ink-900 dark:text-white">{title}</h2>
            {subtitle && <div className="mt-0.5 text-sm text-ink-500">{subtitle}</div>}
          </div>
          <button onClick={onClose} aria-label={t('action.close')} className="-me-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800">
            <X className="h-6 w-6" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
        {footer && <div className="safe-bottom border-t border-ink-100 px-5 pt-3 dark:border-ink-800">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- visuals

export function ProgressRing({ value, size = 96, stroke = 10, children, tone = 'turtle' }: { value: number; size?: number; stroke?: number; children?: ReactNode; tone?: 'turtle' | 'sand' | 'red' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const color = { turtle: 'stroke-turtle-500', sand: 'stroke-sand-400', red: 'stroke-red-500' }[tone];
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" className="stroke-ink-100 dark:stroke-ink-800" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          className={cn(color, 'transition-[stroke-dashoffset] duration-700')}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

/** Half-circle gauge (cash vs limit). */
export function Gauge({ value, tone, children }: { value: number; tone: 'turtle' | 'sand' | 'red'; children?: ReactNode }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const r = 80;
  const len = Math.PI * r;
  const color = { turtle: 'stroke-turtle-500', sand: 'stroke-sand-400', red: 'stroke-red-500' }[tone];
  return (
    <div className="relative mx-auto w-full max-w-[240px]">
      <svg viewBox="0 0 200 110" className="w-full">
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" strokeWidth="16" strokeLinecap="round" className="stroke-ink-100 dark:stroke-ink-800" />
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" strokeWidth="16" strokeLinecap="round" className={cn(color, 'transition-[stroke-dashoffset] duration-700')} strokeDasharray={len} strokeDashoffset={len * (1 - v)} />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">{children}</div>
    </div>
  );
}

/** Big square action (Call / WhatsApp / Navigate). */
export function BigAction({ href, onClick, icon, label, tone = 'ink', external, disabled }: { href?: string; onClick?: () => void; icon: ReactNode; label: string; tone?: 'ink' | 'green' | 'whatsapp' | 'sky'; external?: boolean; disabled?: boolean }) {
  const tones = {
    ink: 'bg-ink-900 text-white dark:bg-ink-800',
    green: 'bg-turtle-600 text-white',
    whatsapp: 'bg-[#1fa855] text-white',
    sky: 'bg-sky-600 text-white',
  };
  const cls = cn(
    'flex min-h-[68px] flex-col items-center justify-center gap-1 rounded-2xl px-2 text-sm font-bold shadow-sm transition active:scale-[.97] [&>svg]:h-6 [&>svg]:w-6',
    tones[tone],
    disabled && 'pointer-events-none opacity-40',
  );
  if (href && !disabled)
    return (
      <a href={href} className={cls} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {icon}
        {label}
      </a>
    );
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {icon}
      {label}
    </button>
  );
}

/** Full-screen confirmation after an action; continues on its own. */
export function SuccessOverlay({ open, title, subtitle, tone = 'green', continueLabel, onContinue, autoMs = 2600, icon }: { open: boolean; title: ReactNode; subtitle?: ReactNode; tone?: 'green' | 'amber' | 'sky'; continueLabel: string; onContinue: () => void; autoMs?: number; icon?: ReactNode }) {
  const done = useRef(onContinue);
  done.current = onContinue;
  useEffect(() => {
    if (!open || !autoMs) return;
    const id = window.setTimeout(() => done.current(), autoMs);
    return () => window.clearTimeout(id);
  }, [open, autoMs]);
  if (!open) return null;
  const bg = { green: 'from-turtle-600 to-turtle-800', amber: 'from-amber-500 to-sand-700', sky: 'from-sky-600 to-sky-800' }[tone];
  return createPortal(
    <div className={cn('fixed inset-0 z-[60] flex animate-fade-in flex-col items-center justify-center bg-gradient-to-br px-8 text-center text-white', bg)} role="status" aria-live="assertive">
      <div className="grid h-28 w-28 animate-slide-up place-items-center rounded-full bg-white/20 ring-8 ring-white/10">
        {icon ?? <Check className="h-16 w-16" strokeWidth={3} />}
      </div>
      <p className="mt-6 font-display text-3xl font-extrabold">{title}</p>
      {subtitle && <div className="mt-2 max-w-xs whitespace-pre-line text-base text-white/85">{subtitle}</div>}
      <button type="button" onClick={() => done.current()} className="mt-10 h-14 w-full max-w-xs rounded-2xl bg-white text-lg font-bold text-ink-900 shadow-pop active:scale-[.98]">
        {continueLabel}
      </button>
      {autoMs > 0 && (
        <div className="mt-4 h-1 w-full max-w-xs overflow-hidden rounded-full bg-white/25">
          <div className="h-full origin-[left] bg-white/80 rtl:origin-[right]" style={{ animation: `gt-shrink ${autoMs}ms linear forwards` }} />
        </div>
      )}
      <style>{'@keyframes gt-shrink{from{transform:scaleX(1)}to{transform:scaleX(0)}}'}</style>
    </div>,
    document.body,
  );
}

/** Chips row for quick choices. */
export function Chips<T extends string>({ value, options, onChange, className }: { value: T | null; options: Array<{ value: T; label: ReactNode }>; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            'min-h-[44px] rounded-full px-4 text-sm font-semibold ring-1 ring-inset transition',
            value === o.value ? 'bg-turtle-600 text-white ring-turtle-600' : 'bg-white text-ink-700 ring-ink-200 hover:bg-ink-50 dark:bg-ink-900 dark:text-ink-200 dark:ring-ink-700',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- inputs

/** Camera photo → downscale → upload. Shows preview; reports busy state so forms can wait. */
export function PhotoInput({ purpose, value, onChange, onBusy, label, required }: { purpose: 'pod_photo' | 'attempt_photo' | 'handover_proof' | 'courier_document'; value: string | null; onChange: (url: string | null) => void; onBusy?: (b: boolean) => void; label: string; required?: boolean }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    setBusy(true);
    onBusy?.(true);
    try {
      onChange(await uploadPhoto(file, purpose));
    } catch (err) {
      toast.error(errorMessage(err));
      setPreview(null);
      onChange(null);
    } finally {
      setBusy(false);
      onBusy?.(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-ink-700 dark:text-ink-200">
        {label}
        {required ? <span className="ms-0.5 text-red-500">*</span> : <span className="ms-1 text-xs font-normal text-ink-400">({t('hero.optional')})</span>}
      </p>
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      {preview || value ? (
        <div className="relative overflow-hidden rounded-2xl ring-1 ring-ink-200 dark:ring-ink-700">
          <img src={preview ?? value ?? ''} alt={label} className="h-40 w-full object-cover" />
          {busy && (
            <div className="absolute inset-0 grid place-items-center bg-ink-950/50 text-sm font-semibold text-white">
              <span className="flex items-center gap-2"><LoaderCircle className="h-5 w-5 animate-spin" /> {t('hero.photo.uploading')}</span>
            </div>
          )}
          {!busy && (
            <div className="absolute end-2 top-2 flex gap-2">
              <button type="button" onClick={() => input.current?.click()} aria-label={t('hero.photo.retake')} className="grid h-11 w-11 place-items-center rounded-full bg-white/90 text-ink-800 shadow">
                <Camera className="h-5 w-5" />
              </button>
              <button type="button" onClick={() => { setPreview(null); onChange(null); }} aria-label={t('action.delete')} className="grid h-11 w-11 place-items-center rounded-full bg-white/90 text-red-600 shadow">
                <Trash2 className="h-5 w-5" />
              </button>
            </div>
          )}
          {!busy && value && (
            <span className="absolute bottom-2 start-2 inline-flex items-center gap-1 rounded-full bg-turtle-600 px-2.5 py-1 text-xs font-bold text-white">
              <Check className="h-3.5 w-3.5" /> {t('hero.photo.saved')}
            </span>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex h-24 w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-ink-200 text-sm font-semibold text-ink-500 hover:border-turtle-400 hover:text-turtle-700 dark:border-ink-700"
        >
          <ImagePlus className="h-7 w-7" />
          {t('hero.photo.take')}
        </button>
      )}
    </div>
  );
}

export interface SignatureHandle {
  isEmpty: () => boolean;
  toFile: () => Promise<File>;
  clear: () => void;
}

/** Finger signature on a white pad → PNG. */
export const SignaturePad = forwardRef<SignatureHandle, { onInk?: (has: boolean) => void }>(function SignaturePad({ onInk }, ref) {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const inked = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = Math.round(rect.width * dpr);
    c.height = Math.round(rect.height * dpr);
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#13161e';
  }, []);

  const point = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const clear = () => {
    const c = canvas.current;
    if (!c) return;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    inked.current = false;
    onInk?.(false);
  };

  useImperativeHandle(ref, () => ({
    isEmpty: () => !inked.current,
    toFile: () => canvasToFile(canvas.current!, 'signature.png'),
    clear,
  }));

  return (
    <div>
      <div className="relative">
        <canvas
          ref={canvas}
          className="h-40 w-full touch-none rounded-2xl bg-white ring-1 ring-ink-200 dark:ring-ink-600"
          aria-label={t('hero.signature.area')}
          onPointerDown={(e) => {
            (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
            drawing.current = true;
            last.current = point(e);
          }}
          onPointerMove={(e) => {
            if (!drawing.current || !last.current) return;
            const ctx = canvas.current!.getContext('2d')!;
            const p = point(e);
            ctx.beginPath();
            ctx.moveTo(last.current.x, last.current.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            last.current = p;
            if (!inked.current) {
              inked.current = true;
              onInk?.(true);
            }
          }}
          onPointerUp={() => {
            drawing.current = false;
            last.current = null;
          }}
          onPointerCancel={() => {
            drawing.current = false;
          }}
        />
        <span className="pointer-events-none absolute inset-x-6 bottom-8 border-b border-dashed border-ink-300" />
      </div>
      <Button variant="ghost" size="sm" className="mt-1 h-11" icon={<Eraser className="h-4 w-4" />} onClick={clear}>
        {t('action.clear')}
      </Button>
    </div>
  );
});

// ---------------------------------------------------------------- misc hooks

/** Ticks every `ms` — for countdowns. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}
