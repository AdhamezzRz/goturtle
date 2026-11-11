import { Check, Copy, Download } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { registerDictionary, useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { Section } from '@/portals/ops/components/opsb';
import { ArchTile, BRAND_COLORS, Wordmark } from '@/components/brand';

registerDictionary({
  'brandkit.title': { en: 'Brand kit', ar: 'هوية جو تيرتل' },
  'brandkit.subtitle': { en: 'Official logo files and colours — use these everywhere (stickers, vests, social, partner decks).', ar: 'ملفات اللوجو والألوان الرسمية — استخدمها في كل حاجة (استيكرات، فيستات، سوشيال، عروض الشركاء).' },
  'brandkit.logos': { en: 'Logo', ar: 'اللوجو' },
  'brandkit.icon': { en: 'App icon', ar: 'أيقونة التطبيق' },
  'brandkit.palette': { en: 'Colour palette', ar: 'الألوان' },
  'brandkit.rules': { en: 'Usage', ar: 'قواعد الاستخدام' },
  'brandkit.rule1': { en: 'Never redraw, stretch or re-type the wordmark; the arch is part of the letters.', ar: 'متعيدش رسم اللوجو ولا تمطّه ولا تكتبه بخط تاني؛ القوس جزء من الحروف.' },
  'brandkit.rule2': { en: 'Keep clear space around the logo at least the height of the arch.', ar: 'سيب مساحة فاضية حوالين اللوجو على الأقل قد ارتفاع القوس.' },
  'brandkit.rule3': { en: 'Lime is a highlight on green or ink — never text on white.', ar: 'الليموني للتمييز على الأخضر أو الكحلي — مش نص على أبيض.' },
  'brandkit.rule4': { en: 'Smallest size: 24 px tall on screen, 8 mm in print.', ar: 'أصغر مقاس: ٢٤ بكسل على الشاشة و٨ مم في الطباعة.' },
  'brandkit.copied': { en: 'Copied {hex}', ar: 'اتنسخ {hex}' },
  'brandkit.c.green': { en: 'Turtle green', ar: 'أخضر تيرتل' },
  'brandkit.c.leaf': { en: 'Leaf', ar: 'أخضر فاتح' },
  'brandkit.c.lime': { en: 'Lime', ar: 'ليموني' },
  'brandkit.c.cream': { en: 'Cream', ar: 'كريمي' },
  'brandkit.c.ink': { en: 'Ink', ar: 'كحلي' },
});

const LOGOS = [
  { file: 'wordmark-ink', bg: 'bg-white', fg: 'text-ink-950', ring: true },
  { file: 'wordmark-lime', bg: 'bg-turtle-600', fg: 'text-lime-300' },
  { file: 'wordmark-green', bg: 'bg-lime-300', fg: 'text-turtle-600' },
  { file: 'wordmark-white', bg: 'bg-ink-950', fg: 'text-white' },
] as const;

const PNG = new Set(['wordmark-ink', 'wordmark-white', 'wordmark-green', 'wordmark-lime']);

const SWATCHES: Array<{ key: keyof typeof BRAND_COLORS; text: string }> = [
  { key: 'green', text: 'text-white' },
  { key: 'leaf', text: 'text-turtle-950' },
  { key: 'lime', text: 'text-turtle-950' },
  { key: 'cream', text: 'text-ink-950' },
  { key: 'ink', text: 'text-white' },
];

function rgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} · ${(n >> 8) & 255} · ${n & 255}`;
}

/** Downloadable logo files, app icon and palette — the single source of truth for the identity. */
export function BrandKit() {
  const { t } = useI18n();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (hex: string) => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopied(hex);
      toast.success(t('brandkit.copied', { hex }));
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.message(hex);
    }
  };
  const dl = (href: string, label: string) => (
    <a href={href} download className="inline-flex items-center gap-1 rounded-lg bg-black/5 px-2 py-1 text-[11px] font-semibold hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15">
      <Download className="h-3 w-3" />{label}
    </a>
  );

  return (
    <Section title={t('brandkit.title')} subtitle={t('brandkit.subtitle')} className="mt-6">
      <div className="space-y-8">
        <div>
          <p className="mb-3 text-sm font-semibold text-ink-700 dark:text-ink-200">{t('brandkit.logos')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {LOGOS.map((l) => (
              <div key={l.file} className={cn('flex flex-col justify-between gap-6 rounded-2xl p-5', l.bg, 'ring' in l && l.ring && 'ring-1 ring-ink-100 dark:ring-ink-800')}>
                <Wordmark className={cn('h-10', l.fg)} />
                <div className="flex gap-1.5 text-ink-800">
                  <span className={cn('flex gap-1.5', l.bg === 'bg-white' || l.bg === 'bg-lime-300' ? 'text-ink-800' : 'text-white')}>
                    {dl(`/identity/${l.file}.svg`, 'SVG')}
                    {PNG.has(l.file) && dl(`/identity/${l.file}.png`, 'PNG')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:items-start">
          <div>
            <p className="mb-3 text-sm font-semibold text-ink-700 dark:text-ink-200">{t('brandkit.icon')}</p>
            <div className="flex items-end gap-3">
              <ArchTile className="h-20 w-20" />
              <ArchTile inverted className="h-14 w-14" />
              <ArchTile className="h-9 w-9" />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 text-ink-700 dark:text-ink-200">
              {dl('/identity/mark.svg', 'SVG')}
              {dl('/icon-512.png', 'PNG 512')}
              {dl('/identity/mark-lime.svg', 'SVG lime')}
            </div>
          </div>
          <div>
            <p className="mb-3 text-sm font-semibold text-ink-700 dark:text-ink-200">{t('brandkit.palette')}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {SWATCHES.map((s) => {
                const hex = BRAND_COLORS[s.key];
                return (
                  <button key={s.key} type="button" onClick={() => copy(hex)} className={cn('group flex min-h-[7rem] flex-col justify-between rounded-2xl p-3 text-start ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-pop', s.text)} style={{ background: hex }}>
                    <span className="text-xs font-semibold opacity-90">{t(`brandkit.c.${s.key}`)}</span>
                    <span>
                      <span className="flex items-center justify-between font-mono text-sm font-bold">{hex}{copied === hex ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-70" />}</span>
                      <span className="block font-mono text-[10px] opacity-70">{rgb(hex)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-ink-700 dark:text-ink-200">{t('brandkit.rules')}</p>
          <ul className="grid gap-2 text-sm text-ink-600 dark:text-ink-300 sm:grid-cols-2">
            {['rule1', 'rule2', 'rule3', 'rule4'].map((r) => (
              <li key={r} className="flex gap-2 rounded-xl bg-cream px-3 py-2.5 dark:bg-ink-900"><Check className="mt-0.5 h-4 w-4 shrink-0 text-turtle-600 dark:text-lime-300" />{t(`brandkit.${r}`)}</li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}
