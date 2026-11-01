import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, ImagePlus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { ClaimType, type ClaimStatus } from '@goturtle/shared';
import { api, uploadFile } from '@/lib/api';
import { dateTime, parseEgp } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Button, Field, Input, Modal, Textarea, Timeline } from '@/components/ui';
import { Amount, Ltr } from '../ui';
import type { ClaimDetail } from '../types';
import '../i18n';

const TONE: Record<ClaimStatus, 'default' | 'success' | 'warning' | 'danger' | 'muted'> = { OPEN: 'warning', UNDER_REVIEW: 'default', APPROVED: 'success', REJECTED: 'danger', PAID: 'success' };

export function ClaimTimeline({ claim }: { claim: ClaimDetail }) {
  const { t } = useI18n();
  return (
    <Timeline
      items={[...claim.timeline].reverse().map((e, i) => ({
        id: `${e.at}-${i}`,
        title: t(`state.${e.status}`),
        time: dateTime(e.at),
        tone: TONE[e.status] ?? 'muted',
        body: (
          <div className="space-y-0.5">
            {e.approvedCents !== null && <p className="text-sm">{t('money.claims.approvedAmount')} <Amount cents={e.approvedCents} className="font-semibold" /></p>}
            {e.chargeHeroCents ? <p className="text-xs text-ink-500">{t('money.claims.heroCharged')} <Amount cents={e.chargeHeroCents} /></p> : null}
            {e.note && <p className="text-sm">{e.note}</p>}
            <p className="text-xs text-ink-400">{e.actor}</p>
          </div>
        ),
      }))}
    />
  );
}

const isImage = (url: string) => /\.(png|jpe?g|webp|gif|heic)(\?|$)/i.test(url);

export function EvidenceGallery({ urls }: { urls: string[] | null | undefined }) {
  const { t } = useI18n();
  if (!urls?.length) return <p className="text-sm text-ink-500">{t('money.claims.noEvidence')}</p>;
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {urls.map((u) => (
        <li key={u}>
          <a href={u} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-xl border border-ink-100 bg-ink-50 hover:ring-2 hover:ring-turtle-500 dark:border-ink-800 dark:bg-ink-800">
            {isImage(u) ? <img src={u} alt={t('money.claims.evidence')} loading="lazy" className="h-full w-full object-cover" /> : <span className="grid h-full w-full place-items-center text-ink-500"><FileText className="h-8 w-8" /></span>}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Uploads files as ticket attachments and keeps the resulting URLs. */
export function EvidenceUploader({ value, onChange, onBusy }: { value: string[]; onChange: (v: string[]) => void; onBusy?: (b: boolean) => void }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    onBusy?.(true);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files).slice(0, 10 - value.length)) urls.push((await uploadFile(f, 'ticket_attachment')).url);
      onChange([...value, ...urls]);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      onBusy?.(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="grid grid-cols-4 gap-2">
          {value.map((u) => (
            <li key={u} className="relative aspect-square overflow-hidden rounded-xl border border-ink-100 bg-ink-50 dark:border-ink-800 dark:bg-ink-800">
              {isImage(u) ? <img src={u} alt="" className="h-full w-full object-cover" /> : <span className="grid h-full w-full place-items-center text-ink-500"><FileText className="h-6 w-6" /></span>}
              <button type="button" aria-label={t('action.delete')} onClick={() => onChange(value.filter((x) => x !== u))} className="absolute end-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-ink-900/70 text-white">
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input ref={input} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => void pick(e.target.files)} />
      <Button variant="outline" disabled={busy || value.length >= 10} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} onClick={() => input.current?.click()}>
        {t('money.claims.addEvidence')}
      </Button>
    </div>
  );
}

const TYPES = Object.values(ClaimType);

/**
 * Brand claim wizard: 1) the parcel, 2) what happened, 3) amount, story and
 * evidence, 4) review. The order can be preset (order detail page).
 */
export function NewClaimModal({ open, onClose, preset, onCreated }: {
  open: boolean; onClose: () => void; preset?: { orderId: string; trackingNumber: string; declaredValueCents?: number } | null; onCreated?: (id: string) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [step, setStep] = useState(preset ? 1 : 0);
  const [tn, setTn] = useState(preset?.trackingNumber ?? '');
  const [type, setType] = useState<ClaimType | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [evidence, setEvidence] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const reset = () => {
    setStep(preset ? 1 : 0);
    setTn(preset?.trackingNumber ?? '');
    setType(null);
    setAmount('');
    setDescription('');
    setEvidence([]);
  };
  const close = () => {
    reset();
    onClose();
  };
  const cents = parseEgp(amount) ?? 0;
  const m = useMutation({
    mutationFn: () =>
      api<ClaimDetail>('/claims', {
        method: 'POST',
        body: { ...(preset ? { orderId: preset.orderId } : { trackingNumber: tn.trim().toUpperCase() }), type, claimedCents: cents, description: description.trim(), evidence },
      }),
    onSuccess: (c) => {
      toast.success(t('money.claims.filed', { code: c.code }));
      void qc.invalidateQueries({ queryKey: ['claims'] });
      onCreated?.(c.id);
      close();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const steps = [t('money.claims.step.order'), t('money.claims.step.type'), t('money.claims.step.details'), t('money.claims.step.review')];
  const canNext = [tn.trim().length >= 6, !!type, cents >= 100 && description.trim().length >= 10 && !busy, true][step];
  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title={t('money.claims.new')}
      description={t('money.claims.newHint')}
      footer={
        <>
          {step > (preset ? 1 : 0) ? <Button variant="outline" onClick={() => setStep(step - 1)}>{t('action.back')}</Button> : <Button variant="outline" onClick={close}>{t('action.cancel')}</Button>}
          {step < 3 ? <Button disabled={!canNext} onClick={() => setStep(step + 1)}>{t('action.next')}</Button> : <Button loading={m.isPending} onClick={() => m.mutate()}>{t('money.claims.submit')}</Button>}
        </>
      }
    >
      <ol className="mb-5 flex gap-1.5" aria-label={t('money.claims.new')}>
        {steps.map((s, i) => (
          <li key={s} className="min-w-0 flex-1">
            <div className={`h-1.5 rounded-full ${i <= step ? 'bg-turtle-500' : 'bg-ink-100 dark:bg-ink-800'}`} />
            <p className={`mt-1 truncate text-[11px] ${i === step ? 'font-semibold text-ink-900 dark:text-white' : 'text-ink-400'}`}>{s}</p>
          </li>
        ))}
      </ol>
      {step === 0 && (
        <Field label={t('money.claims.tracking')} hint={t('money.claims.trackingHint')} required>
          {(id) => <Input id={id} className="ltr h-12 font-mono text-lg uppercase" value={tn} onChange={(e) => setTn(e.target.value)} placeholder="GT…" autoFocus />}
        </Field>
      )}
      {step === 1 && (
        <div role="radiogroup" aria-label={t('money.claims.step.type')} className="grid gap-2 sm:grid-cols-2">
          {TYPES.map((ty) => (
            <button
              key={ty}
              type="button"
              role="radio"
              aria-checked={type === ty}
              onClick={() => setType(ty)}
              className={`rounded-2xl border p-4 text-start transition ${type === ty ? 'border-turtle-600 bg-turtle-50 ring-2 ring-turtle-500/30 dark:border-turtle-500 dark:bg-turtle-950' : 'border-ink-200 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800'}`}
            >
              <p className="font-semibold text-ink-900 dark:text-white">{t(`money.claimType.${ty}`)}</p>
              <p className="mt-0.5 text-xs text-ink-500">{t(`money.claimRule.${ty}`)}</p>
            </button>
          ))}
        </div>
      )}
      {step === 2 && (
        <div className="space-y-4">
          <Field label={t('money.claims.claimed')} hint={preset?.declaredValueCents ? t('money.claims.capDeclared') : t('money.claims.capHint')} required>
            {(id) => <Input id={id} inputMode="decimal" className="ltr h-12 text-center font-display text-xl font-bold" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />}
          </Field>
          <Field label={t('money.claims.description')} hint={t('money.claims.descriptionHint')} required>
            {(id) => <Textarea id={id} rows={4} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink-700 dark:text-ink-200">{t('money.claims.evidence')}</p>
            <EvidenceUploader value={evidence} onChange={setEvidence} onBusy={setBusy} />
          </div>
        </div>
      )}
      {step === 3 && (
        <dl className="space-y-3 rounded-2xl bg-ink-50 p-4 text-sm dark:bg-ink-800/60">
          <div className="flex justify-between gap-3"><dt className="text-ink-500">{t('money.claims.tracking')}</dt><dd><Ltr className="font-mono font-semibold">{(preset?.trackingNumber ?? tn).toUpperCase()}</Ltr></dd></div>
          <div className="flex justify-between gap-3"><dt className="text-ink-500">{t('money.claims.step.type')}</dt><dd className="font-semibold">{type ? t(`money.claimType.${type}`) : '—'}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-ink-500">{t('money.claims.claimed')}</dt><dd><Amount cents={cents} className="font-semibold" /></dd></div>
          <div><dt className="text-ink-500">{t('money.claims.description')}</dt><dd className="mt-1 whitespace-pre-line">{description}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-ink-500">{t('money.claims.evidence')}</dt><dd>{evidence.length}</dd></div>
          <p className="text-xs text-ink-500">{t('money.claims.capNote')}</p>
        </dl>
      )}
    </Modal>
  );
}
