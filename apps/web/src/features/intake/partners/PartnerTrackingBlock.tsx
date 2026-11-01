import { ExternalLink, Handshake } from 'lucide-react';
import { useI18n } from '@/i18n';
import '../i18n';

export interface PartnerTrackingInfo {
  name: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  handedAt: string | null;
}

/** Customer tracking page: "Delivered by <partner>" with the partner's own tracking link. */
export function PartnerTrackingBlock({ tracking }: { tracking: { partner?: PartnerTrackingInfo | null; status: string } }) {
  const { t } = useI18n();
  const p = tracking.partner;
  if (!p) return null;
  return (
    <section className="flex items-center gap-4 rounded-3xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 to-sky-700 text-white"><Handshake className="h-6 w-6" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-ink-500">{tracking.status === 'DELIVERED' ? t('intake.track.deliveredBy') : t('intake.track.deliveringBy')}</p>
        <p className="font-display text-lg font-bold text-ink-900 dark:text-white">{p.name}</p>
        {p.trackingNumber && <p className="text-sm text-ink-500">{t('intake.track.partnerNumber')} <span className="ltr font-mono">{p.trackingNumber}</span></p>}
      </div>
      {p.trackingUrl && (
        <a href={p.trackingUrl} target="_blank" rel="noreferrer noopener" className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-ink-200 px-3 text-sm font-semibold text-ink-800 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-100 dark:hover:bg-ink-800">
          {t('intake.track.openPartner')}<ExternalLink className="h-4 w-4" />
        </a>
      )}
    </section>
  );
}
