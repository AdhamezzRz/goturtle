import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, CheckCircle2, Pencil, Plus, Search, Trash2, Warehouse, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { num, pct } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, IconButton, Input, Modal, Select, Skeleton, Switch, Textarea } from '@/components/ui';
import { Mono, PhoneLink, SectionCard } from '../../components/opsa/ui';
import { OpsMap } from '../../components/opsa/OpsMap';
import type { CityRow, GovernorateRow, HubRow, ZoneRow } from '../../components/opsa/types';
import './i18n';

const TIER_COLORS: Record<string, string> = { A: '#0e9158', B: '#2a78d6', C: '#eb6834', D: '#6250d6' };

function useNetworkInvalidate() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ['network'] });
}

// ------------------------------------------------------------------ hubs

export function HubsTab() {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['network', 'hubs'], queryFn: () => api<HubRow[]>('/network/hubs') });
  const [editing, setEditing] = useState<HubRow | 'new' | null>(null);
  const [focus, setFocus] = useState<HubRow | null>(null);
  const hubs = q.data ?? [];
  return (
    <div className="space-y-4">
      {can('network.manage') && <div className="flex justify-end"><Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>{t('ops.network.newHub')}</Button></div>}
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="grid min-w-0 content-start gap-3 sm:grid-cols-2 xl:col-span-3">
          {q.isLoading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
          {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
          {hubs.map((h) => (
            <div key={h.id} className="rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900">
              <div className="flex items-start justify-between gap-2">
                <button type="button" className="flex min-w-0 items-center gap-3 text-start" onClick={() => setFocus(h)}>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-900 text-turtle-300 dark:bg-ink-800"><Warehouse className="h-5 w-5" /></span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink-900 dark:text-white">{locale === 'ar' ? h.nameAr ?? h.name : h.name}</span>
                    <Mono className="text-xs text-ink-400">{h.code}</Mono>
                  </span>
                </button>
                {can('network.manage') && <IconButton label={t('action.edit')} icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(h)} />}
              </div>
              <p className="mt-3 line-clamp-2 text-sm text-ink-600 dark:text-ink-300">{h.address}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <Badge tone={h.isActive ? 'success' : 'neutral'}>{h.isActive ? t('ops.network.active') : t('ops.network.inactive')}</Badge>
                <Badge tone="info">{t('ops.network.zonesN', { n: num(h.zonesCount) })}</Badge>
                {h.phone && <PhoneLink value={h.phone} className="ms-auto text-xs" />}
              </div>
            </div>
          ))}
        </div>
        <div className="min-w-0 xl:col-span-2">
          <OpsMap markers={hubs.map((h) => ({ id: h.id, type: 'hub' as const, lat: h.lat, lng: h.lng, title: `${h.name} · ${h.code}`, onClick: () => setFocus(h) }))} height={420} flyTo={focus ? [focus.lat, focus.lng] : null} className="xl:sticky xl:top-24" />
        </div>
      </div>
      {editing && <HubModal hub={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function HubModal({ hub, onClose }: { hub: HubRow | null; onClose: () => void }) {
  const { t } = useI18n();
  const invalidate = useNetworkInvalidate();
  const [v, setV] = useState({ code: hub?.code ?? '', name: hub?.name ?? '', nameAr: hub?.nameAr ?? '', address: hub?.address ?? '', lat: hub ? String(hub.lat) : '', lng: hub ? String(hub.lng) : '', phone: hub?.phone ?? '', isActive: hub?.isActive ?? true });
  const [touched, setTouched] = useState(false);
  const [del, setDel] = useState(false);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((p) => ({ ...p, [k]: val }));
  const lat = Number(v.lat);
  const lng = Number(v.lng);
  const errors: Record<string, string> = {};
  if (!/^[A-Z0-9_-]{2,32}$/.test(v.code)) errors.code = 'A-Z 0-9 - _';
  if (v.name.trim().length < 2) errors.name = t('ops.opsa.required');
  if (v.address.trim().length < 5) errors.address = t('ops.opsa.required');
  if (!v.lat || !Number.isFinite(lat) || Math.abs(lat) > 90) errors.lat = t('ops.opsa.required');
  if (!v.lng || !Number.isFinite(lng) || Math.abs(lng) > 180) errors.lng = t('ops.opsa.required');
  const save = useMutation({
    mutationFn: () => {
      const body = { code: v.code, name: v.name.trim(), nameAr: v.nameAr.trim() || undefined, address: v.address.trim(), lat, lng, phone: v.phone || undefined, isActive: v.isActive };
      return hub ? api(`/network/hubs/${hub.id}`, { method: 'PATCH', body }) : api('/network/hubs', { method: 'POST', body });
    },
    onSuccess: () => { toast.success(t('ops.network.saved')); invalidate(); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/network/hubs/${hub!.id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.success(t('ops.network.deleted')); invalidate(); onClose(); },
    onError: (e) => { setDel(false); toast.error(errorMessage(e)); },
  });
  const err = (k: string) => (touched ? errors[k] : undefined);
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={hub ? t('ops.network.editHub', { code: hub.code }) : t('ops.network.newHub')}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {hub ? <Button variant="ghost" className="text-red-600" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDel(true)}>{t('action.delete')}</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
            <Button loading={save.isPending} onClick={() => { setTouched(true); if (!Object.keys(errors).length) save.mutate(); }}>{t('action.save')}</Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('ops.network.nameEn')} required error={err('name')}>{(id) => <Input id={id} value={v.name} onChange={(e) => set('name', e.target.value)} />}</Field>
        <Field label={t('ops.network.nameAr')}>{(id) => <Input id={id} value={v.nameAr} onChange={(e) => set('nameAr', e.target.value)} dir="rtl" />}</Field>
        <Field label={t('ops.network.code')} required error={err('code')}>{(id) => <Input id={id} value={v.code} onChange={(e) => set('code', e.target.value.toUpperCase())} className="ltr font-mono" placeholder="HUB-ALX" />}</Field>
        <Field label={t('ops.network.phone')}>{(id) => <Input id={id} value={v.phone} onChange={(e) => set('phone', e.target.value)} className="ltr" inputMode="tel" />}</Field>
        <Field label={t('ops.network.address')} required error={err('address')} className="sm:col-span-2">{(id) => <Textarea id={id} value={v.address} onChange={(e) => set('address', e.target.value)} className="min-h-[60px]" />}</Field>
        <Field label={t('ops.network.lat')} required error={err('lat')}>{(id) => <Input id={id} value={v.lat} onChange={(e) => set('lat', e.target.value)} className="ltr" inputMode="decimal" />}</Field>
        <Field label={t('ops.network.lng')} required error={err('lng')}>{(id) => <Input id={id} value={v.lng} onChange={(e) => set('lng', e.target.value)} className="ltr" inputMode="decimal" />}</Field>
        <div className="sm:col-span-2"><Switch checked={v.isActive} onChange={(x) => set('isActive', x)} label={t('ops.network.active')} /></div>
      </div>
      <ConfirmDialog open={del} onClose={() => setDel(false)} onConfirm={() => remove.mutate()} loading={remove.isPending} danger title={t('ops.network.deleteTitle', { name: hub?.code ?? '' })} description={t('ops.network.deleteDesc')} confirmLabel={t('action.delete')} />
    </Modal>
  );
}

// ------------------------------------------------------------------ governorates & cities

export function GeoTab() {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const govs = useQuery({ queryKey: ['network', 'governorates'], queryFn: () => api<GovernorateRow[]>('/network/governorates') });
  const cities = useQuery({ queryKey: ['network', 'cities'], queryFn: () => api<CityRow[]>('/network/cities') });
  const [editGov, setEditGov] = useState<GovernorateRow | 'new' | null>(null);
  const [editCity, setEditCity] = useState<CityRow | 'new' | null>(null);
  const name = (x: { nameEn: string; nameAr: string }) => (locale === 'ar' ? x.nameAr : x.nameEn);
  const manage = can('network.manage');
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard title={t('ops.network.governorate')} padded={false} actions={manage && <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setEditGov('new')}>{t('ops.network.newGov')}</Button>}>
        {govs.isLoading ? <div className="p-5"><Skeleton className="h-20" /></div> : (
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {(govs.data ?? []).map((g) => (
              <li key={g.id} className="flex items-center gap-3 px-5 py-3">
                <Building2 className="h-4 w-4 text-ink-400" />
                <div className="min-w-0 flex-1"><p className="font-medium">{name(g)}</p><p className="text-xs text-ink-500"><span className="ltr">{g.code}</span> · {t('ops.network.citiesN', { n: num(g.citiesCount) })}</p></div>
                {manage && <IconButton label={t('action.edit')} icon={<Pencil className="h-4 w-4" />} onClick={() => setEditGov(g)} />}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <SectionCard title={t('ops.network.city')} padded={false} actions={manage && <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setEditCity('new')}>{t('ops.network.newCity')}</Button>}>
        {cities.isLoading ? <div className="p-5"><Skeleton className="h-20" /></div> : (
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {(cities.data ?? []).map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1"><p className="font-medium">{name(c)}</p><p className="text-xs text-ink-500"><span className="ltr">{c.code}</span> · {name(c.governorate)} · {t('ops.network.zonesN', { n: num(c.zonesCount) })}</p></div>
                {manage && <IconButton label={t('action.edit')} icon={<Pencil className="h-4 w-4" />} onClick={() => setEditCity(c)} />}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      {editGov && <GeoModal kind="gov" row={editGov === 'new' ? null : editGov} govs={govs.data ?? []} onClose={() => setEditGov(null)} />}
      {editCity && <GeoModal kind="city" row={editCity === 'new' ? null : editCity} govs={govs.data ?? []} onClose={() => setEditCity(null)} />}
    </div>
  );
}

function GeoModal({ kind, row, govs, onClose }: { kind: 'gov' | 'city'; row: GovernorateRow | CityRow | null; govs: GovernorateRow[]; onClose: () => void }) {
  const { t, locale } = useI18n();
  const invalidate = useNetworkInvalidate();
  const [v, setV] = useState({ code: row?.code ?? '', nameEn: row?.nameEn ?? '', nameAr: row?.nameAr ?? '', governorateId: (row as CityRow | null)?.governorateId ?? govs[0]?.id ?? '' });
  const [touched, setTouched] = useState(false);
  const [del, setDel] = useState(false);
  useEffect(() => { if (!v.governorateId && govs[0]) setV((p) => ({ ...p, governorateId: govs[0].id })); }, [govs, v.governorateId]);
  const base = kind === 'gov' ? '/network/governorates' : '/network/cities';
  const errors: Record<string, string> = {};
  if (!(kind === 'gov' ? /^[A-Z]{2,10}$/ : /^[A-Z0-9_-]{2,32}$/).test(v.code)) errors.code = kind === 'gov' ? 'A-Z (2–10)' : 'A-Z 0-9 - _';
  if (v.nameEn.trim().length < 2) errors.nameEn = t('ops.opsa.required');
  if (v.nameAr.trim().length < 2) errors.nameAr = t('ops.opsa.required');
  if (kind === 'city' && !v.governorateId) errors.governorateId = t('ops.opsa.required');
  const save = useMutation({
    mutationFn: () => {
      const body = kind === 'gov' ? { code: v.code, nameEn: v.nameEn.trim(), nameAr: v.nameAr.trim() } : { code: v.code, nameEn: v.nameEn.trim(), nameAr: v.nameAr.trim(), governorateId: v.governorateId };
      return row ? api(`${base}/${row.id}`, { method: 'PATCH', body }) : api(base, { method: 'POST', body });
    },
    onSuccess: () => { toast.success(t('ops.network.saved')); invalidate(); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api(`${base}/${row!.id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.success(t('ops.network.deleted')); invalidate(); onClose(); },
    onError: (e) => { setDel(false); toast.error(errorMessage(e)); },
  });
  const err = (k: string) => (touched ? errors[k] : undefined);
  const title = kind === 'gov' ? (row ? t('ops.network.editGov') : t('ops.network.newGov')) : row ? t('ops.network.editCity') : t('ops.network.newCity');
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {row ? <Button variant="ghost" className="text-red-600" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDel(true)}>{t('action.delete')}</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
            <Button loading={save.isPending} onClick={() => { setTouched(true); if (!Object.keys(errors).length) save.mutate(); }}>{t('action.save')}</Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('ops.network.nameEn')} required error={err('nameEn')}>{(id) => <Input id={id} value={v.nameEn} onChange={(e) => setV({ ...v, nameEn: e.target.value })} />}</Field>
        <Field label={t('ops.network.nameAr')} required error={err('nameAr')}>{(id) => <Input id={id} value={v.nameAr} onChange={(e) => setV({ ...v, nameAr: e.target.value })} dir="rtl" />}</Field>
        <Field label={t('ops.network.code')} required error={err('code')}>{(id) => <Input id={id} value={v.code} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} className="ltr font-mono" />}</Field>
        {kind === 'city' && (
          <Field label={t('ops.network.governorate')} required error={err('governorateId')}>
            {(id) => <Select id={id} value={v.governorateId} onChange={(e) => setV({ ...v, governorateId: e.target.value })} options={govs.map((g) => ({ value: g.id, label: locale === 'ar' ? g.nameAr : g.nameEn }))} />}
          </Field>
        )}
      </div>
      <ConfirmDialog open={del} onClose={() => setDel(false)} onConfirm={() => remove.mutate()} loading={remove.isPending} danger title={t('ops.network.deleteTitle', { name: row?.code ?? '' })} description={t('ops.network.deleteDesc')} confirmLabel={t('action.delete')} />
    </Modal>
  );
}

// ------------------------------------------------------------------ detect-zone tester

interface DetectResult { match: { zoneId: string; code: string; confidence: number; method: string; matched: string } | null; zone: ZoneRow | null; hint?: string }

const EXAMPLES = ['12 شارع عباس العقاد، مدينة نصر', 'Villa 5, Street 9, Maadi', 'التجمع الخامس، الحي الأول', '26th of July Corridor, Sheikh Zayed'];

export function TesterTab() {
  const { t, locale } = useI18n();
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const detect = useMutation({
    mutationFn: (a: string) => api<DetectResult>('/network/detect-zone', { method: 'POST', body: { address: a, lat: lat ? Number(lat) : undefined, lng: lng ? Number(lng) : undefined } }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const r = detect.data;
  const run = (a = address) => a.trim().length >= 2 && detect.mutate(a.trim());
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard title={t('ops.network.tester.title')} subtitle={t('ops.network.tester.hint')}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(); }}>
          <Field label={t('ops.network.tester.address')}>{(id) => <Textarea id={id} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('ops.network.tester.lat')}>{(id) => <Input id={id} value={lat} onChange={(e) => setLat(e.target.value)} className="ltr" inputMode="decimal" />}</Field>
            <Field label={t('ops.network.tester.lng')}>{(id) => <Input id={id} value={lng} onChange={(e) => setLng(e.target.value)} className="ltr" inputMode="decimal" />}</Field>
          </div>
          <Button type="submit" icon={<Search className="h-4 w-4" />} loading={detect.isPending} disabled={address.trim().length < 2}>{t('ops.network.tester.run')}</Button>
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
            <span className="text-ink-500">{t('ops.network.tester.examples')}</span>
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => { setAddress(ex); run(ex); }} className="rounded-full bg-ink-100 px-2.5 py-1 text-ink-700 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-200">{ex}</button>
            ))}
          </div>
        </form>
      </SectionCard>
      <SectionCard title={r?.zone ? t('ops.network.tester.match', { zone: locale === 'ar' ? r.zone.nameAr : r.zone.nameEn }) : r ? t('ops.network.tester.nomatch') : t('ops.network.tester.run')}>
        {!r ? (
          <EmptyState icon={<Search className="h-7 w-7" />} title={t('ops.network.tester.hint')} className="py-8" />
        ) : r.zone && r.match ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl bg-turtle-50 p-3 dark:bg-turtle-950/50">
              <CheckCircle2 className="h-6 w-6 text-turtle-600" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{locale === 'ar' ? r.zone.nameAr : r.zone.nameEn} <Mono className="text-xs text-ink-500">{r.zone.code}</Mono></p>
                <p className="text-xs text-ink-500">{t('ops.opsa.tier', { t: r.zone.tier })} · <span className="ltr">{r.zone.hub?.code ?? '—'}</span> · {t('ops.opsa.unit.h', { n: num(r.zone.slaHours) })}</p>
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-xl bg-ink-50 p-3 dark:bg-ink-800/60"><dt className="text-xs text-ink-500">{t('ops.network.tester.confidence')}</dt><dd className="font-display text-lg font-bold"><span className="ltr">{pct(r.match.confidence, 0)}</span></dd></div>
              <div className="rounded-xl bg-ink-50 p-3 dark:bg-ink-800/60"><dt className="text-xs text-ink-500">{t('ops.network.tester.method')}</dt><dd className="font-semibold">{t(`ops.network.method.${r.match.method}`)}</dd></div>
              <div className="rounded-xl bg-ink-50 p-3 dark:bg-ink-800/60"><dt className="text-xs text-ink-500">{t('ops.network.tester.matched')}</dt><dd className="truncate font-semibold">{r.match.matched}</dd></div>
            </dl>
            <OpsMap markers={[{ id: 'c', type: 'pin', lat: r.zone.centerLat, lng: r.zone.centerLng, color: TIER_COLORS[r.zone.tier] ?? '#0e9158', title: r.zone.code }]} circles={[{ id: 'z', center: [r.zone.centerLat, r.zone.centerLng], radius: 1600, color: TIER_COLORS[r.zone.tier] ?? '#0e9158', active: true }]} height={240} fitKey={r.zone.id} flyTo={[r.zone.centerLat, r.zone.centerLng]} />
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            <XCircle className="h-5 w-5 shrink-0" />
            <p>{r.hint ?? t('ops.network.tester.nomatch')}</p>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
