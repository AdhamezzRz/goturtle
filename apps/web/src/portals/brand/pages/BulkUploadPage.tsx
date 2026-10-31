import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import Papa from 'papaparse';
import {
  AlertCircle, CheckCircle2, Download, FileSpreadsheet, FileUp, Pencil, Printer, RefreshCw, Rocket, Trash2, UploadCloud, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, download } from '@/lib/api';
import { cn } from '@/lib/cn';
import { num } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, Card, DataTable, EmptyState, Field, Input, Modal, PageHeader, Select, Switch, type Column } from '@/components/ui';
import { Money, Segmented, Stat, useCanCreate, useLocations } from '../components/common';
import './i18n';

type RawRow = Record<string, string>;

interface ValidatedRow {
  row: number;
  ok: boolean;
  errors: Array<{ field: string; code: string; message: string }>;
  preview: { reference: string | null; recipientName: string | null; phone: string | null; address: string | null; paymentMethod: string; serviceLevel: string; type: string; codAmountCents: number };
  zone?: { id: string; code: string; nameEn: string; nameAr: string; method: string; confidence: number };
  fees?: { totalFeesCents: number; collectCents: number; netToBrandCents: number };
}
interface ValidateResult {
  total: number;
  valid: number;
  invalid: number;
  summary: { codCents: number; collectCents: number; feesCents: number };
  rows: ValidatedRow[];
}
interface CreateResult {
  total: number;
  created: number;
  failed: number;
  rows: Array<{ row: number; ok: boolean; orderId?: string; trackingNumber?: string; collectCents?: number; totalFeesCents?: number; errors: Array<{ field: string; message: string }> }>;
}

const MAX_ROWS = 500;

export default function BulkUploadPage() {
  const { t, locale } = useI18n();
  const create = useCanCreate();
  const locations = useLocations();
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<RawRow[]>([]);
  const [result, setResult] = useState<ValidateResult | null>(null);
  const [created, setCreated] = useState<{ res: CreateResult; map: number[] } | null>(null);
  const [drag, setDrag] = useState(false);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [locationId, setLocationId] = useState('');
  const [tplLang, setTplLang] = useState<'ar' | 'en'>(locale);

  const validate = useMutation({
    mutationFn: (input: RawRow[]) => api<ValidateResult>('/orders/bulk/validate', { method: 'POST', body: { rows: input, pickupLocationId: locationId || undefined } }),
    onSuccess: (r) => {
      setResult(r);
      if (r.invalid) setOnlyErrors(true);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = useMutation({
    mutationFn: async () => {
      const okIdx = (result?.rows ?? []).filter((r) => r.ok).map((r) => r.row - 1);
      const res = await api<CreateResult>('/orders/bulk', { method: 'POST', body: { rows: okIdx.map((i) => rows[i]), pickupLocationId: locationId || undefined } });
      return { res, map: okIdx };
    },
    onSuccess: (out) => {
      setCreated(out);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (out.res.created) toast.success(t('brand.bulk.createdToast', { n: num(out.res.created) }));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      if (!/\.(csv|txt)$/i.test(file.name) && file.type !== 'text/csv') {
        toast.error(t('brand.bulk.notCsv'));
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error(t('brand.bulk.tooBig'));
        return;
      }
      Papa.parse<RawRow>(file, {
        header: true,
        skipEmptyLines: 'greedy',
        transformHeader: (h) => h.replace(/^﻿/, '').trim(),
        complete: (out) => {
          const data = out.data.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? '').trim()]))).filter((r) => Object.values(r).some(Boolean));
          if (!data.length) return toast.error(t('brand.bulk.empty'));
          if (data.length > MAX_ROWS) return toast.error(t('brand.bulk.tooMany', { max: num(MAX_ROWS) }));
          setFileName(file.name);
          setHeaders(out.meta.fields ?? Object.keys(data[0]));
          setRows(data);
          setCreated(null);
          setResult(null);
          setOnlyErrors(false);
          validate.mutate(data);
        },
        error: () => toast.error(t('brand.bulk.parseError')),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locationId],
  );

  const reset = () => {
    setRows([]);
    setHeaders([]);
    setResult(null);
    setCreated(null);
    setFileName('');
    if (fileInput.current) fileInput.current.value = '';
  };

  const shown = useMemo(() => (result?.rows ?? []).filter((r) => !onlyErrors || !r.ok), [result, onlyErrors]);

  if (!create.allowed) {
    return (
      <div>
        <PageHeader title={t('brand.nav.bulk')} />
        <Card><EmptyState icon={<UploadCloud className="h-7 w-7" />} title={t('brand.new.locked')} description={create.reason} /></Card>
      </div>
    );
  }

  if (created) return <Results created={created} rows={rows} onAgain={reset} />;

  const columns: Column<ValidatedRow>[] = [
    { key: 'row', header: '#', cell: (r) => <span className="tabular text-ink-400">{num(r.row)}</span>, className: 'w-12' },
    {
      key: 'ok',
      header: t('common.status'),
      cell: (r) => (r.ok ? <Badge tone="success"><CheckCircle2 className="h-3 w-3" />{t('brand.bulk.valid')}</Badge> : <Badge tone="danger"><XCircle className="h-3 w-3" />{t('brand.bulk.errorsN', { n: num(r.errors.length) })}</Badge>),
    },
    {
      key: 'recipient',
      header: t('brand.orders.col.recipient'),
      cell: (r) => (
        <div className="max-w-[220px]">
          <p className="truncate font-medium text-ink-800 dark:text-ink-100">{r.preview.recipientName || '—'}</p>
          <p className="ltr text-xs text-ink-500">{r.preview.phone ?? '—'}</p>
        </div>
      ),
    },
    {
      key: 'address',
      header: t('common.address'),
      hideBelow: 'lg',
      cell: (r) => (
        <div className="max-w-[260px]">
          <p className="truncate">{r.preview.address || '—'}</p>
          {r.zone ? (
            <p className="text-xs text-turtle-700 dark:text-turtle-400">{locale === 'ar' ? r.zone.nameAr : r.zone.nameEn} · {Math.round(r.zone.confidence * 100)}%</p>
          ) : (
            <p className="text-xs text-red-600">{t('brand.bulk.noZone')}</p>
          )}
        </div>
      ),
    },
    { key: 'cod', header: t('brand.orders.col.collect'), align: 'end', cell: (r) => (r.fees ? <Money cents={r.fees.collectCents} className="font-semibold" /> : <Money cents={r.preview.codAmountCents} className="text-ink-400" />) },
    { key: 'fees', header: t('common.fees'), align: 'end', hideBelow: 'md', cell: (r) => (r.fees ? <Money cents={r.fees.totalFeesCents} /> : '—') },
    {
      key: 'errors',
      header: t('brand.bulk.issues'),
      cell: (r) =>
        r.ok ? (
          <span className="text-xs text-ink-400">—</span>
        ) : (
          <ul className="max-w-[320px] space-y-0.5 text-xs text-red-700 dark:text-red-300">
            {r.errors.map((e, i) => <li key={i}><span className="font-mono">{e.field}</span>: {e.message}</li>)}
          </ul>
        ),
    },
    {
      key: 'edit',
      header: '',
      align: 'end',
      cell: (r) => <Button size="xs" variant={r.ok ? 'ghost' : 'outline'} icon={<Pencil className="h-3 w-3" />} onClick={(e) => { e.stopPropagation(); setEditing(r.row - 1); }}>{t('brand.bulk.fix')}</Button>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('brand.nav.bulk')}
        subtitle={t('brand.bulk.subtitle', { max: num(MAX_ROWS) })}
        actions={rows.length > 0 && <Button variant="outline" icon={<Trash2 className="h-4 w-4" />} onClick={reset}>{t('brand.bulk.startOver')}</Button>}
      />

      {/* Steps: template + location + drop */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-turtle-600 text-sm font-bold text-white">1</span>
            <h2 className="font-semibold text-ink-900 dark:text-white">{t('brand.bulk.step1')}</h2>
          </div>
          <p className="text-sm text-ink-500">{t('brand.bulk.step1Hint')}</p>
          <Segmented label={t('brand.bulk.tplLang')} value={tplLang} onChange={setTplLang} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} />
          <Button
            block
            variant="outline"
            icon={<Download className="h-4 w-4" />}
            onClick={() => download('/orders/bulk/template', `goturtle-bulk-template-${tplLang}.csv`, { lang: tplLang }).catch((e) => toast.error(errorMessage(e)))}
          >
            {t('brand.bulk.download')}
          </Button>
          <Field label={t('brand.pickups.location')} hint={t('brand.bulk.locationHint')}>
            {(id) => (
              <Select id={id} value={locationId} onChange={(e) => setLocationId(e.target.value)} placeholder={t('brand.bulk.defaultLocation')} options={(locations.data ?? []).filter((l) => l.isActive).map((l) => ({ value: l.id, label: l.name }))} />
            )}
          </Field>
        </Card>

        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-turtle-600 text-sm font-bold text-white">2</span>
            <h2 className="font-semibold text-ink-900 dark:text-white">{t('brand.bulk.step2')}</h2>
          </div>
          <label
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0]); }}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition focus-within:ring-2 focus-within:ring-turtle-500',
              drag ? 'border-turtle-500 bg-turtle-50 dark:bg-turtle-950/40' : 'border-ink-200 hover:border-turtle-400 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800/40',
            )}
          >
            <input ref={fileInput} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-turtle-50 text-turtle-700 dark:bg-turtle-950 dark:text-turtle-300">
              {validate.isPending ? <RefreshCw className="h-7 w-7 animate-spin" /> : fileName ? <FileSpreadsheet className="h-7 w-7" /> : <UploadCloud className="h-7 w-7" />}
            </span>
            {fileName ? (
              <>
                <p className="mt-3 font-semibold text-ink-900 dark:text-white">{fileName}</p>
                <p className="text-sm text-ink-500">{t('brand.bulk.rowsRead', { n: num(rows.length) })} · {t('brand.bulk.replace')}</p>
              </>
            ) : (
              <>
                <p className="mt-3 font-semibold text-ink-900 dark:text-white">{t('brand.bulk.drop')}</p>
                <p className="text-sm text-ink-500">{t('brand.bulk.dropHint', { max: num(MAX_ROWS) })}</p>
                <span className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-turtle-600 px-4 text-sm font-semibold text-white"><FileUp className="h-4 w-4" />{t('brand.bulk.browse')}</span>
              </>
            )}
          </label>
        </Card>
      </div>

      {/* Step 3: preview */}
      {(result || validate.isPending) && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-turtle-600 text-sm font-bold text-white">3</span>
            <h2 className="font-semibold text-ink-900 dark:text-white">{t('brand.bulk.step3')}</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat loading={validate.isPending} icon={<CheckCircle2 />} label={t('brand.bulk.validRows')} value={num(result?.valid)} hint={t('brand.bulk.ofN', { n: num(result?.total) })} />
            <Stat loading={validate.isPending} icon={<AlertCircle />} tone="red" label={t('brand.bulk.invalidRows')} value={num(result?.invalid)} hint={result?.invalid ? t('brand.bulk.fixHint') : t('brand.bulk.allGood')} />
            <Stat loading={validate.isPending} tone="sand" label={t('brand.bulk.totalCollect')} value={<Money cents={result?.summary.collectCents} />} />
            <Stat loading={validate.isPending} tone="ink" label={t('brand.bulk.totalFees')} value={<Money cents={result?.summary.feesCents} />} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Switch checked={onlyErrors} onChange={setOnlyErrors} label={t('brand.bulk.onlyErrors')} disabled={!result?.invalid} />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" icon={<RefreshCw className="h-4 w-4" />} loading={validate.isPending} onClick={() => validate.mutate(rows)}>{t('brand.bulk.revalidate')}</Button>
              <Button icon={<Rocket className="h-4 w-4" />} loading={submit.isPending} disabled={!result?.valid || validate.isPending} onClick={() => submit.mutate()}>
                {result?.invalid ? t('brand.bulk.createValid', { n: num(result?.valid) }) : t('brand.bulk.createAll', { n: num(result?.valid ?? 0) })}
              </Button>
            </div>
          </div>
          <DataTable
            columns={columns}
            rows={validate.isPending ? undefined : shown}
            loading={validate.isPending}
            rowKey={(r) => String(r.row)}
            onRowClick={(r) => setEditing(r.row - 1)}
            dense
            empty={<EmptyState icon={<CheckCircle2 className="h-7 w-7 text-turtle-500" />} title={t('brand.bulk.noErrors')} />}
            mobileCard={(r) => (
              <div className={cn('space-y-1', !r.ok && 'border-s-4 border-red-500 ps-3')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-ink-900 dark:text-white">#{num(r.row)} · {r.preview.recipientName || '—'}</span>
                  {r.ok ? <Badge tone="success">{t('brand.bulk.valid')}</Badge> : <Badge tone="danger">{t('brand.bulk.errorsN', { n: num(r.errors.length) })}</Badge>}
                </div>
                <p className="truncate text-xs text-ink-500">{r.preview.address}</p>
                {r.ok ? (
                  <p className="flex items-center justify-between text-xs text-ink-500">
                    <span>{r.zone ? (locale === 'ar' ? r.zone.nameAr : r.zone.nameEn) : ''}</span>
                    <span>{t('brand.orders.col.collect')}: <Money cents={r.fees?.collectCents} className="font-semibold text-ink-900 dark:text-white" /> · {t('common.fees')}: <Money cents={r.fees?.totalFeesCents} /></span>
                  </p>
                ) : (
                  <ul className="text-xs text-red-700 dark:text-red-300">{r.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
                )}
              </div>
            )}
          />
        </div>
      )}

      <RowEditor
        open={editing !== null}
        headers={headers}
        row={editing !== null ? rows[editing] : undefined}
        rowNo={editing !== null ? editing + 1 : 0}
        errors={editing !== null ? result?.rows.find((r) => r.row === editing + 1)?.errors ?? [] : []}
        onClose={() => setEditing(null)}
        onSave={(next) => {
          if (editing === null) return;
          const all = rows.map((r, i) => (i === editing ? next : r));
          setRows(all);
          setEditing(null);
          validate.mutate(all);
        }}
        onDelete={() => {
          if (editing === null) return;
          const all = rows.filter((_, i) => i !== editing);
          setRows(all);
          setEditing(null);
          if (all.length) validate.mutate(all);
          else reset();
        }}
      />
      {rows.length === 0 && !validate.isPending && (
        <p className="text-center text-sm text-ink-500">
          {t('brand.bulk.singleHint')} <Link to="/brand/orders/new" className="font-medium text-turtle-700 hover:underline dark:text-turtle-400">{t('brand.nav.newOrder')}</Link>
        </p>
      )}
    </div>
  );
}

function RowEditor({
  open, headers, row, rowNo, errors, onClose, onSave, onDelete,
}: {
  open: boolean; headers: string[]; row?: RawRow; rowNo: number; errors: Array<{ field: string; message: string }>; onClose: () => void; onSave: (r: RawRow) => void; onDelete: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<RawRow>({});
  const [lastRow, setLastRow] = useState<RawRow | undefined>(undefined);
  if (row !== lastRow) {
    setLastRow(row);
    setDraft(row ?? {});
  }
  const errFor = (h: string) => errors.filter((e) => e.field === h).map((e) => e.message).join(' · ');
  const fields = headers.length ? headers : Object.keys(row ?? {});
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t('brand.bulk.editRow', { n: num(rowNo) })}
      description={errors.length ? t('brand.bulk.editRowHint') : undefined}
      footer={
        <>
          <Button variant="ghost" className="me-auto text-red-600" icon={<Trash2 className="h-4 w-4" />} onClick={onDelete}>{t('brand.bulk.removeRow')}</Button>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => onSave(draft)} icon={<RefreshCw className="h-4 w-4" />}>{t('brand.bulk.saveRevalidate')}</Button>
        </>
      }
    >
      {errors.some((e) => !fields.includes(e.field)) && (
        <ul className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300">
          {errors.filter((e) => !fields.includes(e.field)).map((e, i) => <li key={i}>{e.message}</li>)}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((h) => (
          <Field key={h} label={<span className="font-mono text-xs">{h}</span>} error={errFor(h) || undefined}>
            {(id) => <Input id={id} value={draft[h] ?? ''} onChange={(e) => setDraft({ ...draft, [h]: e.target.value })} invalid={!!errFor(h)} />}
          </Field>
        ))}
      </div>
    </Modal>
  );
}

function Results({ created, rows, onAgain }: { created: { res: CreateResult; map: number[] }; rows: RawRow[]; onAgain: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const ok = created.res.rows.filter((r) => r.ok && r.orderId);
  const failed = created.res.rows.filter((r) => !r.ok);
  const ids = ok.map((r) => r.orderId!).slice(0, 300);
  const totalFees = ok.reduce((s, r) => s + (r.totalFeesCents ?? 0), 0);
  const totalCollect = ok.reduce((s, r) => s + (r.collectCents ?? 0), 0);
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden" padded={false}>
        <div className="flex flex-col items-start gap-4 bg-gradient-to-br from-turtle-600 to-turtle-800 p-6 text-white sm:flex-row sm:items-center">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-white/15"><CheckCircle2 className="h-8 w-8" /></span>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-bold">{t('brand.bulk.doneTitle', { n: num(created.res.created) })}</h1>
            <p className="text-sm text-turtle-50/90">{failed.length ? t('brand.bulk.doneSomeFailed', { n: num(failed.length) }) : t('brand.bulk.doneHint')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="inline-flex h-10 items-center gap-2 rounded-lg bg-white px-4 text-sm font-semibold text-turtle-800 hover:bg-turtle-50 disabled:opacity-50" disabled={!ids.length} onClick={() => navigate(`/brand/orders/labels?ids=${ids.join(',')}`)}>
              <Printer className="h-4 w-4" />
              {t('brand.bulk.printN', { n: num(ids.length) })}
            </button>
            <button type="button" className="inline-flex h-10 items-center rounded-lg px-4 text-sm font-semibold text-white ring-1 ring-inset ring-white/30 hover:bg-white/10" onClick={onAgain}>{t('brand.bulk.uploadAnother')}</button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3">
          <div><p className="text-xs text-ink-500">{t('brand.bulk.createdOrders')}</p><p className="font-display text-xl font-bold">{num(created.res.created)}</p></div>
          <div><p className="text-xs text-ink-500">{t('brand.bulk.totalCollect')}</p><Money cents={totalCollect} className="font-display text-xl font-bold" /></div>
          <div><p className="text-xs text-ink-500">{t('brand.bulk.totalFees')}</p><Money cents={totalFees} className="font-display text-xl font-bold" /></div>
        </div>
      </Card>
      {failed.length > 0 && (
        <Card>
          <h2 className="mb-3 font-semibold text-red-700 dark:text-red-300">{t('brand.bulk.failedRows')}</h2>
          <ul className="space-y-2 text-sm">
            {failed.map((r) => {
              const src = rows[created.map[r.row - 1]] ?? {};
              return (
                <li key={r.row} className="rounded-xl bg-red-50 px-3 py-2 dark:bg-red-950/50">
                  <span className="font-semibold">#{num(created.map[r.row - 1] + 1)}</span> {Object.values(src).slice(1, 3).join(' · ')} — {r.errors.map((e) => e.message).join(' · ')}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <DataTable
        columns={[
          { key: 'tn', header: t('brand.orders.col.tracking'), cell: (r) => <Link to={`/brand/orders/${r.orderId}`} className="ltr font-mono font-semibold text-turtle-700 hover:underline dark:text-turtle-400">{r.trackingNumber}</Link> },
          { key: 'src', header: t('brand.orders.col.recipient'), cell: (r) => Object.values(rows[created.map[r.row - 1]] ?? {}).slice(1, 2).join('') },
          { key: 'collect', header: t('brand.orders.col.collect'), align: 'end', cell: (r) => <Money cents={r.collectCents} /> },
          { key: 'fees', header: t('common.fees'), align: 'end', cell: (r) => <Money cents={r.totalFeesCents} /> },
        ]}
        rows={ok}
        rowKey={(r) => String(r.row)}
        mobileCard={(r) => (
          <div className="flex items-center justify-between gap-2">
            <span className="ltr font-mono text-sm font-semibold">{r.trackingNumber}</span>
            <Money cents={r.collectCents} className="text-sm font-semibold" />
          </div>
        )}
        onRowClick={(r) => navigate(`/brand/orders/${r.orderId}`)}
      />
    </div>
  );
}
