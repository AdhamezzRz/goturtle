import type { AttemptDisputeStatus, ConfirmationStatus } from '@goturtle/shared';
import { MapPin, MapPinOff, PhoneCall } from 'lucide-react';
import { Badge } from '@/components/ui';
import { useI18n } from '@/i18n';
import { num } from '@/lib/format';
import { CONFIRMATION_TONE, DISPUTE_TONE, holdKey } from './types';
import './i18n';

export function ConfirmationBadge({ status, className }: { status: ConfirmationStatus; className?: string }) {
  const { t } = useI18n();
  return <Badge tone={CONFIRMATION_TONE[status] ?? 'neutral'} dot className={className}>{t(`integrity.conf.${status}`)}</Badge>;
}

export function HoldBadge({ reason, className }: { reason: string | null | undefined; className?: string }) {
  const { t } = useI18n();
  return <Badge tone={reason === 'PREPAY_REQUIRED' ? 'cash' : 'warning'} dot className={className}>{t(holdKey(reason))}</Badge>;
}

export function DisputeBadge({ status }: { status: AttemptDisputeStatus }) {
  const { t } = useI18n();
  return <Badge tone={DISPUTE_TONE[status] ?? 'neutral'}>{t(`integrity.dispute.${status}`)}</Badge>;
}

/** Hero distance from the pin at the moment of a failed attempt, green inside the geofence. */
export function DistanceChip({ meters, allowed }: { meters: number | null | undefined; allowed?: number | null }) {
  const { t } = useI18n();
  if (meters == null) {
    return <Badge tone="neutral"><MapPinOff className="h-3 w-3" />{t('integrity.noPin')}</Badge>;
  }
  const ok = allowed == null || allowed <= 0 || meters <= allowed;
  return (
    <Badge tone={ok ? 'success' : 'danger'}>
      <MapPin className="h-3 w-3" />
      <span className="ltr">{t('integrity.meters', { m: num(meters) })}</span>
    </Badge>
  );
}

export function CallsChip({ n }: { n: number }) {
  const { t } = useI18n();
  return <Badge tone={n > 0 ? 'info' : 'danger'}><PhoneCall className="h-3 w-3" />{t('integrity.calls', { n: num(n) })}</Badge>;
}

/** 0–100 integrity score bar. */
export function ScoreBar({ value }: { value: number }) {
  const tone = value >= 80 ? 'bg-turtle-500' : value >= 60 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex min-w-[96px] items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(4, Math.min(100, value))}%` }} />
      </div>
      <span className="ltr w-8 text-end text-sm font-bold tabular-nums">{value}</span>
    </div>
  );
}
