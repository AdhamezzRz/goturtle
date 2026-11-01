import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { money, parseEgp } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Button, Field, Input, Modal, Switch } from '@/components/ui';
import type { Partner } from '../types';
import { useGovernorates } from './data';
import '../i18n';

const CODE = /^[A-Z0-9]{2,12}$/;

export function PartnerEditor({ open, partner, onClose }: { open: boolean; partner: Partner | null; onClose: () => void }) {
  const { t, pick } = useI18n();
  const qc = useQueryClient();
  const govs = useGovernorates();
  const blank = { code: '', name: '', trackingUrlTemplate: '', governorateCodes: [] as string[], fee: '', returnFee: '', isActive: true };
  const [f, setF] = useState(blank);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTouched(false);
    setF(partner ? {
      code: partner.code, name: partner.name, trackingUrlTemplate: partner.trackingUrlTemplate ?? '', governorateCodes: partner.governorateCodes,
      fee: partner.feeCents === null ? '' : String(partner.feeCents / 100), returnFee: partner.returnFeeCents === null ? '' : String(partner.returnFeeCents / 100), isActive: partner.isActive,
    } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, partner]);
  const errors = {
    code: !partner && !CODE.test(f.code) ? t('intake.pt.err.code') : undefined,
    name: f.name.trim().length < 2 ? t('intake.pt.err.name') : undefined,
    trackingUrlTemplate: f.trackingUrlTemplate.trim() && !/^https:\/\/\S+$/.test(f.trackingUrlTemplate.trim()) ? t('intake.pt.err.url') : undefined,
    fee: f.fee.trim() && parseEgp(f.fee) === null ? t('intake.pt.err.amount') : undefined,
    returnFee: f.returnFee.trim() && parseEgp(f.returnFee) === null ? t('intake.pt.err.amount') : undefined,
  };
  const valid = !Object.values(errors).some(Boolean);
  const m = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name.trim(),
        trackingUrlTemplate: f.trackingUrlTemplate.trim() || null,
        governorateCodes: f.governorateCodes,
        feeCents: f.fee.trim() ? parseEgp(f.fee) : null,
        returnFeeCents: f.returnFee.trim() ? parseEgp(f.returnFee) : null,
        isActive: f.isActive,
      };
      return partner ? api<Partner>(`/partners/${partner.id}`, { method: 'PATCH', body }) : api<Partner>('/partners', { method: 'POST', body: { ...body, code: f.code } });
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['partners'] });
      toast.success(partner ? t('intake.pt.saved') : t('intake.pt.created', { code: p.courier?.code ?? '' }));
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const err = (k: keyof typeof errors) => (touched ? errors[k] : undefined);
  const toggleGov = (code: string) => setF((s) => ({ ...s, governorateCodes: s.governorateCodes.includes(code) ? s.governorateCodes.filter((c) => c !== code) : [...s.governorateCodes, code] }));
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={partner ? t('intake.pt.edit', { name: partner.name }) : t('intake.pt.new')}
      description={!partner ? t('intake.pt.newHint') : undefined}
      footer={<><Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button loading={m.isPending} onClick={() => { setTouched(true); if (valid) m.mutate(); }}>{partner ? t('action.save') : t('action.create')}</Button></>}
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <Field label={t('intake.pt.f.code')} required error={err('code')} hint={!partner ? t('intake.pt.f.codeHint') : undefined}>
            {(id) => <Input id={id} dir="ltr" className="font-mono uppercase" disabled={!!partner} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} maxLength={12} invalid={!!err('code')} />}
          </Field>
          <Field label={t('intake.pt.f.name')} required error={err('name')}>{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} invalid={!!err('name')} />}</Field>
        </div>
        <Field label={t('intake.pt.f.trackingUrl')} hint={t('intake.pt.f.trackingUrlHint')} error={err('trackingUrlTemplate')}>
          {(id) => <Input id={id} dir="ltr" className="font-mono" value={f.trackingUrlTemplate} onChange={(e) => setF({ ...f, trackingUrlTemplate: e.target.value })} placeholder="https://partner.example/track/{tn}" invalid={!!err('trackingUrlTemplate')} />}
        </Field>
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink-700 dark:text-ink-200">{t('intake.pt.f.coverage')}</p>
          <p className="mb-2 text-xs text-ink-500">{t('intake.pt.f.coverageHint')}</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('intake.pt.f.coverage')}>
            {(govs.data ?? []).map((g) => {
              const on = f.governorateCodes.includes(g.code);
              return (
                <button key={g.id} type="button" aria-pressed={on} onClick={() => toggleGov(g.code)} className={cn('rounded-full border px-3 py-1.5 text-sm transition', on ? 'border-turtle-500 bg-turtle-50 font-semibold text-turtle-800 dark:bg-turtle-950 dark:text-turtle-200' : 'border-ink-200 text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800')}>
                  {pick(g, 'name')} <span className="ltr text-xs opacity-70">{g.code}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('intake.pt.f.fee')} hint={partner ? t('intake.pt.f.feeDefault', { amount: money(partner.effectiveFeeCents) }) : t('intake.pt.f.feeHint')} error={err('fee')}>
            {(id) => <Input id={id} inputMode="decimal" dir="ltr" value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} trailing={<span className="text-xs">{t('common.egp')}</span>} />}
          </Field>
          <Field label={t('intake.pt.f.returnFee')} error={err('returnFee')}>
            {(id) => <Input id={id} inputMode="decimal" dir="ltr" value={f.returnFee} onChange={(e) => setF({ ...f, returnFee: e.target.value })} trailing={<span className="text-xs">{t('common.egp')}</span>} />}
          </Field>
        </div>
        <p className="rounded-xl bg-ink-50 px-3 py-2 text-xs text-ink-600 dark:bg-ink-800/60 dark:text-ink-300">{t('intake.pt.f.virtualNote')}</p>
        <Switch checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label={t('intake.pt.f.active')} />
      </div>
    </Modal>
  );
}
