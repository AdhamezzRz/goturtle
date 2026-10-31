import { useEffect, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { AdjustmentType, HandoverMethod, type Permission } from '@goturtle/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { money, parseEgp } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Button, EmptyState, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { apiFieldErrors, enumOptions, useCourierOptions, useForm, useHubs } from './data';
import { InfoRow, Money, MoneyInput, Notice, UploadButton } from './ui';

/** Page-level permission gate with a friendly empty state. */
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth();
  const { t } = useI18n();
  if (!can(permission)) return <EmptyState icon={<ShieldOff className="h-7 w-7" />} title={t('ops.opsb.forbidden')} description={t('ops.opsb.forbiddenHint')} />;
  return <>{children}</>;
}

/** Hero picker (select) fed by the courier options query. */
export function CourierSelect({ id, value, onChange, invalid, placeholder, filter }: { id?: string; value: string; onChange: (v: string) => void; invalid?: boolean; placeholder?: string; filter?: (c: { status: string; employmentType: string }) => boolean }) {
  const { t } = useI18n();
  const q = useCourierOptions();
  const list = (q.data ?? []).filter((c) => (filter ? filter(c) : true));
  return (
    <Select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={invalid ? 'border-red-400' : undefined}
      placeholder={q.isLoading ? t('common.loading') : placeholder ?? t('ops.opsb.select')}
      options={list.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))}
    />
  );
}

/* ───────────────────────────── Record cash drop ───────────────────────────── */

const NON_CASH = new Set(['INSTAPAY', 'VODAFONE_CASH', 'BANK_TRANSFER', 'FAWRY']);

export function RecordHandoverModal({ open, onClose, courier, onDone }: {
  open: boolean; onClose: () => void; onDone?: () => void;
  /** Fixed hero (hero detail page); omitted → pick one. */
  courier?: { id: string; name: string; code: string; cashOnHandCents: number; homeHubId?: string | null };
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const hubs = useHubs();
  const heroes = useCourierOptions(open && !courier);
  const f = useForm({ courierId: courier?.id ?? '', amount: '', method: 'CASH_AT_HUB', hubId: courier?.homeHubId ?? '', reference: '', proofUrl: '', notes: '' });
  const { values, set, errors, setErrors, reset } = f;

  useEffect(() => {
    if (open) reset({ courierId: courier?.id ?? '', amount: courier ? String(courier.cashOnHandCents / 100) : '', method: 'CASH_AT_HUB', hubId: courier?.homeHubId ?? '', reference: '', proofUrl: '', notes: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, courier?.id]);

  const selected = courier ?? heroes.data?.find((c) => c.id === values.courierId);
  const onHand = selected?.cashOnHandCents ?? 0;
  const cents = parseEgp(values.amount);
  const remaining = onHand - (cents ?? 0);

  useEffect(() => {
    if (!courier && selected && 'homeHubId' in selected && !values.hubId && selected.homeHubId) set('hubId', selected.homeHubId);
  }, [courier, selected, values.hubId, set]);

  const m = useMutation({
    mutationFn: () =>
      api('/cash/handovers', {
        method: 'POST',
        body: {
          courierId: values.courierId,
          amountCents: cents,
          method: values.method,
          hubId: values.method === 'CASH_AT_HUB' ? values.hubId || undefined : undefined,
          reference: values.reference.trim() || undefined,
          proofUrl: values.proofUrl || undefined,
          notes: values.notes.trim() || undefined,
        },
      }),
    onSuccess: () => {
      toast.success(t('ops.opsb.handover.done'));
      qc.invalidateQueries({ queryKey: ['cash'] });
      qc.invalidateQueries({ queryKey: ['heroes'] });
      qc.invalidateQueries({ queryKey: ['opsb', 'courier-options'] });
      onDone?.();
      onClose();
    },
    onError: (err) => {
      const fe = apiFieldErrors(err, ['courierId', 'amountCents', 'reference', 'hubId'], { HANDOVER_EXCEEDS_CUSTODY: 'amountCents', REFERENCE_REQUIRED: 'reference', INVALID_HUB: 'hubId' });
      setErrors({ ...fe, amount: fe.amountCents });
      toast.error(errorMessage(err));
    },
  });

  const submit = () => {
    const e: Record<string, string | undefined> = {};
    if (!values.courierId) e.courierId = t('ops.opsb.required');
    if (!cents || cents <= 0) e.amount = t('ops.opsb.invalidAmount');
    else if (cents > onHand) e.amount = t('ops.opsb.handover.exceeds', { amount: money(onHand) });
    if (NON_CASH.has(values.method) && !values.reference.trim()) e.reference = t('ops.opsb.handover.referenceRequired');
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    m.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('ops.opsb.handover.title')}
      description={t('ops.opsb.handover.subtitle')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="cash" loading={m.isPending} onClick={submit}>{t('ops.opsb.handover.confirm', { amount: money(cents ?? 0) })}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {courier ? (
          <InfoRow label={t('ops.opsb.handover.hero')} value={<span>{courier.name} · <span className="ltr">{courier.code}</span></span>} />
        ) : (
          <Field label={t('ops.opsb.handover.hero')} required error={errors.courierId}>
            {(id) => <CourierSelect id={id} value={values.courierId} onChange={(v) => set('courierId', v)} invalid={!!errors.courierId} />}
          </Field>
        )}
        {selected && <InfoRow label={t('ops.opsb.handover.onHand')} value={<Money cents={onHand} className="font-semibold" />} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('ops.opsb.handover.amount')} required error={errors.amount}>
            {(id) => <MoneyInput id={id} value={values.amount} onChange={(v) => set('amount', v)} invalid={!!errors.amount} />}
          </Field>
          <Field label={t('ops.opsb.method')} required>
            {(id) => <Select id={id} value={values.method} onChange={(e) => set('method', e.target.value)} options={enumOptions('HandoverMethod', Object.values(HandoverMethod))} />}
          </Field>
        </div>
        {values.method === 'CASH_AT_HUB' ? (
          <Field label={t('common.hub')} error={errors.hubId}>
            {(id) => <Select id={id} value={values.hubId} onChange={(e) => set('hubId', e.target.value)} placeholder={t('ops.opsb.select')} options={(hubs.data ?? []).map((h) => ({ value: h.id, label: `${h.code} · ${h.name}` }))} />}
          </Field>
        ) : null}
        <Field label={t('ops.opsb.reference')} required={NON_CASH.has(values.method)} error={errors.reference}>
          {(id) => <Input id={id} dir="ltr" value={values.reference} onChange={(e) => set('reference', e.target.value)} invalid={!!errors.reference} maxLength={120} />}
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <UploadButton purpose="handover_proof" onUploaded={(file) => set('proofUrl', file.url)} label={values.proofUrl ? t('ops.opsb.replaceFile') : t('ops.opsb.chooseFile')} />
          {values.proofUrl && <a href={values.proofUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-turtle-700 hover:underline dark:text-turtle-400">{t('action.view')}</a>}
        </div>
        <Field label={t('common.notes')}>
          {(id) => <Textarea id={id} value={values.notes} onChange={(e) => set('notes', e.target.value)} maxLength={500} />}
        </Field>
        {cents !== null && cents > 0 && cents <= onHand && (
          <Notice tone={remaining > 0 ? 'info' : 'success'}>
            <InfoRow label={t('ops.opsb.handover.remaining')} value={<Money cents={remaining} className="font-semibold" />} />
          </Notice>
        )}
      </div>
    </Modal>
  );
}

/* ───────────────────────────── Adjustment ───────────────────────────── */

const CREDIT_TYPES = new Set(['BONUS', 'REIMBURSEMENT']);

export function AdjustmentModal({ open, onClose, courier, defaultType = 'BONUS', onDone }: {
  open: boolean; onClose: () => void; courier?: { id: string; name: string; code: string }; defaultType?: string; onDone?: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { values, set, errors, setErrors, reset } = useForm({ courierId: courier?.id ?? '', type: defaultType, amount: '', reason: '', orderId: '' });
  useEffect(() => {
    if (open) reset({ courierId: courier?.id ?? '', type: defaultType, amount: '', reason: '', orderId: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, courier?.id, defaultType]);
  const cents = parseEgp(values.amount);
  const credit = CREDIT_TYPES.has(values.type);

  const m = useMutation({
    mutationFn: () => api('/finance/adjustments', { method: 'POST', body: { courierId: values.courierId, type: values.type, amountCents: cents, reason: values.reason.trim(), orderId: values.orderId.trim() || undefined } }),
    onSuccess: () => {
      toast.success(t('ops.opsb.adj.done'));
      qc.invalidateQueries({ queryKey: ['finance'] });
      qc.invalidateQueries({ queryKey: ['heroes'] });
      onDone?.();
      onClose();
    },
    onError: (err) => {
      const fe = apiFieldErrors(err, ['courierId', 'amountCents', 'reason', 'orderId']);
      setErrors({ ...fe, amount: fe.amountCents });
      toast.error(errorMessage(err));
    },
  });

  const submit = () => {
    const e: Record<string, string | undefined> = {};
    if (!values.courierId) e.courierId = t('ops.opsb.required');
    if (!cents || cents <= 0) e.amount = t('ops.opsb.invalidAmount');
    if (values.reason.trim().length < 3) e.reason = t('ops.opsb.minChars', { n: 3 });
    setErrors(e);
    if (!Object.values(e).some(Boolean)) m.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('ops.opsb.adj.title')}
      description={t('ops.opsb.adj.subtitle')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant={credit ? 'primary' : 'danger'} loading={m.isPending} onClick={submit}>{t('ops.opsb.adj.confirm', { amount: money(credit ? cents ?? 0 : -(cents ?? 0), { sign: true }) })}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {courier ? (
          <InfoRow label={t('common.hero')} value={<span>{courier.name} · <span className="ltr">{courier.code}</span></span>} />
        ) : (
          <Field label={t('common.hero')} required error={errors.courierId}>
            {(id) => <CourierSelect id={id} value={values.courierId} onChange={(v) => set('courierId', v)} invalid={!!errors.courierId} />}
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('ops.opsb.type')} required>
            {(id) => <Select id={id} value={values.type} onChange={(e) => set('type', e.target.value)} options={enumOptions('AdjustmentType', Object.values(AdjustmentType))} />}
          </Field>
          <Field label={t('ops.opsb.adj.amount')} required error={errors.amount}>
            {(id) => <MoneyInput id={id} value={values.amount} onChange={(v) => set('amount', v)} invalid={!!errors.amount} />}
          </Field>
        </div>
        <Notice tone={credit ? 'success' : 'warning'}>
          {t('ops.opsb.adj.effect')}: <strong>{credit ? t('ops.opsb.adj.credit') : t('ops.opsb.adj.debit')}</strong>
          {cents ? <> · <Money cents={credit ? cents : -cents} sign className="font-semibold" /></> : null}
        </Notice>
        <Field label={t('ops.opsb.reason')} required error={errors.reason}>
          {(id) => <Textarea id={id} value={values.reason} onChange={(e) => set('reason', e.target.value)} maxLength={500} />}
        </Field>
        <Field label={t('ops.opsb.adj.orderId')} hint={t('ops.opsb.optional')} error={errors.orderId}>
          {(id) => <Input id={id} dir="ltr" value={values.orderId} onChange={(e) => set('orderId', e.target.value)} maxLength={32} />}
        </Field>
      </div>
    </Modal>
  );
}
