import { useState } from 'react';
import { CheckCircle2, ExternalLink, Handshake, RotateCcw, Send, XCircle } from 'lucide-react';
import type { OrderStatus } from '@goturtle/shared';
import { useAuth } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui';
import { HandoffModal } from './HandoffQueue';
import { OutcomeModal } from './PartnerShipments';
import { usePartners, type Outcome } from './data';
import '../i18n';

export interface HandoffOrder {
  id: string;
  trackingNumber: string;
  status: OrderStatus;
  collectCents: number;
  courier: { code: string } | null;
  partnerCarrierId?: string | null;
  partnerTrackingNumber?: string | null;
  handedToPartnerAt?: string | null;
}

const trackingUrl = (template: string | null, tn: string | null | undefined) =>
  template && tn ? (template.includes('{tn}') ? template.split('{tn}').join(encodeURIComponent(tn)) : `${template}${encodeURIComponent(tn)}`) : null;

/** Ops order page: hand a parcel at the hub to a partner, or record what the partner did with it. */
export function PartnerHandoffPanel({ order }: { order: HandoffOrder }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const partners = usePartners(order.status === 'RECEIVED_AT_HUB' || !!order.partnerCarrierId);
  const [handoff, setHandoff] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  if (!can('dispatch.manage') || !partners.data) return null;
  const partner = partners.data.find((p) => p.id === order.partnerCarrierId);
  const withPartner = !!partner && !!order.courier && order.courier.code === partner.courier?.code;
  const active = partners.data.filter((p) => p.isActive);
  if (!withPartner && !(order.status === 'RECEIVED_AT_HUB' && active.length) && !partner) return null;
  const url = trackingUrl(partner?.trackingUrlTemplate ?? null, order.partnerTrackingNumber);
  const open = withPartner && ['OUT_FOR_DELIVERY', 'FAILED_ATTEMPT', 'RESCHEDULED', 'RETURN_PENDING'].includes(order.status);

  return (
    <section className="rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900">
      <h3 className="mb-3 flex items-center gap-2 font-semibold text-ink-900 dark:text-white"><Handshake className="h-4 w-4 text-turtle-600" />{t('intake.pt.panel.title')}</h3>
      {partner ? (
        <div className="space-y-2 text-sm">
          <p className="font-medium">{partner.name} {!withPartner && <span className="text-xs text-ink-500">· {t('intake.pt.panel.back')}</span>}</p>
          <p className="flex flex-wrap items-center gap-1 text-ink-600 dark:text-ink-300">
            {t('intake.pt.c.waybill')}:{' '}
            {url ? <a href={url} target="_blank" rel="noreferrer" className="ltr inline-flex items-center gap-1 font-mono text-turtle-700 hover:underline dark:text-turtle-400">{order.partnerTrackingNumber}<ExternalLink className="h-3 w-3" /></a> : <span className="ltr font-mono">{order.partnerTrackingNumber ?? '—'}</span>}
          </p>
          {order.handedToPartnerAt && <p className="text-xs text-ink-500">{t('intake.pt.panel.handedAt', { at: dateTime(order.handedToPartnerAt) })}</p>}
          {open && (
            <div className="flex flex-wrap gap-2 pt-2">
              {order.status !== 'RETURN_PENDING' && <Button size="sm" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setOutcome('DELIVERED')}>{t('intake.pt.outcome.DELIVERED')}</Button>}
              {order.status !== 'RETURN_PENDING' && <Button size="sm" variant="outline" icon={<XCircle className="h-4 w-4" />} onClick={() => setOutcome('FAILED')}>{t('intake.pt.outcome.FAILED')}</Button>}
              <Button size="sm" variant="outline" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setOutcome('RETURNED')}>{t('intake.pt.outcome.RETURNED')}</Button>
            </div>
          )}
        </div>
      ) : null}
      {!withPartner && order.status === 'RECEIVED_AT_HUB' && active.length > 0 && (
        <div className={partner ? 'mt-3 space-y-3 border-t border-ink-100 pt-3 dark:border-ink-800' : 'space-y-3'}>
          <p className="text-sm text-ink-500">{t('intake.pt.panel.hint')}</p>
          <Button size="sm" icon={<Send className="h-4 w-4" />} onClick={() => setHandoff(true)}>{t('intake.pt.panel.cta')}</Button>
        </div>
      )}
      <HandoffModal open={handoff} orders={[order]} partners={partners.data} onClose={() => setHandoff(false)} onDone={() => setHandoff(false)} />
      {partner && <OutcomeModal partner={partner} outcome={outcome} shipments={[order]} onClose={() => setOutcome(null)} onDone={() => setOutcome(null)} />}
    </section>
  );
}
