import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, CalendarDays, Check, PhoneCall, Send, ShieldOff, Unlock, X } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ago, cairoToday, dateOnly, money, phone } from '@/lib/format';
import { useQueryState } from '@/lib/hooks';
import { errorMessage, useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { Badge, Button, ConfirmDialog, DataTable, EmptyState, Field, Input, Modal, Pagination, RiskBadge, Select, StatusBadge, Textarea } from '@/components/ui';
import { CallButton, SearchInput, Segmented } from '@/portals/ops/components/opsa/ui';
import { ConfirmationBadge, HoldBadge } from '../shared';
import { HOLD_REASONS, type IntegrityOrderRow } from '../types';

const addDay = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const useIsManager = () => {
  const { me } = useAuth();
  return me?.role === 'OPS_MANAGER' || me?.role === 'SUPER_ADMIN';
};

function invalidateIntegrity(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['integrity'] });
  void qc.invalidateQueries({ queryKey: ['order'] });
}

function OrderCell({ o }: { o: IntegrityOrderRow }) {
  return (
    <div className="min-w-0">
      <Link to={`/ops/orders/${o.id}`} className="font-mono text-sm font-semibold text-turtle-700 hover:underline dark:text-turtle-400"><span className="ltr">{o.trackingNumber}</span></Link>
      <p className="truncate text-xs text-ink-500">{o.brand.name}</p>
    </div>
  );
}

function RecipientCell({ o }: { o: IntegrityOrderRow }) {
  const { t } = useI18n();
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium">{o.recipientName}</p>
      <p className="flex flex-wrap items-center gap-1 text-xs text-ink-500">
        <span className="ltr">{phone(o.recipientPhone)}</span>
        {o.customer.isBlocked && <Badge tone="danger">{t('integrity.blocked')}</Badge>}
        {o.customer.requirePrepayment && <Badge tone="cash">{t('integrity.prepayOnly')}</Badge>}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Holds
// ---------------------------------------------------------------------------

export function HoldsTab() {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const manager = useIsManager();
  const qc = useQueryClient();
  const [s, setS] = useQueryState({ reason: '', q: '', page: '1' });
  const [action, setAction] = useState<{ kind: 'release' | 'cancel' | 'override'; o: IntegrityOrderRow } | null>(null);
  const [text, setText] = useState('');
  const q = useQuery({
    queryKey: ['integrity', 'holds', s],
    queryFn: () => api<Paginated<IntegrityOrderRow>>('/integrity/holds', { query: { reason: s.reason || undefined, q: s.q || undefined, page: s.page, pageSize: 20 } }),
  });
  const run = useMutation({
    mutationFn: () => {
      const a = action!;
      if (a.kind === 'release') return api(`/integrity/holds/${a.o.id}/release`, { method: 'POST', body: { note: text.trim() || undefined } });
      if (a.kind === 'cancel') return api(`/integrity/holds/${a.o.id}/cancel`, { method: 'POST', body: { note: text.trim() } });
      return api(`/integrity/holds/${a.o.id}/override`, { method: 'POST', body: { reason: text.trim() } });
    },
    onSuccess: () => {
      toast.success(t(action?.kind === 'release' ? 'integrity.released' : action?.kind === 'cancel' ? 'integrity.cancelled' : 'integrity.overridden'));
      setAction(null);
      invalidateIntegrity(qc);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const open = (kind: 'release' | 'cancel' | 'override', o: IntegrityOrderRow) => {
    setText('');
    setAction({ kind, o });
  };
  const actions = (o: IntegrityOrderRow) => (
    <div className="flex flex-wrap justify-end gap-1.5">
      {can('orders.update') && <Button size="xs" variant="outline" icon={<Unlock className="h-3.5 w-3.5" />} onClick={() => open('release', o)}>{t('integrity.release')}</Button>}
      {manager && <Button size="xs" variant="outline" icon={<ShieldOff className="h-3.5 w-3.5" />} onClick={() => open('override', o)}>{t('integrity.override')}</Button>}
      {can('orders.status') && <Button size="xs" variant="ghost" className="text-red-600 dark:text-red-400" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => open('cancel', o)}>{t('integrity.cancelHold')}</Button>}
    </div>
  );
  const textValid = action?.kind === 'release' ? true : action?.kind === 'cancel' ? text.trim().length >= 3 : text.trim().length >= 5;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput value={s.q} onChange={(v) => setS({ q: v })} placeholder={t('integrity.search')} className="sm:max-w-sm sm:flex-1" />
        <Select
          aria-label={t('integrity.col.reason')}
          className="sm:w-60"
          value={s.reason}
          onChange={(e) => setS({ reason: e.target.value })}
          options={[{ value: '', label: t('integrity.allReasons') }, ...[...HOLD_REASONS, 'MANUAL'].map((r) => ({ value: r, label: t(`integrity.hold.${r}`) }))]}
        />
      </div>
      <DataTable
        rows={q.data?.data}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        rowKey={(o) => o.id}
        empty={<EmptyState icon={<Unlock className="h-6 w-6" />} title={t('integrity.emptyHolds')} description={t('integrity.emptyHoldsHint')} />}
        columns={[
          { key: 'o', header: t('integrity.col.order'), cell: (o) => <OrderCell o={o} /> },
          { key: 'r', header: t('integrity.col.recipient'), cell: (o) => <RecipientCell o={o} /> },
          { key: 'h', header: t('integrity.col.reason'), cell: (o) => <div className="space-y-1"><HoldBadge reason={o.holdReason} /><p className="text-xs text-ink-500">{o.heldAt ? ago(o.heldAt) : ago(o.updatedAt)}</p></div> },
          { key: 'risk', header: t('integrity.col.risk'), hideBelow: 'lg', cell: (o) => <RiskBadge score={o.riskScore} /> },
          { key: 'cod', header: t('integrity.col.cod'), hideBelow: 'lg', cell: (o) => <span className="ltr font-semibold text-sand-700 dark:text-sand-300">{o.paymentMethod === 'COD' ? money(o.collectCents) : '—'}</span> },
          { key: 'c', header: t('integrity.col.status'), hideBelow: 'xl', cell: (o) => <ConfirmationBadge status={o.confirmationStatus} /> },
          { key: 'a', header: <span className="sr-only">{t('integrity.col.actions')}</span>, align: 'end', cell: actions },
        ]}
        mobileCard={(o) => (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2"><OrderCell o={o} /><HoldBadge reason={o.holdReason} /></div>
            <RecipientCell o={o} />
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
              <RiskBadge score={o.riskScore} />
              {o.paymentMethod === 'COD' && <span className="ltr font-semibold text-sand-700 dark:text-sand-300">{money(o.collectCents)}</span>}
              <span>{ago(o.heldAt ?? o.updatedAt)}</span>
              <span className="text-ink-400">{locale === 'ar' ? o.zone.nameAr : o.zone.nameEn}</span>
            </div>
            {actions(o)}
          </div>
        )}
      />
      {q.data && q.data.meta.totalPages > 1 && <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={(p) => setS({ page: String(p) })} />}

      <ConfirmDialog
        open={!!action}
        onClose={() => setAction(null)}
        onConfirm={() => textValid && run.mutate()}
        loading={run.isPending}
        danger={action?.kind === 'cancel'}
        title={action?.kind === 'cancel' ? t('integrity.cancelTitle', { tn: action.o.trackingNumber }) : action?.kind === 'override' ? t('integrity.overrideTitle', { tn: action.o.trackingNumber }) : t('integrity.release')}
        description={action?.kind === 'cancel' ? t('integrity.cancelDesc') : action?.kind === 'override' ? t('integrity.overrideDesc') : action ? t(`integrity.hold.${action.o.holdReason ?? 'MANUAL'}`) : undefined}
        confirmLabel={action?.kind === 'cancel' ? t('integrity.cancelHold') : action?.kind === 'override' ? t('integrity.override') : t('integrity.release')}
      >
        <Field label={action?.kind === 'override' ? t('integrity.reasonLabel') : t('integrity.noteLabel')} required={action?.kind !== 'release'}>
          {(id) => <Textarea id={id} rows={3} maxLength={action?.kind === 'override' ? 300 : 500} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
      </ConfirmDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Pending confirmations
// ---------------------------------------------------------------------------

type ConfFilter = 'open' | 'NO_RESPONSE' | 'PENDING' | 'DECLINED';

export function ConfirmationsTab() {
  const { t } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [s, setS] = useQueryState({ cs: 'open', q: '', page: '1' });
  const [record, setRecord] = useState<IntegrityOrderRow | null>(null);
  const q = useQuery({
    queryKey: ['integrity', 'confirmations', s],
    queryFn: () => api<Paginated<IntegrityOrderRow> & { holdThreshold: number }>('/integrity/confirmations', { query: { status: s.cs === 'open' ? undefined : s.cs, q: s.q || undefined, page: s.page, pageSize: 20 } }),
  });
  const resend = useMutation({
    mutationFn: (id: string) => api(`/integrity/confirmations/${id}/resend`, { method: 'POST', body: {} }),
    onSuccess: () => { toast.success(t('integrity.resent')); invalidateIntegrity(qc); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const actions = (o: IntegrityOrderRow) => (
    <div className="flex flex-wrap justify-end gap-1.5">
      <CallButton value={o.recipientPhone} name={o.recipientName} />
      {can('orders.update') && o.confirmationStatus !== 'DECLINED' && (
        <>
          <Button size="xs" variant="outline" icon={<PhoneCall className="h-3.5 w-3.5" />} onClick={() => setRecord(o)}>{t('integrity.record')}</Button>
          <Button size="xs" variant="ghost" icon={<Send className="h-3.5 w-3.5" />} loading={resend.isPending && resend.variables === o.id} onClick={() => resend.mutate(o.id)}>{t('integrity.resend')}</Button>
        </>
      )}
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <Segmented<ConfFilter>
          value={s.cs as ConfFilter}
          onChange={(v) => setS({ cs: v })}
          options={[
            { value: 'open', label: t('integrity.tab.confirmations') },
            { value: 'NO_RESPONSE', label: t('integrity.conf.NO_RESPONSE') },
            { value: 'DECLINED', label: t('integrity.conf.DECLINED') },
          ]}
        />
        <SearchInput value={s.q} onChange={(v) => setS({ q: v })} placeholder={t('integrity.search')} className="lg:max-w-sm lg:flex-1" />
      </div>
      <DataTable
        rows={q.data?.data}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        rowKey={(o) => o.id}
        empty={<EmptyState icon={<Check className="h-6 w-6" />} title={t('integrity.emptyConfirmations')} />}
        columns={[
          { key: 'o', header: t('integrity.col.order'), cell: (o) => <OrderCell o={o} /> },
          { key: 'r', header: t('integrity.col.recipient'), cell: (o) => <RecipientCell o={o} /> },
          { key: 's', header: t('integrity.col.status'), cell: (o) => <div className="flex flex-wrap gap-1"><ConfirmationBadge status={o.confirmationStatus} />{o.blocksDispatch && <Badge tone="danger">{t('integrity.blocksDispatch')}</Badge>}</div> },
          { key: 'asked', header: t('integrity.col.asked'), hideBelow: 'lg', cell: (o) => <span className="text-xs text-ink-500">{o.confirmationRequestedAt ? ago(o.confirmationRequestedAt) : '—'}</span> },
          { key: 'risk', header: t('integrity.col.risk'), hideBelow: 'md', cell: (o) => <RiskBadge score={o.riskScore} /> },
          { key: 'st', header: t('common.status'), hideBelow: 'xl', cell: (o) => <StatusBadge status={o.status} /> },
          { key: 'a', header: <span className="sr-only">{t('integrity.col.actions')}</span>, align: 'end', cell: actions },
        ]}
        mobileCard={(o) => (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2"><OrderCell o={o} /><ConfirmationBadge status={o.confirmationStatus} /></div>
            <RecipientCell o={o} />
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
              <RiskBadge score={o.riskScore} />
              {o.blocksDispatch && <Badge tone="danger">{t('integrity.blocksDispatch')}</Badge>}
              {o.confirmationRequestedAt && <span>{ago(o.confirmationRequestedAt)}</span>}
            </div>
            {actions(o)}
          </div>
        )}
      />
      {q.data && q.data.meta.totalPages > 1 && <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={(p) => setS({ page: String(p) })} />}
      <RecordAnswerModal order={record} onClose={() => setRecord(null)} />
    </div>
  );
}

/** Staff called the customer: record confirm / new day / decline. Also used on the order detail. */
export function RecordAnswerModal({ order, onClose }: { order: Pick<IntegrityOrderRow, 'id' | 'recipientName'> | null; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [action, setAction] = useState<'CONFIRM' | 'RESCHEDULE' | 'DECLINE'>('CONFIRM');
  const [date, setDate] = useState(addDay(cairoToday(), 1));
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/integrity/confirmations/${order!.id}/record`, { method: 'POST', body: { action, date: action === 'RESCHEDULE' ? date : undefined, note: note.trim() || undefined } }),
    onSuccess: () => { toast.success(t('integrity.recorded')); invalidateIntegrity(qc); onClose(); setNote(''); setAction('CONFIRM'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const opts: Array<{ v: typeof action; icon: ReactNode; tone: string }> = [
    { v: 'CONFIRM', icon: <Check className="h-4 w-4" />, tone: 'ring-turtle-500 bg-turtle-50 text-turtle-800 dark:bg-turtle-950 dark:text-turtle-200' },
    { v: 'RESCHEDULE', icon: <CalendarDays className="h-4 w-4" />, tone: 'ring-sky-500 bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200' },
    { v: 'DECLINE', icon: <X className="h-4 w-4" />, tone: 'ring-red-500 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200' },
  ];
  return (
    <Modal
      open={!!order}
      onClose={onClose}
      title={order ? t('integrity.recordTitle', { name: order.recipientName }) : ''}
      footer={<><Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button loading={m.isPending} variant={action === 'DECLINE' ? 'danger' : 'primary'} onClick={() => m.mutate()}>{t('action.save')}</Button></>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {opts.map((o) => (
            <button key={o.v} type="button" aria-pressed={action === o.v} onClick={() => setAction(o.v)} className={cn('flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl p-2 text-sm font-semibold ring-2 transition', action === o.v ? o.tone : 'bg-white text-ink-700 ring-ink-100 dark:bg-ink-800 dark:text-ink-200 dark:ring-ink-700')}>
              {o.icon}{t(`integrity.answer.${o.v}`)}
            </button>
          ))}
        </div>
        {action === 'RESCHEDULE' && (
          <Field label={t('integrity.newDay')} hint={dateOnly(date)}>
            {(id) => <Input id={id} type="date" value={date} min={addDay(cairoToday(), 1)} max={addDay(cairoToday(), 7)} onChange={(e) => setDate(e.target.value)} />}
          </Field>
        )}
        <Field label={t('integrity.noteLabel')}>{(id) => <Textarea id={id} rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}
