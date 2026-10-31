import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MapPinned, Plus, Trash2 } from 'lucide-react';
import { PricingTier } from '@goturtle/shared';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useQueryState } from '@/lib/hooks';
import { num } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, ConfirmDialog, DataTable, Drawer, EmptyState, Field, Input, PageHeader, Select, Switch, Tabs, type Column } from '@/components/ui';
import { Mono, NoAccess, ResponsiveFilters, SearchInput } from '../../components/opsa/ui';
import { OpsMap, type OpsMarker } from '../../components/opsa/OpsMap';
import { TagInput } from '../../components/opsa/TagInput';
import { useLookupOptions } from '../../components/opsa/lookups';
import type { CityRow, ZoneRow } from '../../components/opsa/types';
import { GeoTab, HubsTab, TesterTab } from './NetworkTabs';
import './i18n';

export const TIER_COLORS: Record<string, string> = { A: '#0e9158', B: '#2a78d6', C: '#eb6834', D: '#6250d6' };

export default function NetworkPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [f, setF] = useQueryState({ tab: 'zones', q: '', city: '', hub: '', tier: '', active: '' });
  if (!can('network.read')) return <NoAccess />;
  return (
    <div className="space-y-4">
      <PageHeader title={t('ops.network.title')} subtitle={t('ops.network.subtitle')} />
      <Tabs
        value={f.tab}
        onChange={(v) => setF({ tab: v })}
        tabs={[
          { value: 'zones', label: t('ops.network.tab.zones') },
          { value: 'hubs', label: t('ops.network.tab.hubs') },
          { value: 'geo', label: t('ops.network.tab.geo') },
          { value: 'tester', label: t('ops.network.tab.tester') },
        ]}
      />
      {f.tab === 'zones' && <ZonesTab f={f} setF={setF} />}
      {f.tab === 'hubs' && <HubsTab />}
      {f.tab === 'geo' && <GeoTab />}
      {f.tab === 'tester' && <TesterTab />}
    </div>
  );
}

function ZonesTab({ f, setF }: { f: { q: string; city: string; hub: string; tier: string; active: string }; setF: (p: Record<string, string>) => void }) {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const { hubs, hubsData } = useLookupOptions();
  const cities = useQuery({ queryKey: ['network', 'cities'], queryFn: () => api<CityRow[]>('/network/cities'), staleTime: 300_000 });
  const query = { q: f.q || undefined, cityId: f.city || undefined, hubId: f.hub || undefined, tier: f.tier || undefined, isActive: f.active === '' ? undefined : f.active === '1', pageSize: 200, order: 'asc' };
  const list = useQuery({ queryKey: ['network', 'zones', query], queryFn: () => api<Paginated<ZoneRow>>('/network/zones', { query }), placeholderData: keepPreviousData });
  const [editing, setEditing] = useState<ZoneRow | 'new' | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const zones = list.data?.data ?? [];
  const name = (z: { nameEn: string; nameAr: string }) => (locale === 'ar' ? z.nameAr : z.nameEn);

  const markers = useMemo<OpsMarker[]>(() => hubsData.map((h) => ({ id: `hub-${h.id}`, type: 'hub' as const, lat: h.lat, lng: h.lng, title: `${h.name} · ${h.code}` })), [hubsData]);
  const circles = useMemo(
    () => zones.map((z) => ({ id: z.id, center: [z.centerLat, z.centerLng] as [number, number], radius: 1600, color: z.isActive ? TIER_COLORS[z.tier] : '#8592ab', title: `${name(z)} · ${z.code} · ${t('ops.opsa.tier', { t: z.tier })}`, active: z.id === focus, onClick: () => setEditing(z) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [zones, focus, locale],
  );
  const focusZone = zones.find((z) => z.id === focus);

  const columns: Column<ZoneRow>[] = [
    { key: 'zone', header: t('ops.network.tab.zones'), cell: (z) => <div><p className="font-medium text-ink-900 dark:text-ink-100">{name(z)}</p><Mono className="text-xs text-ink-400">{z.code}</Mono></div> },
    { key: 'city', header: t('ops.network.city'), hideBelow: 'xl', cell: (z) => name(z.city) },
    { key: 'hub', header: t('ops.network.hub'), cell: (z) => (z.hub ? <Mono className="text-xs">{z.hub.code}</Mono> : <span className="text-ink-400">—</span>) },
    { key: 'tier', header: t('ops.network.tier'), cell: (z) => <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: TIER_COLORS[z.tier] }} /><b>{z.tier}</b></span> },
    { key: 'sla', header: t('ops.network.sla'), cell: (z) => <span className="whitespace-nowrap">{t('ops.opsa.unit.h', { n: num(z.slaHours) })}</span> },
    { key: 'kw', header: t('ops.network.keywords'), hideBelow: 'lg', cell: (z) => <span className="text-xs text-ink-500">{t('ops.network.keywordsN', { n: num(z.keywords?.length ?? 0) })}</span> },
    { key: 'active', header: '', cell: (z) => (z.isActive ? <Badge tone="success">{t('ops.network.active')}</Badge> : <Badge>{t('ops.network.inactive')}</Badge>) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={f.q} onChange={(v) => setF({ q: v })} placeholder={t('ops.network.search')} className="min-w-0 flex-1 md:max-w-sm" />
        <ResponsiveFilters active={[f.city, f.hub, f.tier, f.active].filter(Boolean).length} onClear={() => setF({ city: '', hub: '', tier: '', active: '' })} cols={4}>
          <Field label={t('ops.network.city')}>{(id) => <Select id={id} value={f.city} onChange={(e) => setF({ city: e.target.value })} placeholder={t('ops.opsa.any')} options={(cities.data ?? []).map((c) => ({ value: c.id, label: name(c) }))} />}</Field>
          <Field label={t('ops.network.hub')}>{(id) => <Select id={id} value={f.hub} onChange={(e) => setF({ hub: e.target.value })} placeholder={t('ops.opsa.anyHub')} options={hubs} />}</Field>
          <Field label={t('ops.network.tier')}>{(id) => <Select id={id} value={f.tier} onChange={(e) => setF({ tier: e.target.value })} placeholder={t('ops.opsa.any')} options={Object.keys(PricingTier).map((x) => ({ value: x, label: t('ops.opsa.tier', { t: x }) }))} />}</Field>
          <Field label={t('ops.network.active')}>{(id) => <Select id={id} value={f.active} onChange={(e) => setF({ active: e.target.value })} placeholder={t('ops.opsa.any')} options={[{ value: '1', label: t('ops.network.active') }, { value: '0', label: t('ops.network.inactive') }]} />}</Field>
        </ResponsiveFilters>
        {can('network.manage') && <Button className="ms-auto" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>{t('ops.network.newZone')}</Button>}
      </div>
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="min-w-0 xl:col-span-3">
          <DataTable
            columns={columns}
            rows={zones}
            rowKey={(z) => z.id}
            loading={list.isLoading}
            error={list.error}
            onRetry={() => list.refetch()}
            onRowClick={(z) => { setFocus(z.id); setEditing(z); }}
            dense
            empty={<EmptyState icon={<MapPinned className="h-7 w-7" />} title={t('ops.network.empty')} />}
            mobileCard={(z) => (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{name(z)}</p>
                  <p className="text-xs text-ink-500"><span className="ltr">{z.code}</span> · {z.hub?.code ?? '—'} · {t('ops.opsa.unit.h', { n: num(z.slaHours) })}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-lg text-xs font-bold text-white" style={{ background: TIER_COLORS[z.tier] }}>{z.tier}</span>
                  {!z.isActive && <Badge>{t('ops.network.inactive')}</Badge>}
                </div>
              </div>
            )}
          />
        </div>
        <div className="min-w-0 xl:col-span-2">
          <div className="xl:sticky xl:top-24">
            <OpsMap markers={markers} circles={circles} height={520} fitKey={`${zones.length}`} flyTo={focusZone ? [focusZone.centerLat, focusZone.centerLng] : null} padding={20} />
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-ink-500">
              {Object.entries(TIER_COLORS).map(([k, c]) => <span key={k} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />{t('ops.opsa.tier', { t: k })}</span>)}
            </div>
          </div>
        </div>
      </div>
      {editing && <ZoneDrawer zone={editing === 'new' ? null : editing} cities={cities.data ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ZoneDrawer({ zone, cities, onClose }: { zone: ZoneRow | null; cities: CityRow[]; onClose: () => void }) {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const { hubs } = useLookupOptions();
  const manage = can('network.manage');
  const [v, setV] = useState({ code: '', nameEn: '', nameAr: '', cityId: '', hubId: '', tier: 'A', slaHours: '24', keywords: [] as string[], centerLat: '', centerLng: '', isActive: true });
  const [touched, setTouched] = useState(false);
  const [del, setDel] = useState(false);
  useEffect(() => {
    setV(zone
      ? { code: zone.code, nameEn: zone.nameEn, nameAr: zone.nameAr, cityId: zone.city.id, hubId: zone.hub?.id ?? '', tier: zone.tier, slaHours: String(zone.slaHours), keywords: zone.keywords ?? [], centerLat: String(zone.centerLat), centerLng: String(zone.centerLng), isActive: zone.isActive }
      : { code: '', nameEn: '', nameAr: '', cityId: cities[0]?.id ?? '', hubId: '', tier: 'A', slaHours: '24', keywords: [], centerLat: '', centerLng: '', isActive: true });
    setTouched(false);
  }, [zone, cities]);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((p) => ({ ...p, [k]: val }));
  const errors: Record<string, string> = {};
  if (!/^[A-Z0-9_-]{2,32}$/.test(v.code)) errors.code = 'A-Z 0-9 - _';
  if (v.nameEn.trim().length < 2) errors.nameEn = t('ops.opsa.required');
  if (v.nameAr.trim().length < 2) errors.nameAr = t('ops.opsa.required');
  if (!v.cityId) errors.cityId = t('ops.opsa.required');
  const lat = Number(v.centerLat);
  const lng = Number(v.centerLng);
  if (!v.centerLat || !Number.isFinite(lat) || lat < -90 || lat > 90) errors.centerLat = t('ops.opsa.required');
  if (!v.centerLng || !Number.isFinite(lng) || lng < -180 || lng > 180) errors.centerLng = t('ops.opsa.required');
  const sla = Number(v.slaHours);
  if (!Number.isInteger(sla) || sla < 1 || sla > 240) errors.slaHours = '1–240';
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['network'] });
  };
  const save = useMutation({
    mutationFn: () => {
      const body = { code: v.code, nameEn: v.nameEn.trim(), nameAr: v.nameAr.trim(), cityId: v.cityId, hubId: v.hubId || null, tier: v.tier, slaHours: sla, keywords: v.keywords, centerLat: lat, centerLng: lng, isActive: v.isActive };
      return zone ? api(`/network/zones/${zone.id}`, { method: 'PATCH', body }) : api('/network/zones', { method: 'POST', body });
    },
    onSuccess: () => { toast.success(t('ops.network.saved')); invalidate(); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/network/zones/${zone!.id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.success(t('ops.network.deleted')); invalidate(); onClose(); },
    onError: (e) => { setDel(false); toast.error(errorMessage(e)); },
  });
  const err = (k: string) => (touched ? errors[k] : undefined);
  return (
    <Drawer
      open
      onClose={onClose}
      title={zone ? t('ops.network.editZone', { code: zone.code }) : t('ops.network.newZone')}
      footer={manage ? (
        <div className="flex w-full items-center justify-between gap-2">
          {zone ? <Button variant="ghost" className="text-red-600" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDel(true)}>{t('action.delete')}</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
            <Button loading={save.isPending} onClick={() => { setTouched(true); if (!Object.keys(errors).length) save.mutate(); }}>{t('action.save')}</Button>
          </div>
        </div>
      ) : undefined}
    >
      <fieldset disabled={!manage} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('ops.network.nameEn')} required error={err('nameEn')}>{(id) => <Input id={id} value={v.nameEn} onChange={(e) => set('nameEn', e.target.value)} />}</Field>
          <Field label={t('ops.network.nameAr')} required error={err('nameAr')}>{(id) => <Input id={id} value={v.nameAr} onChange={(e) => set('nameAr', e.target.value)} dir="rtl" />}</Field>
          <Field label={t('ops.network.code')} required error={err('code')}>{(id) => <Input id={id} value={v.code} onChange={(e) => set('code', e.target.value.toUpperCase())} className="ltr font-mono" />}</Field>
          <Field label={t('ops.network.city')} required error={err('cityId')}>{(id) => <Select id={id} value={v.cityId} onChange={(e) => set('cityId', e.target.value)} options={cities.map((c) => ({ value: c.id, label: locale === 'ar' ? c.nameAr : c.nameEn }))} />}</Field>
          <Field label={t('ops.network.hub')}>{(id) => <Select id={id} value={v.hubId} onChange={(e) => set('hubId', e.target.value)} placeholder={t('ops.network.noHub')} options={hubs} />}</Field>
          <Field label={t('ops.network.tier')} hint={t('ops.network.tierHint')}>{(id) => <Select id={id} value={v.tier} onChange={(e) => set('tier', e.target.value)} options={Object.keys(PricingTier).map((x) => ({ value: x, label: t('ops.opsa.tier', { t: x }) }))} />}</Field>
          <Field label={t('ops.network.slaHours')} error={err('slaHours')}>{(id) => <Input id={id} type="number" min={1} max={240} value={v.slaHours} onChange={(e) => set('slaHours', e.target.value)} className="ltr" />}</Field>
          <div className="flex items-end pb-2"><Switch checked={v.isActive} onChange={(x) => set('isActive', x)} label={t('ops.network.active')} /></div>
          <Field label={t('ops.network.centerLat')} required error={err('centerLat')}>{(id) => <Input id={id} inputMode="decimal" value={v.centerLat} onChange={(e) => set('centerLat', e.target.value)} className="ltr" />}</Field>
          <Field label={t('ops.network.centerLng')} required error={err('centerLng')}>{(id) => <Input id={id} inputMode="decimal" value={v.centerLng} onChange={(e) => set('centerLng', e.target.value)} className="ltr" />}</Field>
        </div>
        <p className="text-xs text-ink-500">{t('ops.network.pickOnMap')}</p>
        <Field label={t('ops.network.keywords')} hint={t('ops.network.keywordsHint')}>{(id) => <TagInput id={id} value={v.keywords} onChange={(k) => set('keywords', k)} />}</Field>
        {Number.isFinite(lat) && Number.isFinite(lng) && v.centerLat && v.centerLng && (
          <OpsMap markers={[]} circles={[{ id: 'z', center: [lat, lng], radius: 1600, color: TIER_COLORS[v.tier] ?? '#0e9158', active: true }]} height={200} fitKey={`${lat},${lng}`} flyTo={[lat, lng]} />
        )}
      </fieldset>
      <ConfirmDialog open={del} onClose={() => setDel(false)} onConfirm={() => remove.mutate()} loading={remove.isPending} danger title={t('ops.network.deleteTitle', { name: zone?.code ?? '' })} description={t('ops.network.deleteDesc')} confirmLabel={t('action.delete')} />
    </Drawer>
  );
}
