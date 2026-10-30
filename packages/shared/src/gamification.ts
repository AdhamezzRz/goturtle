/** Hero levels — XP is earned per successful delivery, on-time bonus, 5-star ratings and streaks. */
export const HERO_LEVELS = [
  { level: 1, minXp: 0, en: 'Hatchling', ar: 'سلحفاة صغيرة', emoji: '🥚' },
  { level: 2, minXp: 250, en: 'Runner', ar: 'عدّاء', emoji: '🐢' },
  { level: 3, minXp: 1000, en: 'Pro Hero', ar: 'بطل محترف', emoji: '⚡' },
  { level: 4, minXp: 3000, en: 'Road Master', ar: 'سيد الطريق', emoji: '🏍️' },
  { level: 5, minXp: 7500, en: 'Legend', ar: 'أسطورة', emoji: '👑' },
  { level: 6, minXp: 15000, en: 'Ninja Turtle', ar: 'السلحفاة النينجا', emoji: '🥷' },
] as const;

export const XP_RULES = {
  delivered: 10,
  deliveredOnTime: 5,
  pickupCompleted: 4,
  fiveStarRating: 8,
  dailyStreak: 15,
  failedAttempt: 1, // still rewards the effort of trying
  cashHandoverSameDay: 10,
} as const;

export function levelForXp(xp: number) {
  let current: (typeof HERO_LEVELS)[number] = HERO_LEVELS[0];
  for (const l of HERO_LEVELS) if (xp >= l.minXp) current = l;
  const idx = HERO_LEVELS.findIndex((l) => l.level === current.level);
  const next = HERO_LEVELS[idx + 1] ?? null;
  const progress = next ? (xp - current.minXp) / (next.minXp - current.minXp) : 1;
  return { ...current, next, progress: Math.max(0, Math.min(1, progress)) };
}

export const HERO_BADGES = [
  { key: 'first_delivery', en: 'First delivery', ar: 'أول توصيلة' },
  { key: 'century', en: '100 deliveries', ar: '١٠٠ توصيلة' },
  { key: 'thousand', en: '1,000 deliveries', ar: '١٠٠٠ توصيلة' },
  { key: 'perfect_week', en: 'Perfect week (100% success)', ar: 'أسبوع مثالي' },
  { key: 'five_star', en: '50 five-star ratings', ar: '٥٠ تقييم ٥ نجوم' },
  { key: 'cash_angel', en: 'Always hands cash same day', ar: 'ملاك الكاش' },
  { key: 'early_bird', en: 'Clocked in early 20 times', ar: 'الطائر المبكر' },
] as const;
