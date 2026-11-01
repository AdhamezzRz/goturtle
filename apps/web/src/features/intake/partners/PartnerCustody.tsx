import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, Banknote, HandCoins, Receipt, Scale, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime, money, num, parseEgp } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Button, Card, ErrorState, Field, Input, KpiCard, Modal, Select, Skeleton, StateBadge } from '@/components/ui';
import type { Custody, Partner } from '../types';
import '../i18n';

const METHODS = ['BANK_TRANSFER', 'INSTAPAY', 'VODAFONE_CASH', 'CASH_AT_HUB', 'FAWRY'] as const;

/** What the partner owes us (COD custody) vs. what we owe them (fees), and remittances as cash handovers. */
export function PartnerCustody({ partner }: { partner: Partner }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['partners', partner.id, 'custody'], queryFn: () => api<Custody>(`/partners/${partner.id}/custody`), enabled: can('cash.read') });
  const [remit, setRemit] = useState(false);
  if (!can('cash.read')) return <Card><p className="text-sm text-ink-500">{t('intake.pt.noCashPerm')}</p></Card>;
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const c = q.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={t('intake.pt.k.custody')} value={money(c.custodyCents)} hint={t('intake.pt.k.custodyHint')} icon={<Wallet className="h-5 w-5" />} tone="sand" />
        <KpiCard label={t('intake.pt.k.fees')} value={money(c.feesPayableCents)} hint={t('intake.pt.k.feesHint')} icon={<Receipt className="h-5 w-5" />} tone="violet" />
        <KpiCard label={t('intake.pt.k.net')} value={money(c.netOwedToUsCents)} hint={t('intake.pt.k.netHint')} icon={<Scale className="h-5 w-5" />} tone={c.netOwedToUsCents >= 0 ? 'turtle' : 'red'} />
        <KpiCard label={t('intake.pt.k.unremitted')} value={num(c.unremittedOrders.count)} hint={money(c.unremittedOrders.collectedCents)} icon={<HandCoins className="h-5 w-5" />} tone="sky" />
      </div>
      <Card>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-ink-900 dark:text-white">{t('intake.pt.remittances')}</h3>
            <p className="text-sm text-ink-500">{t('intake.pt.remittancesHint', { code: c.courierCode })}</p>
          </div>
          <div className="flex gap-2">
            <Link to={`/ops/cash?tab=handovers&courierId=${c.courierId}`}><Button variant="outline" size="sm">{t('intake.pt.openCash')}</Button></Link>
            {can('cash.manage') && <Button size="sm" icon={<ArrowDownToLine className="h-4 w-4" />} disabled={c.custodyCents <= 0} onClick={() => setRemit(true)}>{t('intake.pt.recordRemit')}</Button>}
          </div>
        </div>
        {c.pendingHandovers.count > 0 && <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">{t('intake.pt.pending', { n: num(c.pendingHandovers.count), amount: money(c.pendingHandovers.declaredCents) })}</p>}
        {!c.recentHandovers.length ? <p className="text-sm text-ink-500">{t('intake.pt.noRemittances')}</p> : (
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {c.recentHandovers.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="ltr text-start font-mono text-sm font-semibold">{h.code}</p>
                  <p className="text-xs text-ink-500">{t(`intake.method.${h.method}`)}{h.reference ? <> · <span className="ltr">{h.reference}</span></> : null} · {dateTime(h.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2"><StateBadge value={h.status} /><span className="ltr text-sm font-semibold">{money(h.status === 'CONFIRMED' ? h.receivedCents : h.declaredCents)}</span></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <RemitModal open={remit} custody={c} onClose={() => setRemit(false)} />
    </div>
  );
}

function RemitModal({ open, custody, onClose }: { open: boolean; custody: Custody; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<(typeof METHODS)[number]>('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!open) return;
    setAmount(String(custody.custodyCents / 100));
    setMethod('BANK_TRANSFER');
    setReference('');
    setNotes('');
    setTouched(false);
  }, [open, custody.custodyCents]);
  const cents = parseEgp(amount);
  const errors = {
    amount: !cents || cents <= 0 ? t('intake.pt.err.amount') : cents > custody.custodyCents ? t('intake.pt.err.overCustody') : undefined,
    reference: method !== 'CASH_AT_HUB' && !reference.trim() ? t('intake.pt.err.reference') : undefined,
  };
  const m = useMutation({
    mutationFn: () => api('/cash/handovers', { method: 'POST', body: { courierId: custody.courierId, amountCents: cents, method, ...(reference.trim() ? { reference: reference.trim() } : {}), notes: notes.trim() || `Remittance from ${custody.partner.name}` } }),
    onSuccess: () => {
      toast.success(t('intake.pt.remitted.ok'));
      qc.invalidateQueries({ queryKey: ['partners'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('intake.pt.recordRemit')}
      description={t('intake.pt.remitHint', { partner: custody.partner.name })}
      footer={<><Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button variant="cash" icon={<Banknote className="h-4 w-4" />} loading={m.isPending} onClick={() => { setTouched(true); if (!errors.amount && !errors.reference) m.mutate(); }}>{t('intake.pt.confirmRemit')}</Button></>}
    >
      <div className="space-y-4">
        <Field label={t('common.amount')} required error={touched ? errors.amount : undefined} hint={t('intake.pt.maxCustody', { amount: money(custody.custodyCents) })}>
          {(id) => <Input id={id} inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} trailing={<span className="text-xs">{t('common.egp')}</span>} />}
        </Field>
        <Field label={t('intake.pt.method')}>{(id) => <Select id={id} value={method} onChange={(e) => setMethod(e.target.value as (typeof METHODS)[number])} options={METHODS.map((m) => ({ value: m, label: t(`intake.method.${m}`) }))} />}</Field>
        <Field label={t('intake.pt.transferRef')} required={method !== 'CASH_AT_HUB'} error={touched ? errors.reference : undefined}>{(id) => <Input id={id} dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} />}</Field>
        <Field label={t('common.notes')}>{(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />}</Field>
      </div>
    </Modal>
  );
}
