import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useFormat, combineLocal, localDateKey, localTime } from '../format';
import { useAppState, useStore } from '../store';
import { ActionBar, Button, Checkbox, EmptyState, NotFound, Panel, ScreenHeader, StatusChip, TextInput, errorMessage } from '../components/ui';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { ApiError } from '../api';
import { LIMITS, isExpired } from '../../shared/domain.js';

type Errors = Partial<Record<'title' | 'date' | 'time' | 'location' | 'form', string>>;

/** S3 – new event (also used for editing). Save → S4 to create the related task; Cancel → back to S2. */
export function EventFormScreen() {
  const { t } = useI18n();
  const s = useAppState();
  const { mutate } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const { id } = useParams();
  const [params] = useSearchParams();
  const existing = id ? s.events.find((e) => e.id === Number(id)) : undefined;
  const start = existing ? new Date(existing.starts_at) : null;

  const [title, setTitle] = useState(existing?.title ?? '');
  const [date, setDate] = useState(start ? localDateKey(start) : params.get('d') ?? '');
  const [time, setTime] = useState(start ? localTime(start) : '');
  const [location, setLocation] = useState(existing?.location ?? '');
  const [transport, setTransport] = useState(existing?.needs_transport ?? false);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  if (id && !existing) return <NotFound />;

  async function save(e: FormEvent) {
    e.preventDefault();
    const errs: Errors = {};
    if (!title.trim()) errs.title = t('errors.required');
    if (!date) errs.date = t('errors.required');
    if (!time) errs.time = t('errors.required');
    const iso = date && time ? combineLocal(date, time) : null;
    if (date && time && !iso) errs.date = t('errors.invalid_date');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const body = { title, starts_at: iso, location, needs_transport: transport };
      if (existing) {
        await mutate('patch', `/api/events/${existing.id}`, body);
        toast({ title: t('toast.saved') });
        navigate(`/events/${existing.id}`, { replace: true });
      } else {
        const r = await mutate<{ id: number }>('post', '/api/events', body);
        toast({ title: t('toast.eventSaved') });
        // S3 → S4: continue with the task belonging to the event.
        navigate(`/tasks/new?event=${r.id}`, { replace: true });
      }
    } catch (err) {
      const field = err instanceof ApiError ? err.field : undefined;
      const msg = errorMessage(t, err);
      setErrors(field === 'title' || field === 'location' ? { [field]: msg } : field === 'starts_at' ? { date: msg } : { form: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="screen" onSubmit={save} noValidate>
      <ScreenHeader title={existing ? t('event.editTitle') : t('event.newTitle')} back />
      <div className="screen-body form-body">
        <TextInput label={t('event.name')} value={title} maxLength={LIMITS.title} onChange={(e) => setTitle(e.target.value)} error={errors.title} placeholder={t('event.namePlaceholder')} />
        <div className="field-row">
          <TextInput label={t('event.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} />
          <TextInput label={t('event.time')} type="time" value={time} onChange={(e) => setTime(e.target.value)} error={errors.time} />
        </div>
        <TextInput label={t('event.location')} value={location} maxLength={LIMITS.location} onChange={(e) => setLocation(e.target.value)} error={errors.location} />
        <Checkbox label={t('event.needsTransport')} checked={transport} onChange={setTransport} />
        {errors.form && <p className="form-error" role="alert">{errors.form}</p>}
      </div>
      <ActionBar>
        <div className="btn-pair">
          <Button onClick={() => navigate(existing ? `/events/${existing.id}` : '/calendar')}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={busy}>{t('common.save')}</Button>
        </div>
      </ActionBar>
    </form>
  );
}

export function EventDetailScreen() {
  const { t } = useI18n();
  const fmt = useFormat();
  const s = useAppState();
  const { mutate } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const { id } = useParams();
  const ev = s.events.find((e) => e.id === Number(id));
  const [confirming, setConfirming] = useState(false);
  if (!ev) return <NotFound />;
  const tasks = s.tasks.filter((x) => x.event_id === ev.id);
  const canCancel = s.me.role === 'coordinator' || ev.created_by === s.me.id;

  async function cancelEvent() {
    try {
      await mutate('post', `/api/events/${ev!.id}/cancel`);
      toast({ title: t('event.cancelledToast') });
      setConfirming(false);
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: 'error' });
    }
  }

  return (
    <div className="screen">
      <ScreenHeader title={ev.title} back="/calendar" />
      <div className="screen-body">
        <Panel>
          {ev.cancelled && <p><span className="chip chip-cancelled">{t('event.cancelled')}</span></p>}
          <p className="detail-line"><Icon name="clock" size={20} /> {fmt.dayLong(ev.starts_at)}, {fmt.time(ev.starts_at)}</p>
          {ev.location && <p className="detail-line"><Icon name="pin" size={20} /> {ev.location}</p>}
          <p className="detail-line"><Icon name="car" size={20} /> {ev.needs_transport ? t('event.transportYes') : t('event.transportNo')}</p>
        </Panel>
        <Panel title={t('event.tasks')}>
          {tasks.length === 0 ? <EmptyState>{t('event.noTasks')}</EmptyState> : (
            <ul className="plain-list">
              {tasks.map((x) => (
                <li key={x.id}>
                  <Link to={`/tasks/${x.id}`} className="row-card">
                    <span>{x.title}</span>
                    <StatusChip status={x.status} expired={isExpired(x)} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {!ev.cancelled && (
          <div className="stack">
            <Button onClick={() => navigate(`/events/${ev.id}/edit`)}><Icon name="edit" size={20} /> {t('common.edit')}</Button>
            {canCancel && !confirming && <Button variant="danger" onClick={() => setConfirming(true)}>{t('event.cancelEvent')}</Button>}
            {confirming && (
              <div className="confirm-box" role="alertdialog" aria-labelledby="cancel-ev-q">
                <p id="cancel-ev-q">{t('event.cancelConfirm')}</p>
                <div className="btn-pair">
                  <Button onClick={() => setConfirming(false)}>{t('common.no')}</Button>
                  <Button variant="danger" onClick={cancelEvent}>{t('common.yesCancel')}</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {!ev.cancelled && (
        <ActionBar>
          <Button variant="primary" block onClick={() => navigate(`/tasks/new?event=${ev.id}`)}>
            <Icon name="plus" /> {t('event.addTask')}
          </Button>
        </ActionBar>
      )}
    </div>
  );
}
