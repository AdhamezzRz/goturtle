import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import { ARCH_CENTERLINE, ARCH_PATH, ARCH_VIEWBOX, WORDMARK_PATHS, WORDMARK_VIEWBOX } from './geometry';

export { BRAND_COLORS } from './geometry';

/**
 * The official "go turtle" wordmark (vector paths from the brand book), painted with
 * `currentColor` — set the colour with a text-* class and the size with h-* (width follows).
 * Always Latin, also in Arabic UI: it is the logo, not a translatable string.
 */
export function Wordmark({ className, title = 'go turtle', style }: { className?: string; title?: string; style?: CSSProperties }) {
  return (
    <svg viewBox={WORDMARK_VIEWBOX} className={cn('block h-7 w-auto shrink-0', className)} style={style} fill="currentColor" role="img" aria-label={title}>
      <title>{title}</title>
      {WORDMARK_PATHS.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

/** The arch — "turtle + delivery" shell — on its own (currentColor). */
export function ArchMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox={ARCH_VIEWBOX} className={cn('block h-6 w-6 shrink-0', className)} fill="currentColor" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      {title && <title>{title}</title>}
      <path d={ARCH_PATH} />
    </svg>
  );
}

/** App-icon tile: lime arch on deep green (or inverted). */
export function ArchTile({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-[28%]', inverted ? 'bg-lime-300 text-turtle-600' : 'bg-turtle-600 text-lime-300', className)} aria-hidden>
      <ArchMark className="h-[62%] w-[62%]" />
    </span>
  );
}

const STROKE = 24.87;

/**
 * Brand loader: the arch draws itself and hands over, like a parcel travelling from
 * pickup to door. Respects prefers-reduced-motion (static arch).
 */
export function ArchLoader({ className, label }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-label={label ?? 'Loading'} className={cn('inline-block h-10 w-10 text-turtle-600 dark:text-lime-300', className)}>
      <svg viewBox={ARCH_VIEWBOX} className="h-full w-full" fill="none" aria-hidden>
        <path d={ARCH_CENTERLINE} stroke="currentColor" strokeOpacity={0.14} strokeWidth={STROKE} />
        <path
          d={ARCH_CENTERLINE}
          pathLength={100}
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeDasharray="100"
          className="animate-arch-draw motion-reduce:animate-none"
          style={{ ['--arch-len' as string]: '100' } as CSSProperties}
        />
      </svg>
    </span>
  );
}

/** Full-screen brand splash used while a portal's code is loading. */
export function BrandSplash({ label }: { label?: string }) {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="flex flex-col items-center gap-4">
        <ArchLoader className="h-14 w-14" label={label} />
        <Wordmark className="h-6 text-ink-950/80 dark:text-white/80" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- arch progress

/** Lengths of the arch centre line: left leg, half circle, right leg (200-unit box). */
const LEG = 80.49;
const R = 83.12;
const ARC = Math.PI * R;
const TOTAL = LEG * 2 + ARC;
const CX = 100;
const CY = 107.54;

/** Point on the arch centre line at fraction t (0 = bottom of the left leg, 1 = bottom of the right leg). */
export function archPoint(t: number): { x: number; y: number } {
  const d = Math.min(Math.max(t, 0), 1) * TOTAL;
  if (d <= LEG) return { x: CX - R, y: CY + LEG - d };
  if (d <= LEG + ARC) {
    const theta = Math.PI - (d - LEG) / R;
    return { x: CX + R * Math.cos(theta), y: CY - R * Math.sin(theta) };
  }
  return { x: CX + R, y: CY + (d - LEG - ARC) };
}

/**
 * The signature tracking visual: the brand arch as a journey from pickup (left foot) to the
 * customer's door (right foot). Milestones sit on the arch; the parcel travels along it.
 */
export function ArchProgress({
  progress,
  steps,
  tone = 'brand',
  surface = 'light',
  mirror,
  className,
  live,
}: {
  /** 0 … 1 along the journey. */
  progress: number;
  /** Milestone positions (0 … 1) with done flags. */
  steps: Array<{ at: number; done: boolean }>;
  tone?: 'brand' | 'warn' | 'danger' | 'muted';
  /** `dark`: drawn on a green / coloured panel (white track, lime progress). */
  surface?: 'light' | 'dark';
  /** Journey runs right → left (Arabic). */
  mirror?: boolean;
  className?: string;
  /** Pulse the parcel (out for delivery). */
  live?: boolean;
}) {
  const p = Math.min(Math.max(progress, 0), 1);
  const head = archPoint(p);
  const onDark = surface === 'dark';
  const color = onDark
    ? tone === 'warn' ? '#fcc94d' : '#DBE64C'
    : tone === 'danger' ? '#dc2626' : tone === 'warn' ? '#f5930b' : tone === 'muted' ? '#8791a8' : '#00804C';
  return (
    <svg viewBox="-14 -10 228 214" className={cn('block w-full overflow-visible', className)} fill="none" aria-hidden>
      <g transform={mirror ? 'translate(200 0) scale(-1 1)' : undefined}>
        <path d={ARCH_CENTERLINE} stroke="currentColor" className={onDark ? 'text-white/20' : 'text-ink-100 dark:text-ink-800'} strokeWidth={STROKE} />
        <path
          d={ARCH_CENTERLINE}
          pathLength={1}
          stroke={color}
          strokeWidth={STROKE}
          strokeDasharray={`${p} 1`}
          className="animate-arch-in transition-[stroke-dasharray] duration-1000 ease-out motion-reduce:animate-none"
          style={{ ['--arch-len' as string]: String(p) } as CSSProperties}
        />
        {steps.map((s, i) => {
          const pt = archPoint(s.at);
          const fill = s.done ? (onDark ? '#02291a' : '#DBE64C') : onDark ? 'rgba(255,255,255,.55)' : '#ffffff';
          return <circle key={i} cx={pt.x} cy={pt.y} r={5.2} fill={fill} />;
        })}
        <g transform={`translate(${head.x} ${head.y})`}>
          {live && <circle r={24} fill={color} opacity={0.35} className="animate-ping [transform-box:fill-box] [transform-origin:center]" />}
          <circle r={18} fill={onDark ? '#DBE64C' : '#DBE64C'} stroke={onDark ? '#02291a' : color} strokeWidth={4.5} />
          <path d="M-7.5 -4.5 0 -8.5 7.5 -4.5 7.5 4.5 0 8.5 -7.5 4.5Z M-7.5 -4.5 0 -0.5 7.5 -4.5 M0 -0.5 0 8.5" stroke="#080C19" strokeWidth={2.2} strokeLinejoin="round" fill="none" />
        </g>
      </g>
    </svg>
  );
}
