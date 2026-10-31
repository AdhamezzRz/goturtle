import { Link } from 'react-router-dom';
import { Clock, KeyRound, MapPin, Package, Store, Undo2, Warehouse } from 'lucide-react';
import type { OrderStatus } from '@goturtle/shared';
import { cn } from '@/lib/cn';
import { timeOnly } from '@/lib/format';
import { useI18n } from '@/i18n';
import { Badge, StatusBadge } from '@/components/ui';
import { Money } from './kit';
import type { CarriedParcel, Pickup, TodayStop } from '../types';

const DONE: OrderStatus[] = ['DELIVERED', 'RETURNED'];
const FAILED: OrderStatus[] = ['FAILED_ATTEMPT', 'RESCHEDULED', 'RETURN_PENDING', 'RETURN_OUT', 'CANCELLED', 'LOST', 'DAMAGED'];

export function stopTone(status: OrderStatus, isOpen: boolean): 'open' | 'done' | 'failed' | 'other' {
  if (isOpen) return 'open';
  if (DONE.includes(status)) return 'done';
  if (FAILED.includes(status)) return 'failed';
  return 'other';
}

export function SeqBubble({ seq, tone, size = 'md' }: { seq: number | null; tone: ReturnType<typeof stopTone>; size?: 'md' | 'lg' }) {
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-display font-extrabold tabular',
        size === 'lg' ? 'h-14 w-14 text-2xl' : 'h-10 w-10 text-base',
        tone === 'open' && 'bg-violet-600 text-white',
        tone === 'done' && 'bg-turtle-100 text-turtle-700 dark:bg-turtle-950 dark:text-turtle-300',
        tone === 'failed' && 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
        tone === 'other' && 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300',
      )}
    >
      {seq ?? '·'}
    </span>
  );
}

export function StopRow({ stop, highlight }: { stop: TodayStop; highlight?: boolean }) {
  const { t, pick } = useI18n();
  const tone = stopTone(stop.status, stop.isOpen);
  return (
    <Link
      to={`/hero/stops/${stop.orderId}`}
      className={cn(
        'flex items-center gap-3 rounded-2xl border bg-white p-3 shadow-card transition active:scale-[.99] dark:bg-ink-900',
        highlight ? 'border-violet-300 ring-2 ring-violet-200 dark:border-violet-700 dark:ring-violet-900' : 'border-ink-100 dark:border-ink-800',
        !stop.isOpen && 'opacity-75',
      )}
    >
      <SeqBubble seq={stop.seq} tone={tone} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-bold text-ink-900 dark:text-white">{stop.recipientName}</p>
          {stop.deliveryOtpRequired && stop.isOpen && <KeyRound className="h-4 w-4 shrink-0 text-violet-600" aria-label={t('hero.stop.otp')} />}
        </div>
        <p className="truncate text-sm text-ink-500">{stop.address}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={stop.status} />
          <Badge tone="neutral"><MapPin className="h-3 w-3" /> {pick(stop.zone, 'name')}</Badge>
          {stop.isOpen && stop.eta && (
            <Badge tone="info"><Clock className="h-3 w-3" /> <span className="ltr">{timeOnly(stop.eta)}</span></Badge>
          )}
        </div>
      </div>
      <div className="shrink-0 text-end">
        {stop.collectCents > 0 ? (
          <>
            <Money cents={stop.collectCents} className={cn('font-display text-base font-extrabold', stop.isOpen ? 'text-sand-700 dark:text-sand-300' : 'text-ink-500')} />
            <p className="text-[11px] font-semibold text-ink-400">{t('hero.cod')}</p>
          </>
        ) : (
          <Badge tone="success">{t('hero.prepaid')}</Badge>
        )}
      </div>
    </Link>
  );
}

export function PickupRow({ pickup }: { pickup: Pickup }) {
  const { t, pick } = useI18n();
  const active = pickup.status === 'ASSIGNED' || pickup.status === 'IN_PROGRESS';
  return (
    <Link
      to={`/hero/pickups/${pickup.id}`}
      className={cn('flex items-center gap-3 rounded-2xl border border-sky-100 bg-white p-3 shadow-card active:scale-[.99] dark:border-sky-950 dark:bg-ink-900', !active && 'opacity-75')}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
        <Store className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold text-ink-900 dark:text-white">{pickup.brand.name}</p>
        <p className="truncate text-sm text-ink-500">{pickup.location?.name ?? pickup.location?.addressLine}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge tone={pickup.status === 'IN_PROGRESS' ? 'progress' : pickup.status === 'COMPLETED' ? 'success' : pickup.status === 'FAILED' ? 'danger' : 'info'} dot>
            {t(`hero.pickup.status.${pickup.status}`)}
          </Badge>
          {pickup.timeWindow && <Badge tone="neutral"><Clock className="h-3 w-3" /> <span className="ltr">{pickup.timeWindow}</span></Badge>}
          {pickup.zone && <Badge tone="neutral"><MapPin className="h-3 w-3" /> {pick(pickup.zone, 'name')}</Badge>}
        </div>
      </div>
      <div className="shrink-0 text-end">
        <p className="font-display text-lg font-extrabold text-ink-900 dark:text-white">
          <span className="ltr tabular">{pickup.scannedCount}/{pickup.ordersCount || pickup.expectedCount || 0}</span>
        </p>
        <p className="flex items-center justify-end gap-1 text-[11px] font-semibold text-ink-400"><Package className="h-3 w-3" /> {t('hero.pickup.parcels')}</p>
      </div>
    </Link>
  );
}

export function ReturnRow({ parcel }: { parcel: CarriedParcel }) {
  const { t, pick } = useI18n();
  const toBrand = parcel.destination === 'BRAND';
  return (
    <Link to={`/hero/stops/${parcel.orderId}`} className="flex items-center gap-3 rounded-2xl border border-ink-100 bg-white p-3 shadow-card active:scale-[.99] dark:border-ink-800 dark:bg-ink-900">
      <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-full', toBrand ? 'bg-sand-100 text-sand-800' : 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200')}>
        {toBrand ? <Undo2 className="h-5 w-5" /> : <Warehouse className="h-5 w-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold text-ink-900 dark:text-white">{parcel.recipientName}</p>
        <p className="truncate text-sm text-ink-500">
          {parcel.brand.name} · <span className="ltr">{parcel.trackingNumber}</span>
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <Badge tone={toBrand ? 'warning' : 'neutral'}>{toBrand ? t('hero.returns.toBrand') : t('hero.returns.toHub')}</Badge>
          <Badge tone="neutral">{pick(parcel.statusLabel)}</Badge>
        </div>
      </div>
      {(parcel.canStartReturn || parcel.canMarkReturned) && (
        <span className="shrink-0 rounded-full bg-sand-400 px-3 py-1.5 text-xs font-bold text-ink-950">
          {parcel.canMarkReturned ? t('hero.returns.handBack') : t('hero.returns.start')}
        </span>
      )}
    </Link>
  );
}
