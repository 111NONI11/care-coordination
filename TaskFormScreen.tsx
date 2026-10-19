import { useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useFormat, fromLocalInput, toLocalInput } from '../format';
import { useAppState, useStore } from '../store';
import { ActionBar, Button, NotFound, ScreenHeader, Select, TextArea, TextInput, errorMessage } from '../components/ui';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { ApiError } from '../api';
import { LIMITS } from '../../shared/domain.js';

type Errors = Partial<Record<'title' | 'event' | 'due' | 'notes' | 'form', string>>;
const DEFAULT_LEAD_MIN = 45; // prototype: appointment 9:00 → leave at 8:15

/** S4 – new task (also edit). "Assign →" goes to S5a, "Publish to board" is the S5b alternative. */
export function TaskFormScreen() {
  const { t } = useI18n();
  const fmt = useFormat();
  const s = useAppState();
  const { mutate } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const { id } = useParams();
  const [params] = useSearchParams();
  const existing = id ? s.tasks.find((x) => x.id === Number(id)) : undefined;
  const preEvent = s.events.find((e) => e.id === Number(params.get('event')) && !e.cancelled);

  const defaultDue = () => {
    if (!preEvent) return '';
    const d = new Date(new Date(preEvent.starts_at).getTime() - DEFAULT_LEAD_MIN * 60_000);
    return d.getTime() > Date.now() ? toLocalInput(d) : '';
  };
  const [title, setTitle] = useState(existing?.title ?? (preEvent?.needs_transport ? t('task.defaultTransport', { name: s.recipient.name }) : ''));
  const [eventId, setEventId] = useState<string>(String(existing?.event_id ?? preEvent?.id ?? ''));
  const [due, setDue] = useState(existing?.due_at ? toLocalInput(existing.due_at) : defaultDue());
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  if (id && !existing) return <NotFound />;
  if (existing && (existing.status === 'completed' || existing.status === 'cancelled')) return <NotFound />;

  const openEvents = s.events.filter((e) => !e.cancelled && (new Date(e.starts_at).getTime() > Date.now() || e.id === existing?.event_id));

  async function submit(mode: 'assign' | 'publish' | 'save', e?: FormEvent) {
    e?.preventDefault();
    const errs: Errors = {};
    if (!title.trim()) errs.title = t('errors.required');
    const iso = due ? fromLocalInput(due) : null;
    if (!due) errs.due = t('errors.required');
    else if (!iso) errs.due = t('errors.invalid_date');
    else if (!existing && new Date(iso).getTime() < Date.now()) errs.due = t('errors.deadline_in_past');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const body = { title, event_id: eventId ? Number(eventId) : null, due_at: iso, notes };
    try {
      if (existing) {
        await mutate('patch', `/api/tasks/${existing.id}`, { ...body, version: existing.version });
        toast({ title: t('toast.saved') });
        navigate(`/tasks/${existing.id}`, { replace: true });
      } else {
        const r = await mutate<{ id: number }>('post', '/api/tasks', { ...body, publish: mode === 'publish' });
        if (mode === 'publish') {
          toast({ title: t('toast.published'), body: t('board.everyoneNotified') });
          navigate('/tasks', { replace: true });
        } else {
          navigate(`/tasks/${r.id}/assign`, { replace: true });
        }
      }
    } catch (err) {
      const f = err instanceof ApiError ? err.field : undefined;
      const msg = errorMessage(t, err);
      setErrors(f === 'title' ? { title: msg } : f === 'due_at' ? { due: msg } : f === 'event_id' ? { event: msg } : f === 'notes' ? { notes: msg } : { form: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="screen" onSubmit={(e) => submit(existing ? 'save' : 'assign', e)} noValidate>
      <ScreenHeader title={existing ? t('task.editTitle') : t('task.newTitle')} back />
      <div className="screen-body form-body">
        <TextInput label={t('task.title')} value={title} maxLength={LIMITS.title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
        <Select label={t('task.event')} value={eventId} onChange={(e) => setEventId(e.target.value)} error={errors.event}>
          <option value="">{t('task.noEvent')}</option>
          {openEvents.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.title} · {fmt.dayShort(ev.starts_at)} {fmt.time(ev.starts_at)}
            </option>
          ))}
        </Select>
        <TextInput label={t('task.deadline')} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} error={errors.due} />
        <TextArea label={t('task.notes')} value={notes} maxLength={LIMITS.note} rows={3} onChange={(e) => setNotes(e.target.value)} error={errors.notes} />
        {errors.form && <p className="form-error" role="alert">{errors.form}</p>}
      </div>
      <ActionBar>
        {existing ? (
          <div className="btn-pair">
            <Button onClick={() => navigate(`/tasks/${existing.id}`)}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" disabled={busy}>{t('common.save')}</Button>
          </div>
        ) : (
          <div className="stack">
            <Button type="submit" variant="primary" block disabled={busy}>
              {t('task.assignNext')} <Icon name="forward" size={20} />
            </Button>
            <Button block disabled={busy} onClick={() => submit('publish')}>{t('task.publishToBoard')}</Button>
          </div>
        )}
      </ActionBar>
    </form>
  );
}
