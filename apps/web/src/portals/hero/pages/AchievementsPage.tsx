import { useState } from 'react';
import { Award, Banknote, Bike, Flame, Lock, Medal, Star, Sunrise, Target, Trophy, Zap } from 'lucide-react';
import { HERO_LEVELS, levelForXp } from '@goturtle/shared';
import { cn } from '@/lib/cn';
import { num } from '@/lib/format';
import { useI18n } from '@/i18n';
import { Avatar, ErrorState, Skeleton, Tabs } from '@/components/ui';
import { PageTop, Panel, SectionTitle } from '../components/kit';
import { useAchievements, useLeaderboard } from '../lib/queries';

const BADGE_ICON: Record<string, React.ReactNode> = {
  first_delivery: <Bike />,
  century: <Medal />,
  thousand: <Trophy />,
  perfect_week: <Target />,
  five_star: <Star />,
  cash_angel: <Banknote />,
  early_bird: <Sunrise />,
};

export default function AchievementsPage() {
  const { t, pick } = useI18n();
  const ach = useAchievements();
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('week');
  const board = useLeaderboard(period);

  if (!ach.data && ach.isError) return <ErrorState error={ach.error} onRetry={() => ach.refetch()} />;
  if (!ach.data) return <Skeleton className="h-96 rounded-2xl" />;
  const a = ach.data;
  // Shared rule is the source of truth for the level ladder.
  const lvl = levelForXp(a.xp);
  const xpToNext = lvl.next ? lvl.next.minXp - a.xp : 0;

  return (
    <div>
      <PageTop to="/hero/me" title={t('hero.ach.title')} />

      <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 via-violet-700 to-ink-900 p-5 text-white shadow-pop">
        <div className="flex items-center gap-4">
          <span className="grid h-20 w-20 shrink-0 place-items-center rounded-3xl bg-white/15 text-5xl">{lvl.emoji}</span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-wide text-white/70">{t('hero.me.level')} <span className="ltr">{lvl.level}</span></p>
            <p className="truncate font-display text-2xl font-extrabold">{pick(lvl)}</p>
            <p className="text-sm text-white/80"><span className="ltr tabular">{num(a.xp)}</span> XP</p>
          </div>
        </div>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/20">
          <div className="h-full rounded-full bg-gradient-to-r from-sand-300 to-sand-400 transition-all" style={{ width: `${lvl.progress * 100}%` }} />
        </div>
        <p className="mt-2 text-xs font-semibold text-white/85">
          {lvl.next ? t('hero.ach.toNext', { xp: num(xpToNext), name: pick(lvl.next), emoji: lvl.next.emoji }) : t('hero.ach.maxLevel')}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Tile icon={<Flame className="text-orange-500" />} label={t('hero.ach.streak')} value={t('hero.ach.streakN', { n: a.streakDays })} />
        <Tile icon={<Star className="fill-sand-400 text-sand-400" />} label={t('hero.ach.rating')} value={<span className="ltr">{a.rating.toFixed(1)}</span>} />
        <Tile icon={<Award className="text-turtle-600" />} label={t('hero.ach.badges')} value={<span className="ltr">{a.badgesEarned}/{a.badges.length}</span>} />
      </div>

      <SectionTitle>{t('hero.ach.ladder')}</SectionTitle>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none">
        {HERO_LEVELS.map((l) => {
          const reached = a.xp >= l.minXp;
          const current = l.level === lvl.level;
          return (
            <div key={l.level} className={cn('w-24 shrink-0 rounded-2xl p-3 text-center ring-2', current ? 'bg-violet-50 ring-violet-500 dark:bg-violet-950' : reached ? 'bg-white ring-turtle-200 dark:bg-ink-900 dark:ring-turtle-900' : 'bg-white ring-ink-100 dark:bg-ink-900 dark:ring-ink-800')}>
              <p className={cn('text-3xl', !reached && 'opacity-30 grayscale')}>{l.emoji}</p>
              <p className="mt-1 truncate text-xs font-bold text-ink-900 dark:text-white">{pick(l)}</p>
              <p className="ltr text-[11px] text-ink-500">{num(l.minXp)} XP</p>
            </div>
          );
        })}
      </div>

      <SectionTitle count={a.badgesEarned}>{t('hero.ach.badges')}</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        {a.badges.map((b) => (
          <div key={b.key} className={cn('rounded-2xl p-3 ring-1', b.earned ? 'bg-gradient-to-br from-sand-50 to-white ring-sand-200 dark:from-ink-800 dark:to-ink-900 dark:ring-sand-800' : 'bg-white ring-ink-100 dark:bg-ink-900 dark:ring-ink-800')}>
            <div className="flex items-center gap-2">
              <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl [&>svg]:h-6 [&>svg]:w-6', b.earned ? 'bg-sand-400 text-ink-950' : 'bg-ink-100 text-ink-400 dark:bg-ink-800')}>
                {b.earned ? BADGE_ICON[b.key] ?? <Award /> : <Lock />}
              </span>
              <p className={cn('min-w-0 text-sm font-bold leading-tight', b.earned ? 'text-ink-900 dark:text-white' : 'text-ink-500')}>{pick(b)}</p>
            </div>
            {!b.earned && (
              <>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                  <div className="h-full rounded-full bg-turtle-500" style={{ width: `${Math.min(100, (b.current / Math.max(1, b.target)) * 100)}%` }} />
                </div>
                <p className="ltr mt-1 text-end text-[11px] text-ink-500">{num(b.current)} / {num(b.target)}</p>
              </>
            )}
            {b.earned && <p className="mt-2 text-[11px] font-bold text-sand-700 dark:text-sand-300">✓ {t('hero.ach.earned')}</p>}
          </div>
        ))}
      </div>

      <SectionTitle>{t('hero.ach.leaderboard')}</SectionTitle>
      <Tabs
        value={period}
        onChange={setPeriod}
        className="mb-3"
        tabs={[
          { value: 'day', label: t('common.today') },
          { value: 'week', label: t('hero.earnings.week') },
          { value: 'month', label: t('hero.earnings.month') },
        ]}
      />
      {!board.data ? (
        board.isError ? <ErrorState error={board.error} onRetry={() => board.refetch()} /> : <Skeleton className="h-48 rounded-2xl" />
      ) : (
        <>
          {board.data.me && (
            <div className="mb-2 flex items-center gap-3 rounded-2xl bg-turtle-600 p-3 text-white">
              <span className="font-display text-2xl font-extrabold"><span className="ltr">#{board.data.me.rank}</span></span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-white/80">{t('hero.ach.yourRank')}</p>
                <p className="text-sm font-bold">{t('hero.ach.rankLine', { d: board.data.me.deliveries, xp: board.data.me.periodXp })}</p>
              </div>
              <Zap className="h-6 w-6 text-sand-300" />
            </div>
          )}
          {board.data.data.length === 0 ? (
            <p className="rounded-2xl bg-white p-6 text-center text-sm text-ink-500 dark:bg-ink-900">{t('hero.ach.noBoard')}</p>
          ) : (
            <ol className="divide-y divide-ink-100 overflow-hidden rounded-2xl border border-ink-100 bg-white dark:divide-ink-800 dark:border-ink-800 dark:bg-ink-900">
              {board.data.data.map((r) => {
                const isMe = r.courierId === board.data.me?.courierId;
                return (
                  <li key={r.courierId} className={cn('flex items-center gap-3 px-3 py-2.5', isMe && 'bg-turtle-50 dark:bg-turtle-950')}>
                    <span className={cn('w-7 text-center font-display text-base font-extrabold', r.rank <= 3 ? 'text-sand-600' : 'text-ink-400')}>
                      {r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : <span className="ltr">{r.rank}</span>}
                    </span>
                    <Avatar name={r.name} src={r.avatarUrl} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-ink-900 dark:text-white">{r.name}{isMe && <span className="ms-1 text-xs text-turtle-700 dark:text-turtle-400">({t('hero.map.you')})</span>}</p>
                      <p className="text-xs text-ink-500">{t('hero.ach.rowLine', { d: r.deliveries, s: num(r.successRate) })}</p>
                    </div>
                    <span className="ltr shrink-0 text-sm font-extrabold text-violet-700 dark:text-violet-300">{num(r.periodXp)} XP</span>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}

      <SectionTitle>{t('hero.ach.howTo')}</SectionTitle>
      <Panel>
        <ul className="space-y-2 text-sm">
          {Object.entries(a.rules).map(([k, xp]) => (
            <li key={k} className="flex items-center justify-between gap-2">
              <span className="text-ink-700 dark:text-ink-200">{t(`hero.xp.${k}`)}</span>
              <span className="ltr font-bold text-violet-700 dark:text-violet-300">+{xp} XP</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function Tile({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-3 shadow-card dark:bg-ink-900">
      <span className="mx-auto grid h-8 w-8 place-items-center [&>svg]:h-6 [&>svg]:w-6">{icon}</span>
      <p className="mt-1 text-[11px] font-semibold text-ink-500">{label}</p>
      <p className="text-sm font-extrabold text-ink-900 dark:text-white">{value}</p>
    </div>
  );
}
