import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n, LOCALES } from '../i18n';
import { useFormat } from '../format';
import { useAppState, useStore } from '../store';
import { Button, LanguageSelect, Panel, ScreenHeader, Select, TextInput, errorMessage } from '../components/ui';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import type { Member } from '../types';
import { LIMITS } from '../../shared/domain.js';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

/** Language, care recipient, family members with availability, medicines, demo reset and sign-out. */
export function SettingsScreen() {
  const { t, locale } = useI18n();
  const fmt = useFormat();
  const s = useAppState();
  const { mutate, logout, demo, refresh } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const isCoord = s.me.role === 'coordinator';

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast({ title: ok });
      return true;
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: 'error' });
      return false;
    }
  };

  const weekdayName = (wd: number) => fmt.longWeekday(new Date(2024, 0, 7 + wd)); // 7 Jan 2024 = Sunday

  return (
    <div className="screen">
      <ScreenHeader title={t('settings.title')} back="/" />
      <div className="screen-body">
        <Panel title={t('settings.language')}>
          <LanguageSelect />
        </Panel>

        <Panel title={t('settings.account')}>
          <p>{t('settings.signedInAs', { name: s.me.name, username: s.me.username })} · {t(`roles.${s.me.role}`)}</p>
          <Button onClick={() => logout().then(() => navigate('/'))}><Icon name="logout" size={20} /> {t('settings.logout')}</Button>
        </Panel>

        <Panel title={t('settings.recipient')}>
          <NameForm initial={s.recipient.name} label={t('settings.recipientName')} disabled={!isCoord}
            onSave={(name) => run(() => mutate('patch', '/api/recipient', { name }), t('toast.saved'))} />
        </Panel>

        <Panel title={t('settings.people')}>
          <ul className="plain-list">
            {s.members.map((m) => (
              <MemberRow key={m.id} member={m} editable={isCoord || m.id === s.me.id} weekdayName={weekdayName} run={run} />
            ))}
          </ul>
          {isCoord && <AddMember run={run} />}
        </Panel>

        <Panel title={t('settings.medications')}>
          <ul className="plain-list">
            {s.medications.map((m) => (
              <li key={m.id} className="row-inline">
                <span>{fmt.clock(m.time)} {m.label}</span>
                {isCoord && (
                  <button type="button" className="icon-btn" aria-label={t('common.delete')} onClick={() => run(() => mutate('del', `/api/medications/${m.id}`))}>
                    <Icon name="trash" size={20} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {isCoord && <AddMedication run={run} />}
        </Panel>

        {demo && isCoord && (
          <Panel title={t('settings.demo')}>
            <p className="muted small">{t('settings.demoHint')}</p>
            <Button variant="danger" onClick={async () => {
              const ok = window.confirm(t('settings.demoConfirm'));
              if (!ok) return;
              const seedLocale = LOCALES.some((l) => l.code === locale) ? locale : 'sk';
              if (await run(() => mutate('post', '/api/demo/reset', { locale: seedLocale }), t('toast.demoReset'))) {
                await refresh();
                navigate('/');
              }
            }}>{t('settings.demoReset')}</Button>
          </Panel>
        )}
        <p className="muted small">{t('settings.privacy')}</p>
      </div>
    </div>
  );
}

function NameForm({ initial, label, disabled, onSave }: { initial: string; label: string; disabled?: boolean; onSave: (v: string) => Promise<boolean> }) {
  const { t } = useI18n();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="inline-form" onSubmit={async (e) => {
      e.preventDefault();
      if (!value.trim()) return setError(t('errors.required'));
      setError(null);
      await onSave(value);
    }} noValidate>
      <TextInput label={label} value={value} maxLength={LIMITS.name} disabled={disabled} onChange={(e) => setValue(e.target.value)} error={error} />
      {!disabled && <Button type="submit" disabled={value === initial}>{t('common.save')}</Button>}
    </form>
  );
}

type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;

function MemberRow({ member, editable, weekdayName, run }: { member: Member; editable: boolean; weekdayName: (wd: number) => string; run: Run }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const s = useAppState();
  const { mutate } = useStore();
  const [open, setOpen] = useState(false);
  const [wd, setWd] = useState('1');
  const [from, setFrom] = useState('08:00');
  const [to, setTo] = useState('16:00');
  const [label, setLabel] = useState<'work' | 'other'>('work');
  const blocks = s.availability.filter((a) => a.user_id === member.id);

  return (
    <li className="member">
      <div className="row-inline">
        <span><strong>{member.name}</strong> <span className="muted small">@{member.username} · {t(`roles.${member.role}`)}</span></span>
        {editable && <Button variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? t('common.close') : t('common.edit')}</Button>}
      </div>
      <p className="muted small">
        {blocks.length === 0 ? t('settings.alwaysFree') : blocks.map((b) => `${weekdayName(b.weekday)} ${fmt.clock(b.start_time)}–${fmt.clock(b.end_time)} (${t(`settings.block_${b.label}`)})`).join(', ')}
      </p>
      {open && (
        <div className="member-edit">
          <NameForm initial={member.name} label={t('settings.memberName')} onSave={(name) => run(() => mutate('patch', `/api/members/${member.id}`, { name }), t('toast.saved'))} />
          <h3 className="field-label">{t('settings.availability')}</h3>
          <ul className="plain-list">
            {blocks.map((b) => (
              <li key={b.id} className="row-inline">
                <span>{weekdayName(b.weekday)} {fmt.clock(b.start_time)}–{fmt.clock(b.end_time)} · {t(`settings.block_${b.label}`)}</span>
                <button type="button" className="icon-btn" aria-label={t('common.delete')} onClick={() => run(() => mutate('del', `/api/availability/${b.id}`))}>
                  <Icon name="trash" size={20} />
                </button>
              </li>
            ))}
          </ul>
          <form className="grid-form" noValidate onSubmit={(e: FormEvent) => {
            e.preventDefault();
            run(() => mutate('post', '/api/availability', { user_id: member.id, weekday: Number(wd), start_time: from, end_time: to, label }), t('toast.saved'));
          }}>
            <Select label={t('settings.weekday')} value={wd} onChange={(e) => setWd(e.target.value)}>
              {WEEKDAYS.map((d) => <option key={d} value={d}>{weekdayName(d)}</option>)}
            </Select>
            <TextInput label={t('settings.from')} type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
            <TextInput label={t('settings.to')} type="time" value={to} onChange={(e) => setTo(e.target.value)} />
            <Select label={t('settings.blockType')} value={label} onChange={(e) => setLabel(e.target.value as 'work' | 'other')}>
              <option value="work">{t('settings.block_work')}</option>
              <option value="other">{t('settings.block_other')}</option>
            </Select>
            <Button type="submit"><Icon name="plus" size={20} /> {t('settings.addBlock')}</Button>
          </form>
        </div>
      )}
    </li>
  );
}

function AddMember({ run }: { run: Run }) {
  const { t } = useI18n();
  const { mutate } = useStore();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('helper');
  return (
    <details className="add-box">
      <summary>{t('settings.addMember')}</summary>
      <form className="form-body" noValidate onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => mutate('post', '/api/members', { name, username, password, role }), t('toast.saved'))) {
          setName(''); setUsername(''); setPassword('');
        }
      }}>
        <TextInput label={t('settings.memberName')} value={name} onChange={(e) => setName(e.target.value)} />
        <TextInput label={t('login.username')} value={username} autoComplete="off" onChange={(e) => setUsername(e.target.value)} hint={t('settings.usernameHint')} />
        <TextInput label={t('settings.initialPassword')} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint={t('settings.passwordHint')} />
        <Select label={t('settings.role')} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="helper">{t('roles.helper')}</option>
          <option value="coordinator">{t('roles.coordinator')}</option>
        </Select>
        <Button type="submit" variant="primary">{t('settings.addMember')}</Button>
      </form>
    </details>
  );
}

function AddMedication({ run }: { run: Run }) {
  const { t } = useI18n();
  const { mutate } = useStore();
  const [label, setLabel] = useState('');
  const [time, setTime] = useState('12:00');
  return (
    <form className="grid-form" noValidate onSubmit={async (e) => {
      e.preventDefault();
      if (await run(() => mutate('post', '/api/medications', { label, time }), t('toast.saved'))) setLabel('');
    }}>
      <TextInput label={t('settings.medLabel')} value={label} onChange={(e) => setLabel(e.target.value)} />
      <TextInput label={t('settings.medTime')} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      <Button type="submit"><Icon name="plus" size={20} /> {t('settings.addMed')}</Button>
    </form>
  );
}
