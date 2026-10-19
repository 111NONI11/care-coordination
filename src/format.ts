import { useMemo } from 'react';
import { useI18n, type Locale } from './i18n';

/** Locale-aware date/time helpers. All stored dates are ISO (UTC); display is in the browser's time zone. */
export function makeFormat(locale: Locale) {
  const f = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, opts);
  const dayShort = f({ weekday: 'short', day: 'numeric', month: 'numeric' });
  const dayLong = f({ weekday: 'long', day: 'numeric', month: 'long' });
  const time = f({ hour: 'numeric', minute: '2-digit' });
  const dateTime = f({ weekday: 'short', day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' });
  const full = f({ day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const narrowWeekday = f({ weekday: 'narrow' });
  const longWeekday = f({ weekday: 'long' });
  const monthYear = f({ month: 'long', year: 'numeric' });
  const rel = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  return {
    dayShort: (d: string | Date) => dayShort.format(new Date(d)),
    dayLong: (d: string | Date) => dayLong.format(new Date(d)),
    time: (d: string | Date) => time.format(new Date(d)),
    dateTime: (d: string | Date) => dateTime.format(new Date(d)),
    full: (d: string | Date) => full.format(new Date(d)),
    narrowWeekday: (d: Date) => narrowWeekday.format(d),
    longWeekday: (d: Date) => longWeekday.format(d),
    monthYear: (d: Date) => monthYear.format(d),
    /** "hh:mm" (24h, stored) → locale time */
    clock: (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number);
      const d = new Date(2000, 0, 3, h, m);
      return time.format(d);
    },
    /** Remaining time until the deadline, e.g. "in 3 hours" / "tomorrow" / "2 days ago". */
    relative: (d: string | Date, now = new Date()) => {
      const diffMs = new Date(d).getTime() - now.getTime();
      const mins = Math.round(diffMs / 60_000);
      if (Math.abs(mins) < 60) return rel.format(mins, 'minute');
      const hours = Math.round(diffMs / 3_600_000);
      if (Math.abs(hours) < 24) return rel.format(hours, 'hour');
      return rel.format(Math.round(diffMs / 86_400_000), 'day');
    },
  };
}

export function useFormat() {
  const { locale } = useI18n();
  return useMemo(() => makeFormat(locale), [locale]);
}

/** First day of week for the locale (1 = Monday ... 7 = Sunday), Monday if unknown. */
export function firstDayOfWeek(locale: string): number {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    if (info?.firstDay) return info.firstDay;
  } catch {
    /* not supported */
  }
  return 1;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Local YYYY-MM-DD for a date. */
export const localDateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Local HH:mm for a date. */
export const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** Value for <input type="datetime-local">. */
export const toLocalInput = (iso: string | Date) => {
  const d = new Date(iso);
  return `${localDateKey(d)}T${localTime(d)}`;
};
/** Combine local date (YYYY-MM-DD) and time (HH:mm) into an ISO string, or null if invalid. */
export function combineLocal(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const dt = new Date(y, m - 1, d, h, min);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}
export function fromLocalInput(v: string): string | null {
  const [date, time] = v.split('T');
  return date && time ? combineLocal(date, time.slice(0, 5)) : null;
}
export const sameDay = (a: Date, b: Date) => localDateKey(a) === localDateKey(b);
