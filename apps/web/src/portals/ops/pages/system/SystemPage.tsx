import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, Building2, Bike, CheckCircle2, Clock, Database, Map, Network, Package, Play, PlayCircle, Rocket, Server, Timer, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ago, dateTime, num } from '@/lib/format';
import { cn } from '@/lib/cn';
import { usePollInterval } from '@/lib/hooks';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, ErrorState, Skeleton, type Column } from '@/components/ui';
import { CopyButton, InfoRow, Notice, RequirePermission, Section } from '@/portals/ops/components/opsb';
import './i18n';

type DemoState = { state: 'idle' | 'running' | 'done' | 'error'; startedAt?: string; finishedAt?: string; error?: string };
type Setup = { network: { zones: number; hubs: number }; counts: { brands: number; heroes: number; orders: number }; demo: DemoState };
type Jobs = { registered: Array<{ name: string; everySeconds: number }>; state: Array<{ name: string; lockedUntil: string; lastRunAt: string | null; lastResult: string | null }> };
type Health = { status: string; database: string; version: string; uptimeSeconds: number; time: string };
type JobRow = { name: string; everySeconds: number; lockedUntil: string | null; lastRunAt: string | null; lastResult: string | null };
type TickResult = Array<{ name: string; ran: boolean; result?: string; error?: string; ms?: number }>;

export default function SystemPage() {
  return (
    <RequirePermission permission="settings.manage">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { t } = useI18n();
  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900 dark:text-white">{t('ops.system.title')}</h1>
        <p className="mt-1 text-sm text-ink-500">{t('ops.system.subtitle')}</p>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-5">
          <SetupCard />
          <JobsCard />
        </div>
        <div className="space-y-5">
          <HealthCard />
          <CronCard />
        </div>
      </div>
    </div>
  );
}

function every(sec: number, t: (k: string, v?: Record<string, string | number>) => string) {
  if (sec % 3600 === 0) return t('ops.opsb.hours', { n: num(sec / 3600) });
  if (sec % 60 === 0) return t('ops.opsb.minutes', { n: num(sec / 60) });
  return `${num(sec)}s`;
}

/* ───────────────────────────── Setup ───────────────────────────── */

function SetupCard() {
  const { t } = useI18n();
  const { me } = useAuth();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<'network' | 'demo' | null>(null);
  const [ack, setAck] = useState(false);
  const poll = usePollInterval(3_000);
  const q = useQuery({
    queryKey: ['system', 'setup'],
    queryFn: () => api<Setup>('/system/setup'),
    refetchInterval: (query) => (query.state.data?.demo.state === 'running' ? poll : false),
  });
  const network = useMutation({
    mutationFn: () => api<Setup>('/system/setup/network', { method: 'POST' }),
    onSuccess: (r) => { qc.setQueryData(['system', 'setup'], r); toast.success(t('ops.system.networkDone')); setConfirm(null); qc.invalidateQueries({ queryKey: ['opsb'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const demo = useMutation({
    mutationFn: () => api<DemoState>('/system/setup/demo', { method: 'POST' }),
    onSuccess: () => { toast.success(t('ops.system.demoStarted')); setConfirm(null); setAck(false); q.refetch(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const s = q.data;
  const superAdmin = me?.role === 'SUPER_ADMIN';
  const tiles = s ? [
    { icon: <Map />, label: t('ops.system.zones'), n: s.network.zones },
    { icon: <Building2 />, label: t('ops.system.hubs'), n: s.network.hubs },
    { icon: <Network />, label: t('ops.system.brands'), n: s.counts.brands },
    { icon: <Bike />, label: t('ops.system.heroes'), n: s.counts.heroes },
    { icon: <Package />, label: t('ops.system.orders'), n: s.counts.orders },
  ] : [];
  return (
    <Section title={<span className="inline-flex items-center gap-2"><Rocket className="h-4 w-4" />{t('ops.system.setup')}</span>} subtitle={t('ops.system.setupDesc')}>
      {q.isLoading ? <Skeleton className="h-48" /> : q.error || !s ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <div className="space-y-5">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {tiles.map((x) => (
              <li key={x.label} className="rounded-xl border border-ink-100 p-3 text-center dark:border-ink-800">
                <span className="mx-auto mb-1 grid h-8 w-8 place-items-center rounded-lg bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300 [&>svg]:h-4 [&>svg]:w-4">{x.icon}</span>
                <p className="font-display text-xl font-bold">{num(x.n)}</p>
                <p className="text-xs text-ink-500">{x.label}</p>
              </li>
            ))}
          </ul>
          {!superAdmin && <Notice tone="info">{t('ops.system.superOnly')}</Notice>}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col rounded-xl border border-ink-100 p-4 dark:border-ink-800">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="font-semibold">{t('ops.system.loadNetwork')}</p>
                {s.network.zones > 0 && <Badge tone="success" dot>{t('ops.system.networkLoaded')}</Badge>}
              </div>
              <p className="mb-4 flex-1 text-sm text-ink-500">{t('ops.system.networkDesc')}</p>
              <Button variant={s.network.zones > 0 ? 'outline' : 'primary'} icon={<Map className="h-4 w-4" />} disabled={!superAdmin} loading={network.isPending} onClick={() => setConfirm('network')}>{t('ops.system.loadNetwork')}</Button>
            </div>
            <div className="flex flex-col rounded-xl border border-ink-100 p-4 dark:border-ink-800">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="font-semibold">{t('ops.system.loadDemo')}</p>
                <DemoBadge d={s.demo} />
              </div>
              <p className="mb-3 flex-1 text-sm text-ink-500">{t('ops.system.demoDesc')}</p>
              {s.demo.state === 'running' && <Notice tone="info" icon={<Clock className="animate-spin" />} className="mb-3">{t('ops.system.demo.running', { ago: ago(s.demo.startedAt) })}</Notice>}
              {s.demo.state === 'done' && <Notice tone="success" className="mb-3">{t('ops.system.demo.done', { ago: ago(s.demo.finishedAt) })}</Notice>}
              {s.demo.state === 'error' && <Notice tone="danger" className="mb-3">{t('ops.system.demo.error', { error: s.demo.error ?? '' })}</Notice>}
              {s.counts.orders > 0 && s.demo.state !== 'running' ? (
                <p className="text-xs text-ink-500">{t('ops.system.demoBlocked')}</p>
              ) : (
                <Button variant="outline" icon={<PlayCircle className="h-4 w-4" />} disabled={!superAdmin || s.demo.state === 'running'} loading={demo.isPending || s.demo.state === 'running'} onClick={() => setConfirm('demo')}>{t('ops.system.loadDemo')}</Button>
              )}
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog open={confirm === 'network'} onClose={() => setConfirm(null)} onConfirm={() => network.mutate()} loading={network.isPending} title={t('ops.system.networkTitle')} description={t('ops.system.networkDesc')} confirmLabel={t('ops.system.loadNetwork')} />
      <ConfirmDialog
        open={confirm === 'demo'}
        onClose={() => { setConfirm(null); setAck(false); }}
        onConfirm={() => ack && demo.mutate()}
        loading={demo.isPending}
        danger
        title={t('ops.system.demoTitle')}
        confirmLabel={t('ops.system.loadDemo')}
      >
        <Notice tone="danger" icon={<AlertTriangle />}><p className="font-semibold">{t('ops.system.demoWarn')}</p></Notice>
        <Checkbox className="mt-4" label={t('ops.system.demoConfirm')} checked={ack} onChange={(e) => setAck(e.target.checked)} />
      </ConfirmDialog>
    </Section>
  );
}

function DemoBadge({ d }: { d: DemoState }) {
  const { t } = useI18n();
  const tone = d.state === 'done' ? 'success' : d.state === 'running' ? 'progress' : d.state === 'error' ? 'danger' : 'neutral';
  const label = { idle: t('ops.system.demo.idle'), running: t('state.IN_PROGRESS'), done: t('state.COMPLETED'), error: t('state.ERROR') }[d.state];
  return <Badge tone={tone} dot>{label}</Badge>;
}

/* ───────────────────────────── Jobs ───────────────────────────── */

function JobsCard() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const poll = usePollInterval(15_000);
  const q = useQuery({ queryKey: ['system', 'jobs'], queryFn: () => api<Jobs>('/system/jobs'), refetchInterval: poll });
  const run = useMutation({
    mutationFn: (name?: string) => api<TickResult>('/system/jobs/run', { method: 'POST', query: { name } }),
    onSuccess: (r, name) => {
      if (name) {
        const x = r.find((j) => j.name === name);
        if (x?.error) toast.error(t('ops.system.ran', { name, result: x.error }));
        else toast.success(t('ops.system.ran', { name, result: x?.result ?? '—' }));
      } else toast.success(t('ops.system.ranAll', { n: num(r.filter((j) => j.ran).length) }));
      qc.invalidateQueries({ queryKey: ['system', 'jobs'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rows: JobRow[] = (q.data?.registered ?? []).map((r) => {
    const st = q.data?.state.find((s) => s.name === r.name);
    return { ...r, lockedUntil: st?.lockedUntil ?? null, lastRunAt: st?.lastRunAt ?? null, lastResult: st?.lastResult ?? null };
  });
  const locked = (j: JobRow) => !!j.lockedUntil && new Date(j.lockedUntil).getTime() > Date.now();
  const overdue = (j: JobRow) => !j.lastRunAt || Date.now() - new Date(j.lastRunAt).getTime() > j.everySeconds * 3000 + 120_000;
  const runBtn = (j: JobRow) => <Button size="xs" variant="outline" icon={<Play className="h-3.5 w-3.5" />} loading={run.isPending && run.variables === j.name} disabled={locked(j)} onClick={() => run.mutate(j.name)}>{t('ops.system.runNow')}</Button>;
  const columns: Column<JobRow>[] = [
    { key: 'name', header: t('ops.system.job'), cell: (j) => <div className="min-w-[180px]"><p className="font-medium">{t(`ops.system.job.${j.name}`)}</p><p className="ltr text-start font-mono text-[11px] text-ink-400">{j.name}</p></div> },
    { key: 'every', header: t('ops.system.every'), cell: (j) => <span className="whitespace-nowrap text-sm">{every(j.everySeconds, t)}</span>, hideBelow: 'md' },
    { key: 'last', header: t('ops.system.lastRun'), cell: (j) => <span className={cn('whitespace-nowrap text-sm', overdue(j) && 'font-semibold text-amber-600')} title={j.lastRunAt ? dateTime(j.lastRunAt) : undefined}>{j.lastRunAt ? ago(j.lastRunAt) : t('ops.system.neverRan')}{overdue(j) && ` · ${t('ops.system.overdue')}`}</span> },
    { key: 'result', header: t('ops.system.result'), cell: (j) => <span className="ltr line-clamp-2 block max-w-xs text-start font-mono text-xs text-ink-600 dark:text-ink-300">{j.lastResult ?? '—'}</span>, hideBelow: 'lg' },
    { key: 'lock', header: t('common.status'), cell: (j) => (locked(j) ? <Badge tone="progress" dot>{t('ops.system.locked')}</Badge> : <Badge tone="neutral" dot>{t('ops.system.idle')}</Badge>) },
    { key: 'act', header: '', align: 'end', cell: runBtn },
  ];
  return (
    <Section title={<span className="inline-flex items-center gap-2"><Timer className="h-4 w-4" />{t('ops.system.jobs')}</span>} subtitle={t('ops.system.jobsDesc')} actions={<Button size="sm" icon={<PlayCircle className="h-4 w-4" />} loading={run.isPending && run.variables === undefined} onClick={() => run.mutate(undefined)}>{t('ops.system.runAll')}</Button>}>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(j) => j.name}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        dense
        mobileCard={(j) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2"><p className="font-medium">{t(`ops.system.job.${j.name}`)}</p>{columns[4].cell(j)}</div>
            <p className="text-xs text-ink-500">{every(j.everySeconds, t)} · {j.lastRunAt ? ago(j.lastRunAt) : t('ops.system.neverRan')}</p>
            {j.lastResult && <p className="ltr text-start font-mono text-[11px] text-ink-500">{j.lastResult}</p>}
            {runBtn(j)}
          </div>
        )}
      />
    </Section>
  );
}

/* ───────────────────────────── Health & cron ───────────────────────────── */

function HealthCard() {
  const { t } = useI18n();
  const poll = usePollInterval(30_000);
  const q = useQuery({ queryKey: ['system', 'health'], queryFn: () => api<Health>('/system/health', { auth: 'none' }), refetchInterval: poll });
  const h = q.data;
  const up = (s: number) => {
    const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? `${d}d ${hh}h` : hh ? `${hh}h ${m}m` : `${m}m`;
  };
  const dot = (ok: boolean) => ok ? <Badge tone="success" dot>{t('ops.system.ok')}</Badge> : <Badge tone="danger" dot>{t('ops.system.down')}</Badge>;
  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><Activity className="h-4 w-4" />{t('ops.system.health')}</h2>
      {q.isLoading ? <Skeleton className="h-32" /> : q.error || !h ? (
        <Notice tone="danger" icon={<XCircle />}>{t('ops.system.api')}: {t('ops.system.down')}</Notice>
      ) : (
        <>
          <div className={cn('mb-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold', h.status === 'ok' ? 'bg-turtle-50 text-turtle-800 dark:bg-turtle-950/40 dark:text-turtle-200' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200')}>
            {h.status === 'ok' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {h.status === 'ok' ? t('ops.system.ok') : t('ops.system.degraded')}
          </div>
          <InfoRow label={<span className="inline-flex items-center gap-1.5"><Server className="h-3.5 w-3.5" />{t('ops.system.api')}</span>} value={dot(true)} />
          <InfoRow label={<span className="inline-flex items-center gap-1.5"><Database className="h-3.5 w-3.5" />{t('ops.system.database')}</span>} value={dot(h.database === 'ok')} />
          <InfoRow label={t('ops.system.version')} value={<span className="ltr">{h.version}</span>} />
          <InfoRow label={t('ops.system.uptime')} value={<span className="ltr">{up(h.uptimeSeconds)}</span>} />
          <InfoRow label={t('ops.system.serverTime')} value={dateTime(h.time, { dateStyle: 'medium', timeStyle: 'medium' })} />
        </>
      )}
    </Card>
  );
}

function CronCard() {
  const { t } = useI18n();
  const cmd = `curl -fsS -X POST "${window.location.origin}/api/v1/system/cron?key=CRON_SECRET" > /dev/null`;
  return (
    <Card>
      <h2 className="mb-2 flex items-center gap-2 text-base font-semibold"><Clock className="h-4 w-4" />{t('ops.system.cron')}</h2>
      <p className="mb-3 text-sm text-ink-500">{t('ops.system.cronDesc')}</p>
      <div className="rounded-xl bg-ink-950 p-3">
        <code dir="ltr" className="block select-all break-all text-start font-mono text-xs leading-relaxed text-turtle-200">* * * * * {cmd}</code>
      </div>
      <div className="mt-2 flex justify-end"><CopyButton value={`* * * * * ${cmd}`} /></div>
      <p className="mt-3 text-xs text-ink-500">{t('ops.system.cronSecret')}</p>
    </Card>
  );
}
