import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Send } from 'lucide-react';
import { toast } from 'sonner';
import { isValidTrackingNumber, normalizeTrackingNumber, TicketCategory, TicketPriority } from '@goturtle/shared';
import { api } from '@/lib/api';
import { errorMessage, useI18n } from '@/i18n';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import type { Ticket } from './types';

export function CreateTicketModal({ open, onClose, trackingNumber, defaultCategory }: { open: boolean; onClose: () => void; trackingNumber?: string; defaultCategory?: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const empty = { subject: '', category: defaultCategory ?? 'INQUIRY', priority: 'MEDIUM', tracking: trackingNumber ?? '', body: '' };
  const [form, setForm] = useState(empty);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setForm({ ...empty, tracking: trackingNumber ?? '', category: defaultCategory ?? 'INQUIRY' });
      setTouched(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trackingNumber, defaultCategory]);

  const tn = normalizeTrackingNumber(form.tracking);
  const errors = {
    subject: form.subject.trim().length < 3 ? t('brand.support.errSubject') : undefined,
    body: form.body.trim().length < 2 ? t('brand.support.errBody') : undefined,
    tracking: form.tracking && !isValidTrackingNumber(tn) ? t('error.INVALID_TRACKING_NUMBER') : undefined,
  };
  const valid = !errors.subject && !errors.body && !errors.tracking;

  const m = useMutation({
    mutationFn: () =>
      api<Ticket>('/tickets', {
        method: 'POST',
        body: { subject: form.subject.trim(), category: form.category, priority: form.priority, body: form.body.trim(), trackingNumber: form.tracking ? tn : undefined },
      }),
    onSuccess: (tk) => {
      toast.success(t('brand.support.created', { code: tk.code }));
      qc.invalidateQueries({ queryKey: ['tickets'] });
      onClose();
      navigate(`/brand/support/${tk.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = () => {
    setTouched(true);
    if (valid) m.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('brand.support.new')}
      description={t('brand.support.newHint')}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button loading={m.isPending} onClick={submit} icon={<Send className="h-4 w-4 rtl:-scale-x-100" />}>{t('brand.support.send')}</Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label={t('brand.support.subject')} required error={touched ? errors.subject : undefined}>
          {(id) => <Input id={id} maxLength={200} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder={t('brand.support.subjectPh')} invalid={touched && !!errors.subject} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('brand.support.category')}>
            {(id) => <Select id={id} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} options={Object.keys(TicketCategory).map((c) => ({ value: c, label: t(`brand.ticketCat.${c}`) }))} />}
          </Field>
          <Field label={t('brand.support.priority')}>
            {(id) => <Select id={id} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} options={Object.keys(TicketPriority).map((c) => ({ value: c, label: t(`state.${c}`) }))} />}
          </Field>
          <Field label={t('brand.support.order')} error={touched ? errors.tracking : undefined} hint={t('brand.common.optional')}>
            {(id) => <Input id={id} dir="ltr" className="font-mono" placeholder="GT0000000000" value={form.tracking} onChange={(e) => setForm({ ...form, tracking: e.target.value.toUpperCase() })} invalid={touched && !!errors.tracking} />}
          </Field>
        </div>
        <Field label={t('brand.support.message')} required error={touched ? errors.body : undefined}>
          {(id) => <Textarea id={id} rows={5} maxLength={5000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder={t('brand.support.messagePh')} />}
        </Field>
      </form>
    </Modal>
  );
}
