import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, Clock, MapPin, Package, Truck, Home, ClipboardList } from 'lucide-react';
import { toast } from 'sonner';
import { CUSTOMER_STEPS, CUSTOMER_STEP_LABELS, customerStepIndex, type OrderStatus } from '@goturtle/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dateOnly, phone } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Button, Field, Input, Modal, Select, StatusBadge, Textarea } from '@/components/ui';
import { Ltr, Money, nameOf, tomorrowCairo, useLocations } from './common';
import type { OrderRow, Pickup } from './types';

/** Phone card used by every order list below the md breakpoint. */
export function OrderMobileCard({ o }: { o: Pick<OrderRow, 'trackingNumber' | 'brandReference' | 'status' | 'recipientName' | 'recipientPhone' | 'collectCents' | 'paymentMethod' | 'createdAt' | 'zone'> }) {
  const { locale } = useI18n();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="ltr font-mono text-sm font-semibold text-ink-900 dark:text-white">{o.trackingNumber}</span>
        <StatusBadge status={o.status} />
      </div>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="min-w-0 truncate text-ink-700 dark:text-ink-200">{o.recipientName}</span>
        <Money cents={o.collectCents} className="font-semibold text-ink-900 dark:text-white" />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
        <Ltr>{phone(o.recipientPhone)}</Ltr>
        {o.zone && <span>{nameOf(o.zone, locale)}</span>}
        {o.brandReference && <span className="ltr">#{o.brandReference}</span>}
        <span>{dateOnly(o.createdAt)}</span>
      </div>
    </div>
  );
}

const STEP_ICONS = [ClipboardList, Package, Truck, MapPin, Home];

/** 5-step progress (same steps the customer sees) with an exception state. */
export function ProgressSteps({ status, compact }: { status: OrderStatus; compact?: boolean }) {
  const { locale } = useI18n();
  const idx = customerStepIndex(status);
  const warn = status === 'FAILED_ATTEMPT' || status === 'RESCHEDULED' || status === 'ON_HOLD';
  return (
    <ol className="flex items-start" aria-label="progress">
      {CUSTOMER_STEPS.map((key, i) => {
        const Icon = STEP_ICONS[i];
        const done = idx >= 0 && i < idx;
        const current = idx === i;
        const last = i === CUSTOMER_STEPS.length - 1;
        return (
          <li key={key} className={cn('relative flex flex-1 flex-col items-center text-center', !last && 'after:absolute after:top-4 after:h-0.5 after:w-full after:start-1/2 after:content-[""]', !last && (idx > i ? 'after:bg-turtle-500' : 'after:bg-ink-200 dark:after:bg-ink-700'))}>
            <span
              className={cn(
                'relative z-10 grid h-8 w-8 place-items-center rounded-full ring-4 ring-white transition dark:ring-ink-900',
                done && 'bg-turtle-500 text-white',
                current && !warn && (last ? 'bg-turtle-500 text-white' : 'bg-turtle-600 text-white shadow-lg shadow-turtle-600/30'),
                current && warn && 'bg-amber-500 text-white',
                !done && !current && 'bg-ink-100 text-ink-400 dark:bg-ink-800',
              )}
            >
              {done || (current && last) ? <Check className="h-4 w-4" /> : current && warn ? <CircleAlert className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
            </span>
            {!compact && (
              <span className={cn('mt-2 px-0.5 text-[11px] font-medium leading-tight sm:text-xs', current ? 'text-ink-900 dark:text-white' : done ? 'text-ink-600 dark:text-ink-300' : 'text-ink-400')}>
                {CUSTOMER_STEP_LABELS[key][locale]}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

const WINDOWS = ['09:00-12:00', '12:00-15:00', '15:00-18:00', '10:00-14:00', '14:00-18:00', '18:00-21:00'];

/** Request a pickup: new (CREATED) orders at the chosen location are attached automatically. */
export function RequestPickupModal({ open, onClose, expected, onDone }: { open: boolean; onClose: () => void; expected?: number; onDone?: (p: Pickup) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const locations = useLocations();
  const active = (locations.data ?? []).filter((l) => l.isActive);
  const [form, setForm] = useState({ locationId: '', scheduledDate: tomorrowCairo(1), timeWindow: '10:00-14:00', expectedCount: '', notes: '' });
  useEffect(() => {
    if (!open) return;
    const def = active.find((l) => l.isDefault) ?? active[0];
    setForm((f) => ({ ...f, locationId: f.locationId || def?.id || '', expectedCount: expected ? String(expected) : f.expectedCount }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, locations.data, expected]);

  const m = useMutation({
    mutationFn: () =>
      api<Pickup>('/pickups', {
        method: 'POST',
        body: {
          locationId: form.locationId || undefined,
          scheduledDate: form.scheduledDate,
          timeWindow: form.timeWindow || undefined,
          expectedCount: form.expectedCount ? Number(form.expectedCount) : undefined,
          notes: form.notes.trim() || undefined,
        },
      }),
    onSuccess: (p) => {
      toast.success(t('brand.pickups.requested', { code: p.code, n: p.ordersCount }));
      qc.invalidateQueries({ queryKey: ['pickups'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      onDone?.(p);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const days = Array.from({ length: 15 }, (_, i) => tomorrowCairo(i));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('brand.pickups.request')}
      description={t('brand.pickups.requestHint')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button loading={m.isPending} disabled={!form.scheduledDate || (!active.length && !locations.isLoading)} onClick={() => m.mutate()} icon={<Truck className="h-4 w-4" />}>
            {t('brand.pickups.submit')}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label={t('brand.pickups.location')} required error={!locations.isLoading && !active.length ? t('brand.pickups.noLocation') : undefined}>
          {(id) => (
            <Select id={id} value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })} options={active.map((l) => ({ value: l.id, label: `${l.name} — ${l.addressLine}` }))} />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('brand.pickups.date')} required>
            {(id) => (
              <Select
                id={id}
                value={form.scheduledDate}
                onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })}
                options={days.map((d, i) => ({ value: d, label: `${i === 0 ? t('common.today') + ' · ' : i === 1 ? t('brand.common.tomorrow') + ' · ' : ''}${dateOnly(d + 'T12:00:00Z')}` }))}
              />
            )}
          </Field>
          <Field label={t('brand.pickups.window')}>
            {(id) => <Select id={id} value={form.timeWindow} onChange={(e) => setForm({ ...form, timeWindow: e.target.value })} options={WINDOWS.map((w) => ({ value: w, label: w }))} />}
          </Field>
        </div>
        <Field label={t('brand.pickups.expected')} hint={t('brand.pickups.expectedHint')}>
          {(id) => <Input id={id} type="number" min={0} max={5000} inputMode="numeric" value={form.expectedCount} onChange={(e) => setForm({ ...form, expectedCount: e.target.value })} leading={<Package className="h-4 w-4" />} />}
        </Field>
        <Field label={t('common.notes')}>
          {(id) => <Textarea id={id} maxLength={1000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t('brand.pickups.notesPh')} />}
        </Field>
        <p className="flex items-start gap-2 rounded-xl bg-sky-50 px-3 py-2.5 text-xs text-sky-800 dark:bg-sky-950 dark:text-sky-200">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t('brand.pickups.autoAttach')}
        </p>
      </form>
    </Modal>
  );
}
