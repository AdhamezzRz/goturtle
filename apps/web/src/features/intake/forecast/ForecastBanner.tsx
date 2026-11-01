import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, ArrowRight, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { cairoToday, num } from '@/lib/format';
import { useI18n } from '@/i18n';
import type { DemandForecast } from '../types';
import '../i18n';

const plus = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/** Shifts page: "next 7 days are short of N heroes" with a link to the forecast. */
export function ForecastBanner({ hubId }: { hubId?: string }) {
  const { t, dir } = useI18n();
  const today = cairoToday();
  const q = useQuery({
    queryKey: ['forecast', 'banner', hubId ?? ''],
    queryFn: () => api<DemandForecast>('/forecast/demand', { query: { from: today, to: plus(today, 6), hubId } }),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const s = q.data?.staffing?.summary;
  if (!s || !q.data) return null;
  const short = s.understaffedDays > 0;
  const Arrow = dir === 'rtl' ? ArrowLeft : ArrowRight;
  const missing = (q.data.staffing?.rows ?? []).reduce((sum, r) => sum + Math.max(0, -r.gap), 0);
  return (
    <Link
      to={`/ops/forecast${short ? '?gaps=1' : ''}`}
      className={cn(
        'mb-5 flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition',
        short ? 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100' : 'border-ink-100 bg-white text-ink-700 hover:bg-ink-50 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-200',
      )}
    >
      {short ? <AlertTriangle className="h-5 w-5 shrink-0" /> : <TrendingUp className="h-5 w-5 shrink-0 text-turtle-600" />}
      <span className="min-w-0 flex-1">
        {short ? t('intake.fc.banner.short', { days: num(s.understaffedDays), heroes: num(missing) }) : t('intake.fc.banner.ok', { orders: num(Math.round(q.data.days.reduce((a, d) => a + d.forecast, 0))) })}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 font-semibold">{t('intake.fc.banner.cta')}<Arrow className="h-4 w-4" /></span>
    </Link>
  );
}
