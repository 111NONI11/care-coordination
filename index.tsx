import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import sk from './locales/sk.json';
import en from './locales/en.json';
import ru from './locales/ru.json';
import ar from './locales/ar.json';
import zhCN from './locales/zh-CN.json';

export const LOCALES = [
  { code: 'sk', label: 'Slovenčina', dir: 'ltr' },
  { code: 'en', label: 'English', dir: 'ltr' },
  { code: 'ru', label: 'Русский', dir: 'ltr' },
  { code: 'ar', label: 'العربية', dir: 'rtl' },
  { code: 'zh-CN', label: '简体中文', dir: 'ltr' },
] as const;

export type Locale = (typeof LOCALES)[number]['code'];
type Dict = { [k: string]: string | Dict };

export const MESSAGES: Record<Locale, Dict> = { sk, en, ru, ar, 'zh-CN': zhCN };
const STORAGE_KEY = 'care.locale';

function lookup(dict: Dict, key: string): string | undefined {
  let cur: string | Dict | undefined = dict;
  for (const part of key.split('.')) {
    if (cur === undefined || typeof cur === 'string') return undefined;
    cur = cur[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in MESSAGES) return saved as Locale;
  } catch {
    /* storage unavailable */
  }
  for (const lang of navigator.languages ?? [navigator.language]) {
    const l = lang.toLowerCase();
    if (l.startsWith('zh')) return 'zh-CN';
    const base = l.split('-')[0];
    if (base in MESSAGES) return base as Locale;
  }
  return 'sk';
}

export type TFunc = (key: string, vars?: Record<string, string | number>) => string;

interface I18nValue {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  setLocale: (l: Locale) => void;
  t: TFunc;
}

const I18nContext = createContext<I18nValue | null>(null);

export function makeT(locale: Locale): TFunc {
  const dict = MESSAGES[locale];
  const plural = new Intl.PluralRules(locale);
  const num = new Intl.NumberFormat(locale);
  return (key, vars) => {
    let msg: string | undefined;
    if (vars && typeof vars.count === 'number') {
      msg = lookup(dict, `${key}_${plural.select(vars.count)}`) ?? lookup(dict, `${key}_other`);
    }
    msg ??= lookup(dict, key) ?? lookup(MESSAGES.en, key) ?? key;
    if (!vars) return msg;
    return msg.replace(/\{(\w+)\}/g, (_, k) => {
      const v = vars[k];
      if (v === undefined) return `{${k}}`;
      return typeof v === 'number' ? num.format(v) : v;
    });
  };
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);
  const dir = LOCALES.find((l) => l.code === locale)!.dir;

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* storage unavailable: choice lasts for this visit only */
    }
  }, []);

  const value = useMemo(() => ({ locale, dir, setLocale, t: makeT(locale) }), [locale, dir, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside provider');
  return ctx;
}
