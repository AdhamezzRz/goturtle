import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { common } from './common';

/**
 * Lightweight bilingual i18n (Arabic default, RTL-aware).
 * Dictionaries are flat `key → { en, ar }` maps, merged from ./common and
 * each portal's own file (registered with registerDictionary).
 *   const { t, locale, dir } = useI18n();  t('orders.title')  t('x.count', { n: 3 })
 */
export type Locale = 'ar' | 'en';
export type Dict = Record<string, { en: string; ar: string }>;

const dictionary: Dict = { ...common };
export function registerDictionary(d: Dict) {
  Object.assign(dictionary, d);
}

let currentLocale: Locale = (() => {
  try {
    const saved = localStorage.getItem('gt.locale');
    if (saved === 'ar' || saved === 'en') return saved;
  } catch {
    /* storage unavailable */
  }
  return navigator.language?.startsWith('en') ? 'en' : 'ar';
})();

export const getLocale = () => currentLocale;

export function translate(key: string, vars?: Record<string, string | number>, locale: Locale = currentLocale): string {
  const entry = dictionary[key];
  let s = entry ? entry[locale] : humanize(key);
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

function humanize(key: string) {
  const last = key.split('.').pop() ?? key;
  return last.replace(/[_-]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase());
}

interface I18nValue {
  locale: Locale;
  dir: 'rtl' | 'ltr';
  setLocale: (l: Locale) => void;
  toggle: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Pick the right field of a bilingual record: pick({ en, ar }) or pick(row, 'name') → nameAr/nameEn */
  pick: (v: { en?: string | null; ar?: string | null } | Record<string, unknown>, base?: string) => string;
}

const Ctx = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(currentLocale);

  useEffect(() => {
    currentLocale = locale;
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    document.body.classList.toggle('font-arabic', locale === 'ar');
    try {
      localStorage.setItem('gt.locale', locale);
    } catch {
      /* ignore */
    }
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    currentLocale = l;
    setLocaleState(l);
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      dir: locale === 'ar' ? 'rtl' : 'ltr',
      setLocale,
      toggle: () => setLocale(locale === 'ar' ? 'en' : 'ar'),
      t: (key, vars) => translate(key, vars, locale),
      pick: (v, base) => {
        const rec = v as Record<string, unknown>;
        if (base) return String((locale === 'ar' ? rec[`${base}Ar`] : rec[`${base}En`]) ?? rec[`${base}En`] ?? rec[base] ?? '');
        return String((locale === 'ar' ? rec.ar : rec.en) ?? rec.en ?? '');
      },
    }),
    [locale, setLocale],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}

/** Translates an API error code (DomainError.code) with a fallback to the server message. */
export function errorMessage(err: unknown): string {
  const e = err as { code?: string; message?: string };
  if (e?.code && dictionary[`error.${e.code}`]) return translate(`error.${e.code}`);
  return e?.message || translate('error.generic');
}
