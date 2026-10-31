import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Star } from 'lucide-react';
import { FailureReason, TERMINAL_STATUSES, isValidEgyptPhone, type OrderStatus } from '@goturtle/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cairoToday, money, num, parseEgp, statusLabel } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { Badge, Button, ConfirmDialog, EmptyState, Field, Input, Modal, Select, Skeleton, Switch, Textarea } from '@/components/ui';
import { Mono } from '../../components/opsa/ui';
import { useCouriers, useHubs, useZones } from '../../components/opsa/lookups';
import type { OrderDetail } from '../../components/opsa/types';
import './i18n';

const HERO_STATUSES: OrderStatus[] = ['PICKUP_ASSIGNED', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'RETURN_OUT'];

function useOrderInvalidate(id: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['orders'] });
    void qc.invalidateQueries({ queryKey: ['order', id] });
    void qc.invalidateQueries({ queryKey: ['dispatch'] });
  };
}

// ------------------------------------------------------------------ change status

export function ChangeStatusModal({ order, open, onClose, initial }: { order: OrderDetail; open: boolean; onClose: () => void; initial?: OrderStatus }) {
  const { t } = useI18n();
  const invalidate = useOrderInvalidate(order.id);
  const hubs = useHubs();
  const couriers = useCouriers();
  const [to, setTo] = useState<OrderStatus | ''>('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [isPublic, setPublic] = useState(true);
  const [courierId, setCourier] = useState('');
  const [hubId, setHub] = useState('');
  const [collected, setCollected] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  const [date, setDate] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTo(initial ?? '');
    setReason('');
    setNote('');
    setPublic(true);
    setCourier(order.courier?.id ?? '');
    setHub(order.hub?.id ?? '');
    setCollected(String(order.collectCents / 100));
    setReceivedBy('');
    setDate('');
    setTouched(false);
  }, [open, order, initial]);

  const errors: Record<string, string> = {};
  if (!to) errors.to = t('ops.opsa.required');
  if (to === 'FAILED_ATTEMPT' && !reason) errors.reason = t('ops.opsa.required');
  if (to === 'RESCHEDULED' && !date) errors.date = t('ops.opsa.required');
  if (to === 'DELIVERED' && parseEgp(collected) === null) errors.collected = t('ops.opsa.required');
  if (to === 'RECEIVED_AT_HUB' && !hubId) errors.hub = t('ops.opsa.required');

  const m = useMutation({
    mutationFn: () =>
      api(`/orders/${order.id}/status`, {
        method: 'POST',
        body: {
          status: to,
          note: note || undefined,
          isPublic,
          failureReason: to === 'FAILED_ATTEMPT' ? reason : undefined,
          courierId: HERO_STATUSES.includes(to as OrderStatus) && courierId ? courierId : undefined,
          hubId: to === 'RECEIVED_AT_HUB' ? hubId : undefined,
          collectedCents: to === 'DELIVERED' ? parseEgp(collected) ?? undefined : undefined,
          receivedBy: to === 'DELIVERED' && receivedBy ? receivedBy : undefined,
          scheduledDate: to === 'RESCHEDULED' ? date : undefined,
        },
      }),
    onSuccess: () => {
      toast.success(t('ops.orders.status.done', { s: statusLabel(to as OrderStatus) }));
      invalidate();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = () => {
    setTouched(true);
    if (Object.keys(errors).length) return;
    m.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('ops.orders.status.title')}
      description={<Mono>{order.trackingNumber}</Mono>}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button loading={m.isPending} onClick={submit} variant={to && TERMINAL_STATUSES.includes(to) && to !== 'DELIVERED' ? 'danger' : 'primary'}>{t('action.save')}</Button>
        </>
      }
    >
      {order.allowedTransitions.length === 0 ? (
        <p className="text-sm text-ink-500">{t('ops.orders.status.none')}</p>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium text-ink-700 dark:text-ink-200">{t('ops.orders.status.to')}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup">
              {order.allowedTransitions.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={to === s}
                  onClick={() => setTo(s)}
                  className={cn(
                    'rounded-xl border px-3 py-2.5 text-start text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-turtle-500',
                    to === s ? 'border-turtle-500 bg-turtle-50 text-turtle-800 dark:bg-turtle-950 dark:text-turtle-200' : 'border-ink-200 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800',
                  )}
                >
                  {statusLabel(s)}
                </button>
              ))}
            </div>
            {touched && errors.to && <p className="mt-1 text-xs font-medium text-red-600">{errors.to}</p>}
          </div>
          {to && TERMINAL_STATUSES.includes(to) && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">{t('ops.orders.status.terminalWarn')}</p>}
          {to === 'FAILED_ATTEMPT' && (
            <Field label={t('ops.orders.status.reason')} required error={touched && errors.reason}>
              {(id) => <Select id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="—" options={Object.keys(FailureReason).map((r) => ({ value: r, label: t(`ops.opsa.reason.${r}`) }))} />}
            </Field>
          )}
          {to === 'RESCHEDULED' && (
            <Field label={t('ops.orders.status.date')} required error={touched && errors.date}>
              {(id) => <Input id={id} type="date" min={cairoToday()} value={date} onChange={(e) => setDate(e.target.value)} className="ltr" />}
            </Field>
          )}
          {to === 'DELIVERED' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('ops.orders.status.collected')} required error={touched && errors.collected}>
                {(id) => <Input id={id} inputMode="decimal" value={collected} onChange={(e) => setCollected(e.target.value)} className="ltr" />}
              </Field>
              <Field label={t('ops.orders.status.receivedBy')}>{(id) => <Input id={id} value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} />}</Field>
            </div>
          )}
          {to && HERO_STATUSES.includes(to) && (
            <Field label={t('ops.orders.status.hero')}>
              {(id) => <Select id={id} value={courierId} onChange={(e) => setCourier(e.target.value)} placeholder="—" options={(couriers.data ?? []).map((c) => ({ value: c.id, label: `${c.name} · ${c.code}` }))} />}
            </Field>
          )}
          {to === 'RECEIVED_AT_HUB' && (
            <Field label={t('ops.orders.status.hub')} required error={touched && errors.hub}>
              {(id) => <Select id={id} value={hubId} onChange={(e) => setHub(e.target.value)} placeholder="—" options={(hubs.data ?? []).map((h) => ({ value: h.id, label: `${h.name} · ${h.code}` }))} />}
            </Field>
          )}
          <Field label={t('ops.orders.status.note')}>
            {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('ops.orders.status.notePh')} maxLength={1000} />}
          </Field>
          <Switch checked={isPublic} onChange={setPublic} label={t('ops.orders.status.public')} />
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ assign hero (with suggestions)

interface Suggestion {
  courier: { id: string; code: string; name: string; availability: string; vehicleType: string };
  eligible: boolean;
  reasons: string[];
  score: number;
  breakdown: Record<string, number>;
  distanceKm: number | null;
  capacityLeft: number;
  cashHeadroomCents: number;
}

export function AssignHeroModal({ order, open, onClose }: { order: OrderDetail; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const invalidate = useOrderInvalidate(order.id);
  const couriers = useCouriers();
  const [manual, setManual] = useState('');
  const sugg = useQuery({
    queryKey: ['dispatch', 'suggest', order.id],
    queryFn: () => api<{ candidates: Suggestion[]; ineligible: Suggestion[] }>(`/dispatch/suggest/${order.id}`),
    enabled: open && can('dispatch.manage'),
  });
  const target: OrderStatus = order.allowedTransitions.includes('ASSIGNED') ? 'ASSIGNED' : order.allowedTransitions.includes('PICKUP_ASSIGNED') ? 'PICKUP_ASSIGNED' : 'ASSIGNED';
  const m = useMutation({
    mutationFn: (c: { id: string; name: string }) => api(`/orders/${order.id}/status`, { method: 'POST', body: { status: target, courierId: c.id, isPublic: false } }).then(() => c),
    onSuccess: (c) => {
      toast.success(t('ops.orders.assign.done', { name: c.name }));
      invalidate();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const list = [...(sugg.data?.candidates ?? []), ...(sugg.data?.ineligible ?? [])];
  return (
    <Modal open={open} onClose={onClose} title={t('ops.orders.assign.title')} description={<Mono>{order.trackingNumber}</Mono>} size="lg">
      <div className="space-y-5">
        {can('dispatch.manage') && (
          <div>
            <p className="mb-2 text-sm font-semibold text-ink-800 dark:text-ink-100">{t('ops.orders.assign.suggested')}</p>
            {sugg.isLoading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
            ) : list.length === 0 ? (
              <EmptyState title={t('ops.orders.assign.none')} className="py-6" />
            ) : (
              <ul className="space-y-2">
                {list.map((s) => (
                  <li key={s.courier.id}>
                    <SuggestionCard s={s} onPick={() => m.mutate(s.courier)} loading={m.isPending && m.variables?.id === s.courier.id} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div>
          <p className="mb-2 text-sm font-semibold text-ink-800 dark:text-ink-100">{t('ops.orders.assign.manual')}</p>
          <div className="flex gap-2">
            <Select aria-label={t('ops.orders.status.hero')} value={manual} onChange={(e) => setManual(e.target.value)} placeholder="—" options={(couriers.data ?? []).map((c) => ({ value: c.id, label: `${c.name} · ${c.code}` }))} className="flex-1" />
            <Button
              disabled={!manual}
              loading={m.isPending && m.variables?.id === manual}
              onClick={() => {
                const c = couriers.data?.find((x) => x.id === manual);
                if (c) m.mutate({ id: c.id, name: c.name });
              }}
            >
              {t('ops.orders.assign.choose')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function SuggestionCard({ s, onPick, loading, compact }: { s: Suggestion; onPick?: () => void; loading?: boolean; compact?: boolean }) {
  const { t } = useI18n();
  const max: Record<string, number> = { zone: 30, availability: 10, distance: 20, capacity: 15, rating: 10, cash: 15 };
  return (
    <div className={cn('rounded-xl border p-3', s.eligible ? 'border-ink-200 dark:border-ink-700' : 'border-dashed border-ink-200 opacity-80 dark:border-ink-700')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="ltr grid h-9 w-12 place-items-center rounded-lg bg-turtle-50 font-display text-sm font-bold text-turtle-700 dark:bg-turtle-950 dark:text-turtle-300" title={t('ops.opsa.score')}>{Math.round(s.score)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink-900 dark:text-ink-50">{s.courier.name} <Mono className="text-xs font-normal text-ink-400">{s.courier.code}</Mono></p>
          <p className="truncate text-xs text-ink-500">
            {t(`ops.opsa.avail.${s.courier.availability}`)}
            {s.distanceKm != null && ` · ${t('ops.orders.assign.km', { n: num(Math.round(s.distanceKm * 10) / 10) })}`}
            {` · ${t('ops.orders.assign.capacity', { n: num(Math.max(0, s.capacityLeft)) })}`}
            {` · ${t('ops.orders.assign.cashRoom', { v: money(Math.max(0, s.cashHeadroomCents), { compact: true }) })}`}
          </p>
        </div>
        {!s.eligible && s.reasons.map((r) => <Badge key={r} tone="danger">{t(`ops.orders.reason.${r}`)}</Badge>)}
        {onPick && (
          <Button size="sm" variant={s.eligible ? 'primary' : 'outline'} onClick={onPick} loading={loading}>{t('ops.orders.assign.choose')}</Button>
        )}
      </div>
      {!compact && (
        <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-1.5 sm:grid-cols-6">
          {Object.entries(s.breakdown).map(([k, v]) => (
            <div key={k} title={`${v} / ${max[k] ?? ''}`}>
              <div className="flex items-center justify-between text-[10px] text-ink-500">
                <span>{t(`ops.orders.score.${k}`)}</span>
                <span className="ltr">{Math.round(v)}</span>
              </div>
              <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                <div className="h-full rounded-full bg-turtle-500" style={{ width: `${Math.min(100, (v / (max[k] ?? 30)) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export type { Suggestion };

// ------------------------------------------------------------------ cancel

export function CancelOrderDialog({ order, open, onClose }: { order: OrderDetail; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const invalidate = useOrderInvalidate(order.id);
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) setReason(''); }, [open]);
  const m = useMutation({
    mutationFn: () => api(`/orders/${order.id}/cancel`, { method: 'POST', body: { reason: reason || undefined } }),
    onSuccess: () => {
      toast.success(t('ops.orders.cancel.done'));
      invalidate();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <ConfirmDialog open={open} onClose={onClose} onConfirm={() => m.mutate()} loading={m.isPending} danger title={t('ops.orders.cancel.title')} description={t('ops.orders.cancel.desc')} confirmLabel={t('ops.orders.cancel.confirm')}>
      <Field label={t('ops.orders.cancel.reason')}>{(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}</Field>
    </ConfirmDialog>
  );
}

// ------------------------------------------------------------------ edit

export function EditOrderModal({ order, open, onClose }: { order: OrderDetail; open: boolean; onClose: () => void }) {
  const { t, locale } = useI18n();
  const invalidate = useOrderInvalidate(order.id);
  const zones = useZones();
  const init = useMemo(() => ({
    name: order.recipientName, phone: order.recipientPhone, altPhone: order.recipientAltPhone ?? '',
    line: order.addressLine, building: order.building ?? '', floor: order.floor ?? '', apartment: order.apartment ?? '', landmark: order.landmark ?? '', zoneId: order.zoneId,
    serviceLevel: order.serviceLevel, paymentMethod: order.paymentMethod, cod: String(order.codAmountCents / 100), feesPaidBy: order.feesPaidBy,
    scheduledDate: order.scheduledDate ?? '', notes: order.notes ?? '', internalNotes: order.internalNotes ?? '', priority: String(order.priority), maxAttempts: String(order.maxAttempts),
    otp: order.deliveryOtpRequired, weight: String(order.weightGrams / 1000), items: String(order.itemsCount), description: order.packageDescription ?? '', fragile: order.isFragile, allowOpening: order.allowOpening,
  }), [order]);
  const [v, setV] = useState(init);
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) { setV(init); setTouched(false); } }, [open, init]);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((p) => ({ ...p, [k]: val }));

  const errors: Record<string, string> = {};
  if (v.name.trim().length < 2) errors.name = t('ops.orders.create.minName');
  if (!isValidEgyptPhone(v.phone)) errors.phone = t('ops.opsa.invalidPhone');
  if (v.altPhone && !isValidEgyptPhone(v.altPhone)) errors.altPhone = t('ops.opsa.invalidPhone');
  if (v.line.trim().length < 5) errors.line = t('ops.orders.create.minLine');
  if (v.paymentMethod === 'COD' && parseEgp(v.cod) === null) errors.cod = t('ops.orders.create.codRequired');

  const m = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      const recipient: Record<string, unknown> = {};
      if (v.name !== init.name) recipient.name = v.name.trim();
      if (v.phone !== init.phone) recipient.phone = v.phone;
      if (v.altPhone !== init.altPhone) recipient.altPhone = v.altPhone || null;
      if (Object.keys(recipient).length) body.recipient = recipient;
      const address: Record<string, unknown> = {};
      for (const k of ['line', 'building', 'floor', 'apartment', 'landmark'] as const) if (v[k] !== init[k]) address[k] = v[k] || (k === 'line' ? v[k] : null);
      if (v.zoneId !== init.zoneId) address.zoneId = v.zoneId;
      if (Object.keys(address).length) body.address = address;
      const pkg: Record<string, unknown> = {};
      if (v.weight !== init.weight) pkg.weightGrams = Math.max(1, Math.round(Number(v.weight) * 1000));
      if (v.items !== init.items) pkg.itemsCount = Math.max(1, Number(v.items));
      if (v.description !== init.description) pkg.description = v.description || null;
      if (v.fragile !== init.fragile) pkg.isFragile = v.fragile;
      if (v.allowOpening !== init.allowOpening) pkg.allowOpening = v.allowOpening;
      if (Object.keys(pkg).length) body.package = pkg;
      if (v.serviceLevel !== init.serviceLevel) body.serviceLevel = v.serviceLevel;
      if (v.paymentMethod !== init.paymentMethod) body.paymentMethod = v.paymentMethod;
      if (v.cod !== init.cod || v.paymentMethod !== init.paymentMethod) body.codAmountCents = v.paymentMethod === 'PREPAID' ? 0 : parseEgp(v.cod) ?? 0;
      if (v.feesPaidBy !== init.feesPaidBy) body.feesPaidBy = v.feesPaidBy;
      if (v.scheduledDate !== init.scheduledDate) body.scheduledDate = v.scheduledDate || null;
      if (v.notes !== init.notes) body.notes = v.notes || null;
      if (v.internalNotes !== init.internalNotes) body.internalNotes = v.internalNotes || null;
      if (v.priority !== init.priority) body.priority = Number(v.priority);
      if (v.maxAttempts !== init.maxAttempts) body.maxAttempts = Number(v.maxAttempts);
      if (v.otp !== init.otp) body.deliveryOtpRequired = v.otp;
      return api(`/orders/${order.id}`, { method: 'PATCH', body });
    },
    onSuccess: () => {
      toast.success(t('ops.orders.edit.done'));
      invalidate();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = () => {
    setTouched(true);
    if (Object.keys(errors).length) {
      toast.error(t('ops.orders.create.fixErrors'));
      return;
    }
    m.mutate();
  };
  const err = (k: string) => (touched ? errors[k] : undefined);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={t('ops.orders.edit.title')}
      description={<Mono>{order.trackingNumber}</Mono>}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button loading={m.isPending} onClick={submit}>{t('action.save')}</Button>
        </>
      }
    >
      <div className="space-y-6">
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-semibold">{t('ops.orders.create.s.recipient')}</legend>
          <Field label={t('ops.orders.create.name')} required error={err('name')}>{(id) => <Input id={id} value={v.name} onChange={(e) => set('name', e.target.value)} />}</Field>
          <Field label={t('ops.orders.create.phone')} required error={err('phone')}>{(id) => <Input id={id} value={v.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" className="ltr" />}</Field>
          <Field label={t('ops.orders.create.altPhone')} error={err('altPhone')}>{(id) => <Input id={id} value={v.altPhone} onChange={(e) => set('altPhone', e.target.value)} inputMode="tel" className="ltr" />}</Field>
        </fieldset>
        <fieldset className="grid gap-3 sm:grid-cols-4">
          <legend className="mb-2 text-sm font-semibold">{t('ops.orders.create.s.address')}</legend>
          <Field label={t('ops.orders.create.line')} required error={err('line')} className="sm:col-span-4">{(id) => <Input id={id} value={v.line} onChange={(e) => set('line', e.target.value)} />}</Field>
          <Field label={t('ops.orders.create.building')}>{(id) => <Input id={id} value={v.building} onChange={(e) => set('building', e.target.value)} />}</Field>
          <Field label={t('ops.orders.create.floor')}>{(id) => <Input id={id} value={v.floor} onChange={(e) => set('floor', e.target.value)} />}</Field>
          <Field label={t('ops.orders.create.apartment')}>{(id) => <Input id={id} value={v.apartment} onChange={(e) => set('apartment', e.target.value)} />}</Field>
          <Field label={t('ops.orders.create.zone')}>
            {(id) => <Select id={id} value={v.zoneId} onChange={(e) => set('zoneId', e.target.value)} options={(zones.data ?? []).filter((z) => z.isActive || z.id === v.zoneId).map((z) => ({ value: z.id, label: `${locale === 'ar' ? z.nameAr : z.nameEn} · ${z.code}` }))} />}
          </Field>
          <Field label={t('ops.orders.create.landmark')} className="sm:col-span-4">{(id) => <Input id={id} value={v.landmark} onChange={(e) => set('landmark', e.target.value)} />}</Field>
        </fieldset>
        <fieldset className="grid gap-3 sm:grid-cols-4">
          <legend className="mb-2 text-sm font-semibold">{t('ops.orders.create.s.package')}</legend>
          <Field label={t('ops.orders.create.description')} className="sm:col-span-2">{(id) => <Input id={id} value={v.description} onChange={(e) => set('description', e.target.value)} />}</Field>
          <Field label={t('ops.orders.create.items')}>{(id) => <Input id={id} type="number" min={1} value={v.items} onChange={(e) => set('items', e.target.value)} className="ltr" />}</Field>
          <Field label={t('ops.orders.create.weight')}>{(id) => <Input id={id} type="number" min={0.1} step={0.1} value={v.weight} onChange={(e) => set('weight', e.target.value)} className="ltr" />}</Field>
          <Field label={t('ops.orders.create.service')}>
            {(id) => <Select id={id} value={v.serviceLevel} onChange={(e) => set('serviceLevel', e.target.value as typeof v.serviceLevel)} options={['STANDARD', 'SAME_DAY', 'EXPRESS', 'SCHEDULED'].map((s) => ({ value: s, label: t(`ops.opsa.service.${s}`) }))} />}
          </Field>
          <Field label={t('ops.orders.create.scheduled')}>{(id) => <Input id={id} type="date" min={cairoToday()} value={v.scheduledDate} onChange={(e) => set('scheduledDate', e.target.value)} className="ltr" />}</Field>
          <div className="flex flex-col justify-end gap-2 sm:col-span-2">
            <Switch checked={v.fragile} onChange={(x) => set('fragile', x)} label={t('ops.orders.create.fragile')} />
            <Switch checked={v.allowOpening} onChange={(x) => set('allowOpening', x)} label={t('ops.orders.create.allowOpen')} />
          </div>
        </fieldset>
        <fieldset className="grid gap-3 sm:grid-cols-4">
          <legend className="mb-2 text-sm font-semibold">{t('ops.orders.create.s.payment')}</legend>
          <Field label={t('ops.orders.create.method')}>
            {(id) => <Select id={id} value={v.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value as typeof v.paymentMethod)} options={['COD', 'PREPAID'].map((s) => ({ value: s, label: t(`ops.opsa.payment.${s}`) }))} />}
          </Field>
          <Field label={t('ops.orders.create.cod')} error={err('cod')}>{(id) => <Input id={id} disabled={v.paymentMethod === 'PREPAID'} value={v.paymentMethod === 'PREPAID' ? '0' : v.cod} onChange={(e) => set('cod', e.target.value)} inputMode="decimal" className="ltr" />}</Field>
          <Field label={t('ops.orders.create.payer')}>
            {(id) => <Select id={id} value={v.feesPaidBy} onChange={(e) => set('feesPaidBy', e.target.value as typeof v.feesPaidBy)} options={['BRAND', 'RECIPIENT'].map((s) => ({ value: s, label: t(`ops.opsa.payer.${s}`) }))} />}
          </Field>
          <div className="flex items-end pb-2"><Switch checked={v.otp} onChange={(x) => set('otp', x)} label={t('ops.orders.create.otp')} /></div>
          <Field label={t('ops.orders.edit.priority')}>{(id) => <Input id={id} type="number" min={0} max={10} value={v.priority} onChange={(e) => set('priority', e.target.value)} className="ltr" />}</Field>
          <Field label={t('ops.orders.edit.maxAttempts')}>{(id) => <Input id={id} type="number" min={1} max={5} value={v.maxAttempts} onChange={(e) => set('maxAttempts', e.target.value)} className="ltr" />}</Field>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('ops.orders.create.notes')}>{(id) => <Textarea id={id} value={v.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1000} />}</Field>
          <Field label={t('ops.orders.detail.internalNotes')}>{(id) => <Textarea id={id} value={v.internalNotes} onChange={(e) => set('internalNotes', e.target.value)} maxLength={2000} />}</Field>
        </div>
        <p className="text-xs text-ink-500">{t('ops.orders.edit.refee')}</p>
      </div>
    </Modal>
  );
}

export function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex" aria-label={`${value}/5`}>
      {Array.from({ length: 5 }).map((_, i) => <Star key={i} className={cn('h-4 w-4', i < value ? 'fill-sand-400 text-sand-400' : 'text-ink-200 dark:text-ink-700')} />)}
    </span>
  );
}
