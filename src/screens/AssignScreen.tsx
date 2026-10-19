import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useAppState, useSelectors, useStore } from '../store';
import { ActionBar, Button, NotFound, ScreenHeader, errorMessage } from '../components/ui';
import { useToast } from '../components/Toast';
import { availabilityFor, type AvailabilityStatus } from '../availability';
import { checkAction, isExpired } from '../../shared/domain.js';

/** S5a – "Komu priradiť?": pick a helper, availability comes from their calendar. */
export function AssignScreen() {
  const { t } = useI18n();
  const fmt = useFormat();
  const s = useAppState();
  const { memberName, isCoordinatorFor } = useSelectors();
  const { mutate } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const { id } = useParams();
  const task = s.tasks.find((x) => x.id === Number(id));
  const declinedBy = new Set(s.history.filter((h) => h.task_id === task?.id && h.type === 'declined').map((h) => h.actor_id));
  const [choice, setChoice] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!task) return <NotFound />;
  const blocked = !isCoordinatorFor(task) ? 'forbidden' : checkAction('assign', task, { id: s.me.id, role: s.me.role });

  const describe = (a: AvailabilityStatus) => {
    switch (a.kind) {
      case 'free': return { text: t('assign.free'), tone: 'ok' };
      case 'block': return { text: t(a.label === 'work' ? 'assign.atWork' : 'assign.busy', { from: fmt.clock(a.start), to: fmt.clock(a.end) }), tone: 'warn' };
      case 'task': return { text: t('assign.otherTask', { title: a.task.title }), tone: 'warn' };
      default: return { text: t('assign.unknown'), tone: 'muted' };
    }
  };

  async function send() {
    if (!choice) {
      setError(t('assign.pickSomeone'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await mutate('post', `/api/tasks/${task!.id}/actions`, { action: 'assign', assignee_id: choice, version: task!.version });
      if (choice === s.me.id) toast({ title: t('toast.selfAssigned') });
      else toast({ title: t('toast.sentTo', { name: memberName(choice) }), body: t('toast.awaitingConfirmation') });
      navigate(`/tasks/${task!.id}`, { replace: true }); // → S6
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <ScreenHeader title={t('assign.title')} back />
      <div className="screen-body">
        <p className="muted">{task.title}{task.due_at && ` · ${fmt.dateTime(task.due_at)}`}</p>
        {blocked ? (
          <p className="form-error" role="alert">{t(`errors.${blocked}`)}{isExpired(task) && ` ${t('errors.edit_deadline_first')}`}</p>
        ) : (
          <fieldset className="radio-list">
            <legend className="sr-only">{t('assign.title')}</legend>
            {s.members.map((m) => {
              const a = describe(availabilityFor(s, m.id, task));
              const current = task.assignee_id === m.id && task.status === 'pending_confirmation';
              return (
                <label key={m.id} className={`radio-card ${choice === m.id ? 'is-selected' : ''}`}>
                  <input type="radio" name="assignee" value={m.id} checked={choice === m.id} disabled={current} onChange={() => { setChoice(m.id); setError(null); }} />
                  <span className="radio-dot" aria-hidden="true" />
                  <span className="radio-text">
                    <strong>{m.id === s.me.id ? t('assign.me', { name: m.name }) : m.name}</strong>
                    <span className={`avail avail-${a.tone}`}>{a.text}</span>
                    {declinedBy.has(m.id) && <span className="avail avail-warn">{t('assign.declinedBefore')}</span>}
                    {current && <span className="avail avail-muted">{t('assign.currentlyAsked')}</span>}
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
        <p className="muted small">{t('assign.availabilityHint')}</p>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      {!blocked && (
        <ActionBar>
          <Button variant="primary" block disabled={busy} onClick={send}>{t('assign.send')}</Button>
        </ActionBar>
      )}
    </div>
  );
}
