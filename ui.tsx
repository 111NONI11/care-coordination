import { useId, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { useI18n, LOCALES, type Locale } from '../i18n';
import type { TaskStatus } from '../types';
import { ApiError } from '../api';

export function Button({ variant = 'secondary', block, className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; block?: boolean }) {
  return (
    <button type="button" className={`btn btn-${variant} ${block ? 'btn-block' : ''} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function ScreenHeader({ title, back, actions }: { title: string; back?: string | true; actions?: ReactNode }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <header className="screen-header">
      {back && (
        <button
          type="button"
          className="icon-btn"
          aria-label={t('common.back')}
          onClick={() => (back === true ? (window.history.length > 1 ? navigate(-1) : navigate('/')) : navigate(back))}
        >
          <Icon name="back" />
        </button>
      )}
      <h1 className="screen-title">{title}</h1>
      {actions && <div className="screen-header-actions">{actions}</div>}
    </header>
  );
}

export function Panel({ title, children, className = '', action, badge }: { title?: ReactNode; children: ReactNode; className?: string; action?: ReactNode; badge?: number }) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-head">
          <h2 className="panel-title">{title}</h2>
          {badge ? <span className="badge" aria-hidden="true">{badge}</span> : null}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatusChip({ status, expired }: { status: TaskStatus; expired?: boolean }) {
  const { t } = useI18n();
  const mark = status === 'accepted' || status === 'completed' ? '✓ ' : status === 'rejected' ? '! ' : '';
  return (
    <span className="chip-row">
      <span className={`chip chip-${status}`}>{mark}{t(`status.${status}`)}</span>
      {expired && <span className="chip chip-expired">! {t('status.expired')}</span>}
    </span>
  );
}

interface FieldProps { label: string; error?: string | null; hint?: string; children: (id: string, describedBy?: string) => ReactNode }
export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${error ? 'field-invalid' : ''}`}>
      <label className="field-label" htmlFor={id}>{label}</label>
      {children(id, describedBy)}
      {hint && <p className="field-hint" id={hintId}>{hint}</p>}
      {error && <p className="field-error" id={errId} role="alert">{error}</p>}
    </div>
  );
}

export function TextInput({ label, error, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | null; hint?: string }) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(id, d) => <input id={id} className="input" aria-invalid={!!error} aria-describedby={d} {...rest} />}
    </Field>
  );
}

export function TextArea({ label, error, hint, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string | null; hint?: string }) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(id, d) => <textarea id={id} className="input textarea" aria-invalid={!!error} aria-describedby={d} {...rest} />}
    </Field>
  );
}

export function Select({ label, error, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string | null }) {
  return (
    <Field label={label} error={error}>
      {(id, d) => (
        <select id={id} className="input select" aria-invalid={!!error} aria-describedby={d} {...rest}>
          {children}
        </select>
      )}
    </Field>
  );
}

export function Checkbox({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="checkbox-box" aria-hidden="true"><Icon name="check" size={16} /></span>
      <span>{label}</span>
    </label>
  );
}

/** Sticky bar keeping the primary action within thumb reach on phones. */
export function ActionBar({ children }: { children: ReactNode }) {
  return <div className="action-bar">{children}</div>;
}

export function LanguageSelect({ compact }: { compact?: boolean }) {
  const { t, locale, setLocale } = useI18n();
  const id = useId();
  return (
    <div className={`lang-select ${compact ? 'lang-compact' : ''}`}>
      <label htmlFor={id} className={compact ? 'sr-only' : 'field-label'}>
        {t('settings.language')}
      </label>
      {compact && <Icon name="globe" size={20} />}
      <select id={id} className="input select" value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function NotFound() {
  const { t } = useI18n();
  return (
    <div className="screen">
      <ScreenHeader title={t('errors.not_found')} back="/" />
      <div className="screen-body">
        <EmptyState>{t('errors.not_found_body')}</EmptyState>
        <Link className="btn btn-secondary" to="/">{t('nav.overview')}</Link>
      </div>
    </div>
  );
}

/** Translates an API error code into a user-facing message. */
export function errorMessage(t: (k: string, v?: Record<string, string | number>) => string, e: unknown) {
  if (e instanceof ApiError) {
    const key = `errors.${e.code}`;
    const msg = t(key, { max: e.max ?? '' });
    return msg === key ? t('errors.generic') : msg;
  }
  return t('errors.generic');
}
