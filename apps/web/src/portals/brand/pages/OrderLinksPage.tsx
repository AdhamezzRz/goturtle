import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock, CheckCircle2, Copy, ExternalLink, Link2, ListOrdered, MessageCircle, MoreHorizontal, Pause, Pencil, Play, Plus, QrCode as QrIcon, Share2,
  ShoppingBag, Trash2, TrendingUp, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useQueryState } from '@/lib/hooks';
import { dateOnly, dateTime, money, num, parseEgp } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import {
  Badge, Button, Card, Checkbox, ConfirmDialog, Drawer, EmptyState, ErrorState, Field, Input, KpiCard, Menu, Modal, PageHeader, QrCode, Select, Skeleton,
  StatusBadge, Switch, Tabs, Textarea, type BadgeTone,
} from '@/components/ui';
import { copyText, useCanCreate } from '../components/common';
import type { LinkItem, LinkOrder, LinkService, OrderLink } from '@/features/intake/types';
import '@/features/intake/i18n';

const AVAIL_TONE: Record<OrderLink['availability'], BadgeTone> = { OPEN: 'success', INACTIVE: 'neutral', EXPIRED: 'warning', EXHAUSTED: 'warning', BRAND_INACTIVE: 'danger' };

/** Shareable order forms for Instagram / Facebook / WhatsApp sellers. */
export default function OrderLinksPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const create = useCanCreate();
  const [f, setF] = useQueryState({ state: '', q: '' });
  const q = useQuery({ queryKey: ['order-links', f], queryFn: () => api<Paginated<OrderLink>>('/order-links', { query: { state: f.state, q: f.q, pageSize: 100 } }) });
  const [edit, setEdit] = useState<OrderLink | 'new' | null>(null);
  const [share, setShare] = useState<OrderLink | null>(null);
  const [orders, setOrders] = useState<OrderLink | null>(null);
  const [del, setDel] = useState<OrderLink | null>(null);
  const inv = () => qc.invalidateQueries({ queryKey: ['order-links'] });
  const toggle = useMutation({
    mutationFn: (l: OrderLink) => api<OrderLink>(`/order-links/${l.id}`, { method: 'PATCH', body: { isActive: !l.isActive } }),
    onSuccess: (l) => { inv(); toast.success(l.isActive ? t('intake.links.activated') : t('intake.links.paused')); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (l: OrderLink) => api(`/order-links/${l.id}`, { method: 'DELETE' }),
    onSuccess: () => { setDel(null); inv(); toast.success(t('intake.links.deleted')); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rows = q.data?.data ?? [];
  const totals = rows.reduce((a, l) => ({ open: a.open + (l.availability === 'OPEN' ? 1 : 0), orders: a.orders + l.stats.orders, delivered: a.delivered + l.stats.delivered, cod: a.cod + l.stats.deliveredCodCents }), { open: 0, orders: 0, delivered: 0, cod: 0 });

  return (
    <div>
      <PageHeader
        title={t('intake.links.title')}
        subtitle={t('intake.links.subtitle')}
        actions={<Button icon={<Plus className="h-4 w-4" />} disabled={!create.allowed} title={create.reason || undefined} onClick={() => setEdit('new')}>{t('intake.links.new')}</Button>}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={t('intake.links.kpi.open')} value={num(totals.open)} icon={<Link2 className="h-5 w-5" />} />
        <KpiCard label={t('intake.links.kpi.orders')} value={num(totals.orders)} icon={<ShoppingBag className="h-5 w-5" />} tone="sky" />
        <KpiCard label={t('intake.links.kpi.delivered')} value={num(totals.delivered)} hint={totals.orders ? `${Math.round((totals.delivered / totals.orders) * 100)}%` : undefined} icon={<CheckCircle2 className="h-5 w-5" />} tone="violet" />
        <KpiCard label={t('intake.links.kpi.cod')} value={money(totals.cod, { compact: true })} icon={<TrendingUp className="h-5 w-5" />} tone="sand" />
      </div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={f.state || 'all'} onChange={(v) => setF({ state: v === 'all' ? '' : v })} tabs={[{ value: 'all', label: t('common.all') }, { value: 'active', label: t('intake.links.active') }, { value: 'inactive', label: t('intake.links.inactive') }]} />
        <Input className="sm:w-64" value={f.q} onChange={(e) => setF({ q: e.target.value })} placeholder={t('intake.links.search')} aria-label={t('action.search')} />
      </div>

      {q.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-64 rounded-2xl" />)}</div>
      ) : q.isError ? (
        <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
      ) : !rows.length ? (
        <Card>
          <EmptyState
            icon={<Link2 className="h-7 w-7" />}
            title={f.q || f.state ? t('common.noResults') : t('intake.links.empty')}
            description={t('intake.links.emptyHint')}
            action={create.allowed && !f.q && !f.state ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>{t('intake.links.new')}</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
          {rows.map((l) => (
            <Card key={l.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={AVAIL_TONE[l.availability]} dot>{t(`intake.links.avail.${l.availability}`)}</Badge>
                    <code className="ltr rounded-md bg-ink-100 px-1.5 py-0.5 font-mono text-xs text-ink-700 dark:bg-ink-800 dark:text-ink-200">{l.code}</code>
                  </div>
                  <h3 className="mt-2 line-clamp-2 font-semibold text-ink-900 dark:text-white">{l.title}</h3>
                  <p className="mt-0.5 text-xs text-ink-500">{t('intake.links.nItems', { n: num(l.items.reduce((s, i) => s + i.quantity, 0)) })} · {l.paymentMethod === 'COD' ? t('intake.links.cod') : t('intake.links.prepaid')}</p>
                </div>
                <Menu
                  trigger={<Button size="sm" variant="ghost" icon={<MoreHorizontal className="h-4 w-4" />} aria-label={t('common.actions')} />}
                  items={[
                    { label: t('action.edit'), icon: <Pencil className="h-4 w-4" />, onClick: () => setEdit(l) },
                    { label: t('intake.links.orders'), icon: <ListOrdered className="h-4 w-4" />, onClick: () => setOrders(l) },
                    { label: l.isActive ? t('intake.links.pause') : t('intake.links.activate'), icon: l.isActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />, onClick: () => toggle.mutate(l) },
                    { label: t('action.delete'), icon: <Trash2 className="h-4 w-4" />, onClick: () => setDel(l), danger: true, hidden: l.stats.orders > 0 },
                  ]}
                />
              </div>
              <p className="ltr mt-4 text-start font-display text-2xl font-bold text-ink-900 dark:text-white">{money(l.paymentMethod === 'COD' ? l.codAmountCents : l.itemsTotalCents)}</p>
              <dl className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-ink-50 p-3 text-center dark:bg-ink-800/50">
                <div><dt className="text-[11px] text-ink-500">{t('intake.links.uses')}</dt><dd className="font-semibold">{num(l.usesCount)}{l.maxUses ? <span className="text-ink-400">/{num(l.maxUses)}</span> : null}</dd></div>
                <div><dt className="text-[11px] text-ink-500">{t('intake.links.delivered')}</dt><dd className="font-semibold">{num(l.stats.delivered)}</dd></div>
                <div><dt className="text-[11px] text-ink-500">{t('intake.links.rate')}</dt><dd className="font-semibold">{l.stats.deliveryRate === null ? '—' : `${num(l.stats.deliveryRate)}%`}</dd></div>
              </dl>
              {l.expiresAt && <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-500"><CalendarClock className="h-3.5 w-3.5" />{t('intake.links.expires', { date: dateTime(l.expiresAt) })}</p>}
              <div className="mt-auto flex gap-2 pt-4">
                <Button className="flex-1" icon={<Share2 className="h-4 w-4" />} disabled={l.availability !== 'OPEN'} onClick={() => setShare(l)}>{t('intake.links.share')}</Button>
                <Button variant="outline" icon={<Copy className="h-4 w-4" />} aria-label={t('action.copy')} onClick={() => copyText(l.url, t('action.copied'))} />
              </div>
            </Card>
          ))}
        </div>
      )}

      <LinkEditor open={!!edit} link={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={(l, created) => { inv(); setEdit(null); if (created) setShare(l); }} />
      <ShareModal link={share} onClose={() => setShare(null)} />
      <OrdersDrawer link={orders} onClose={() => setOrders(null)} />
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} loading={remove.isPending} danger title={t('intake.links.deleteTitle')} description={t('intake.links.deleteBody')} confirmLabel={t('action.delete')} />
    </div>
  );
}

// ------------------------------------------------------------------ editor

type ItemDraft = { name: string; quantity: string; price: string };
const toDraft = (i: LinkItem): ItemDraft => ({ name: i.name, quantity: String(i.quantity), price: String(i.priceCents / 100) });

function LinkEditor({ open, link, onClose, onSaved }: { open: boolean; link: OrderLink | null; onClose: () => void; onSaved: (l: OrderLink, created: boolean) => void }) {
  const { t } = useI18n();
  const blank = { title: '', description: '', items: [{ name: '', quantity: '1', price: '' }] as ItemDraft[], paymentMethod: 'COD' as 'COD' | 'PREPAID', codOverride: false, cod: '', serviceLevel: 'STANDARD' as LinkService, weight: '1', allowOpening: false, notes: '', maxUses: '', expiresAt: '', isActive: true };
  const [f, setF] = useState(blank);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTouched(false);
    if (!link) return setF(blank);
    const sum = link.items.reduce((s, i) => s + i.quantity * i.priceCents, 0);
    setF({
      title: link.title, description: link.description ?? '', items: link.items.map(toDraft), paymentMethod: link.paymentMethod, codOverride: link.paymentMethod === 'COD' && link.codAmountCents !== sum,
      cod: String(link.codAmountCents / 100), serviceLevel: link.serviceLevel, weight: String(link.weightGrams / 1000), allowOpening: link.allowOpening, notes: link.notes ?? '',
      maxUses: link.maxUses ? String(link.maxUses) : '', expiresAt: link.expiresAt ? new Date(link.expiresAt).toISOString().slice(0, 10) : '', isActive: link.isActive,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, link]);
  const items = f.items.map((i) => ({ name: i.name.trim(), quantity: Math.round(Number(i.quantity)), priceCents: parseEgp(i.price) ?? -1 }));
  const itemsOk = items.length > 0 && items.every((i) => i.name && Number.isInteger(i.quantity) && i.quantity >= 1 && i.quantity <= 999 && i.priceCents >= 0);
  const total = items.reduce((s, i) => s + (i.priceCents > 0 ? i.priceCents * Math.max(0, i.quantity) : 0), 0);
  const cod = f.paymentMethod === 'COD' ? (f.codOverride ? parseEgp(f.cod) ?? -1 : total) : 0;
  const errors = {
    title: f.title.trim().length < 2 ? t('intake.links.err.title') : undefined,
    items: !itemsOk ? t('intake.links.err.items') : undefined,
    cod: f.paymentMethod === 'COD' && cod <= 0 ? t('intake.links.err.cod') : undefined,
    weight: !(Number(f.weight) > 0 && Number(f.weight) <= 100) ? t('intake.links.err.weight') : undefined,
    maxUses: f.maxUses && !(Number.isInteger(Number(f.maxUses)) && Number(f.maxUses) >= 1) ? t('intake.links.err.maxUses') : undefined,
  };
  const valid = !Object.values(errors).some(Boolean);
  const m = useMutation({
    mutationFn: () => {
      const body = {
        title: f.title.trim(), description: f.description.trim(), items, paymentMethod: f.paymentMethod, serviceLevel: f.serviceLevel,
        weightGrams: Math.round(Number(f.weight) * 1000), allowOpening: f.allowOpening, notes: f.notes.trim(), isActive: f.isActive,
        maxUses: f.maxUses ? Number(f.maxUses) : null,
        expiresAt: f.expiresAt ? new Date(`${f.expiresAt}T23:59:59+02:00`).toISOString() : null,
        // Explicit amount, or null on edit = follow the items total (omitted on create = items total).
        ...(f.paymentMethod === 'COD' && (f.codOverride || link) ? { codAmountCents: f.codOverride ? cod : null } : {}),
      };
      return link ? api<OrderLink>(`/order-links/${link.id}`, { method: 'PATCH', body }) : api<OrderLink>('/order-links', { method: 'POST', body });
    },
    onSuccess: (l) => { toast.success(link ? t('intake.links.saved') : t('intake.links.created')); onSaved(l, !link); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setItem = (i: number, patch: Partial<ItemDraft>) => setF((s) => ({ ...s, items: s.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) }));
  const err = (k: keyof typeof errors) => (touched ? errors[k] : undefined);
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={link ? t('intake.links.edit') : t('intake.links.new')}
      description={t('intake.links.editorHint')}
      footer={<><Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button loading={m.isPending} onClick={() => { setTouched(true); if (valid) m.mutate(); }}>{link ? t('action.save') : t('intake.links.createCta')}</Button></>}
    >
      <div className="space-y-4">
        <Field label={t('intake.links.f.title')} required error={err('title')}>{(id) => <Input id={id} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={t('intake.links.f.titlePh')} invalid={!!err('title')} />}</Field>
        <Field label={t('intake.links.f.description')}>{(id) => <Textarea id={id} rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>

        <fieldset className="rounded-xl border border-ink-100 p-3 dark:border-ink-800">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">{t('intake.links.f.items')}</legend>
          <div className="space-y-2">
            {f.items.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_4.5rem_6.5rem_auto] items-end gap-2">
                <Field label={i === 0 ? t('intake.links.f.itemName') : undefined}>{(id) => <Input id={id} value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} aria-label={t('intake.links.f.itemName')} />}</Field>
                <Field label={i === 0 ? t('intake.links.f.qty') : undefined}>{(id) => <Input id={id} type="number" min={1} max={999} dir="ltr" value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} aria-label={t('intake.links.f.qty')} />}</Field>
                <Field label={i === 0 ? t('intake.links.f.price') : undefined}>{(id) => <Input id={id} inputMode="decimal" dir="ltr" value={it.price} onChange={(e) => setItem(i, { price: e.target.value })} placeholder="0" aria-label={t('intake.links.f.price')} />}</Field>
                <Button variant="ghost" size="md" className="!px-2" aria-label={t('action.delete')} disabled={f.items.length === 1} onClick={() => setF({ ...f, items: f.items.filter((_, k) => k !== i) })}><X className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <Button size="sm" variant="outline" icon={<Plus className="h-3.5 w-3.5" />} disabled={f.items.length >= 50} onClick={() => setF({ ...f, items: [...f.items, { name: '', quantity: '1', price: '' }] })}>{t('intake.links.f.addItem')}</Button>
            <span className="text-sm text-ink-500">{t('common.total')}: <span className="ltr font-semibold text-ink-900 dark:text-white">{money(total)}</span></span>
          </div>
          {err('items') && <p className="mt-2 text-xs font-medium text-red-600">{err('items')}</p>}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('intake.links.f.payment')}>
            {(id) => <Select id={id} value={f.paymentMethod} onChange={(e) => setF({ ...f, paymentMethod: e.target.value as 'COD' | 'PREPAID' })} options={[{ value: 'COD', label: t('intake.links.cod') }, { value: 'PREPAID', label: t('intake.links.prepaid') }]} />}
          </Field>
          <Field label={t('intake.links.f.service')}>
            {(id) => <Select id={id} value={f.serviceLevel} onChange={(e) => setF({ ...f, serviceLevel: e.target.value as LinkService })} options={(['STANDARD', 'SAME_DAY', 'EXPRESS'] as const).map((s) => ({ value: s, label: t(`intake.service.${s}`) }))} />}
          </Field>
        </div>
        {f.paymentMethod === 'COD' && (
          <div className="rounded-xl bg-sand-50 p-3 dark:bg-sand-950/30">
            <Checkbox checked={f.codOverride} onChange={(e) => setF({ ...f, codOverride: e.target.checked, cod: f.cod || String(total / 100) })} label={t('intake.links.f.codOverride')} />
            {f.codOverride ? (
              <Field className="mt-3" label={t('intake.links.f.cod')} error={err('cod')}>{(id) => <Input id={id} inputMode="decimal" dir="ltr" value={f.cod} onChange={(e) => setF({ ...f, cod: e.target.value })} invalid={!!err('cod')} trailing={<span className="text-xs">{t('common.egp')}</span>} />}</Field>
            ) : (
              <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">{t('intake.links.f.codAuto', { amount: money(total) })}</p>
            )}
            {!f.codOverride && err('cod') && <p className="mt-1 text-xs font-medium text-red-600">{err('cod')}</p>}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('intake.links.f.weight')} error={err('weight')}>{(id) => <Input id={id} type="number" min={0.1} step={0.1} dir="ltr" value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} trailing={<span className="text-xs">{t('intake.kg')}</span>} />}</Field>
          <Field label={t('intake.links.f.maxUses')} hint={t('intake.links.f.maxUsesHint')} error={err('maxUses')}>{(id) => <Input id={id} type="number" min={1} dir="ltr" value={f.maxUses} onChange={(e) => setF({ ...f, maxUses: e.target.value })} />}</Field>
          <Field label={t('intake.links.f.expiresAt')}>{(id) => <Input id={id} type="date" dir="ltr" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} />}</Field>
        </div>
        <Field label={t('intake.links.f.notes')} hint={t('intake.links.f.notesHint')}>{(id) => <Input id={id} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
        <div className="flex flex-wrap gap-6">
          <Switch checked={f.allowOpening} onChange={(v) => setF({ ...f, allowOpening: v })} label={t('intake.links.f.allowOpening')} />
          <Switch checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label={t('intake.links.f.active')} />
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ share

function whatsappText(l: Pick<OrderLink, 'title' | 'url' | 'codAmountCents' | 'itemsTotalCents' | 'paymentMethod'>, brand: string, t: (k: string, v?: Record<string, string | number>) => string) {
  return t('intake.links.waText', { title: l.title, brand, price: money(l.paymentMethod === 'COD' ? l.codAmountCents : l.itemsTotalCents), url: l.url });
}

function ShareModal({ link, onClose }: { link: OrderLink | null; onClose: () => void }) {
  const { t } = useI18n();
  const { me } = useAuth();
  if (!link) return null;
  const text = whatsappText(link, me?.brand?.name ?? '', t);
  const native = async () => {
    try {
      await navigator.share({ title: link.title, text, url: link.url });
    } catch {
      /* dismissed */
    }
  };
  return (
    <Modal open onClose={onClose} title={t('intake.links.shareTitle')} description={link.title} footer={<Button onClick={onClose}>{t('action.close')}</Button>}>
      <div className="space-y-4">
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-ink-50 p-4 dark:bg-ink-800/50 sm:flex-row sm:items-start">
          <div className="rounded-xl bg-white p-2 shadow-sm"><QrCode value={link.url} size={132} /></div>
          <div className="min-w-0 flex-1 text-center sm:text-start">
            <p className="flex items-center justify-center gap-1.5 text-xs text-ink-500 sm:justify-start"><QrIcon className="h-3.5 w-3.5" />{t('intake.links.qrHint')}</p>
            <div className="mt-2 flex items-center gap-1 rounded-lg bg-white px-2 py-1.5 dark:bg-ink-900" dir="ltr">
              <code className="min-w-0 flex-1 truncate font-mono text-xs">{link.url}</code>
              <button type="button" className="rounded p-1 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800" aria-label={t('action.copy')} onClick={() => copyText(link.url, t('action.copied'))}><Copy className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="contents">
            <Button className="bg-[#25D366] text-white hover:bg-[#1ebe57]" icon={<MessageCircle className="h-4 w-4" />}>{t('action.whatsapp')}</Button>
          </a>
          <Button variant="outline" icon={<Copy className="h-4 w-4" />} onClick={() => copyText(text, t('action.copied'))}>{t('intake.links.copyMessage')}</Button>
          {typeof navigator.share === 'function' ? (
            <Button variant="outline" icon={<Share2 className="h-4 w-4" />} onClick={native}>{t('intake.links.moreApps')}</Button>
          ) : (
            <a href={link.url} target="_blank" rel="noreferrer" className="contents"><Button variant="outline" icon={<ExternalLink className="h-4 w-4" />}>{t('intake.links.preview')}</Button></a>
          )}
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-ink-500">{t('intake.links.messagePreview')}</p>
          <p className="whitespace-pre-line rounded-2xl rounded-ss-sm bg-[#dcf8c6] px-3 py-2 text-sm text-ink-900">{text}</p>
        </div>
      </div>
    </Modal>
  );
}

function OrdersDrawer({ link, onClose }: { link: OrderLink | null; onClose: () => void }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['order-links', link?.id, 'orders'], queryFn: () => api<LinkOrder[]>(`/order-links/${link!.id}/orders`), enabled: !!link });
  return (
    <Drawer open={!!link} onClose={onClose} title={t('intake.links.ordersTitle')} >
      {link && (
        <div className="space-y-3">
          <p className="text-sm text-ink-500">{link.title} · <span className="ltr">{link.code}</span></p>
          {q.isLoading ? <Skeleton className="h-40" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length ? (
            <EmptyState icon={<ShoppingBag className="h-6 w-6" />} title={t('intake.links.noOrders')} description={t('intake.links.noOrdersHint')} />
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {q.data.map((o) => (
                <li key={o.id}>
                  <Link to={`/brand/orders/${o.id}`} className={cn('flex items-center justify-between gap-3 rounded-xl px-2 py-3 hover:bg-ink-50 dark:hover:bg-ink-800/50')}>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink-900 dark:text-white">{o.recipientName}</p>
                      <p className="ltr text-start font-mono text-xs text-ink-500">{o.trackingNumber} · {o.brandReference}</p>
                      <p className="text-xs text-ink-400">{dateOnly(o.createdAt)}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <StatusBadge status={o.status} />
                      <span className="ltr text-xs font-semibold">{money(o.codAmountCents)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Drawer>
  );
}
