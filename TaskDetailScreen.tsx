import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useAppState, useSelectors, useStore } from '../store';
import { ActionBar, Button, EmptyState, NotFound, Panel, ScreenHeader, StatusChip, errorMessage } from '../components/ui';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { checkAction, isExpired } from '../../shared/domain.js';
import type { HistoryEntry } from '../types';

/**
 * Task detail. Depending on status this is S6 (waiting for confirmation),
 * S8 (accepted, add a visit record) or S10 (declined, assign again).
 */
export function TaskDetailScreen() {
  const { t } = useI18n();
  const fmt = useFormat();
  const s = useAppState();
  const { memberName, eventById } = useSelectors();
  const { mutate } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const { id } = useParams();
  const task = s.tasks.find((x) => x.id === Number(id));
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  if (!task) return <NotFound />;

  const me = { id: s.me.id, role: s.me.role };
  const can = (a: string) => !checkAction(a, task, me);
  const expired = isExpired(task);
  const event = task.event_id ? eventById.get(task.event_id) : undefined;
  const history = s.history.filter((h) => h.task_id === task.id);
  const lastDecline = [...history].reverse().find((h) => h.type === 'declined');
  const records = s.records.filter((r) => r.task_id === task.id);
  const isAssignee = task.assignee_id === s.me.id;
  const canEdit = (s.me.role === 'coordinator' || task.created_by === s.me.id) && !['completed', 'cancelled'].includes(task.status);
  const canRecord = (task.status === 'accepted' || task.status === 'completed') && (isAssignee || s.me.role === 'coordinator');

  async function act(action: string, okMsg: string) {
    setBusy(true);
    try {
      await mutate('post', `/api/tasks/${task!.id}/actions`, { action, version: task!.version });
      toast({ title: okMsg });
      setConfirmCancel(false);
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const historyText = (h: HistoryEntry) => {
    const vars = { actor: memberName(h.actor_id), target: memberName(h.target_id) };
    return t(`history.${h.type}`, vars);
  };

  // Primary action for the bottom bar, following the prototype.
  let primary: JSX.Element | null = null;
  if (task.status === 'pending_confirmation' && isAssignee) {
    primary = (
      <div className="btn-pair">
        <Button disabled={busy || !can('decline')} onClick={() => navigate(`/tasks/${task.id}/decline`)}>{t('task.decline')}</Button>
        <Button variant="primary" disabled={busy || !can('accept')} onClick={() => act('accept', t('toast.accepted'))}>{t('task.accept')}</Button>
      </div>
    );
  } else if (canRecord) {
    primary = <Button variant="primary" block onClick={() => navigate(`/tasks/${task.id}/records/new`)}><Icon name="plus" /> {t('task.addRecord')}</Button>;
  } else if ((task.status === 'rejected' || task.status === 'unassigned') && can('assign')) {
    primary = <Button variant="primary" block onClick={() => navigate(`/tasks/${task.id}/assign`)}>{task.status === 'rejected' ? t('task.reassign') : t('task.assign')}</Button>;
  } else if ((task.status === 'rejected' || task.status === 'unassigned') && can('claim')) {
    primary = <Button variant="primary" block disabled={busy} onClick={() => act('claim', t('toast.claimed', { title: task.title }))}>{t('board.claim')}</Button>;
  }

  return (
    <div className="screen">
      <ScreenHeader title={t('task.detailTitle')} back />
      <div className="screen-body">
        <Panel>
          <h2 className="task-title">{task.title}</h2>
          {task.due_at && <p className="muted">{fmt.dateTime(task.due_at)} <span className="small">({fmt.relative(task.due_at)})</span></p>}
          <StatusChip status={task.status} expired={expired} />
          {expired && <p className="text-danger small">{t('task.expiredHint')}</p>}

          {task.status === 'pending_confirmation' && (
            <p className="detail-line"><Icon name="clock" size={20} /> {t('task.waitingFor', { name: memberName(task.assignee_id) })}</p>
          )}
          {(task.status === 'accepted' || task.status === 'completed') && task.assignee_id && (
            <>
              <p className="detail-strong">{t('task.handledBy', { name: memberName(task.assignee_id) })}</p>
              {task.accepted_at && <p className="muted small">{t('task.confirmedAt', { name: memberName(task.accepted_by), time: fmt.dateTime(task.accepted_at) })}</p>}
            </>
          )}
          {task.status === 'rejected' && lastDecline && (
            <div className="decline-box">
              <p className="detail-strong">{t('task.declinedBy', { name: memberName(lastDecline.actor_id) })}</p>
              {lastDecline.reason ? <p className="quote">{t('common.quote', { text: lastDecline.reason! })}</p> : <p className="muted small">{t('task.noReason')}</p>}
            </div>
          )}
          {event && (
            <p className="detail-line">
              <Icon name="calendar" size={20} />
              <Link to={`/events/${event.id}`}>{event.title} · {fmt.dayShort(event.starts_at)} {fmt.time(event.starts_at)}</Link>
            </p>
          )}
          {event?.location && <p className="detail-line"><Icon name="pin" size={20} /> {event.location}</p>}
          {task.notes && <p className="notes">{task.notes}</p>}
        </Panel>

        <Panel title={t('task.records')}>
          {records.length === 0 ? <EmptyState>{t('records.empty')}</EmptyState> : (
            <ul className="plain-list">
              {records.map((r) => (
                <li key={r.id} className="record">
                  <p className="muted small">{memberName(r.author_id)} · {fmt.dateTime(r.created_at)}</p>
                  <p className="record-note">{r.note}</p>
                  {r.photo_id && (
                    <a href={`/api/photos/${r.photo_id}`} target="_blank" rel="noreferrer">
                      <img className="record-photo" src={`/api/photos/${r.photo_id}`} alt={t('records.photoAlt', { name: memberName(r.author_id) })} loading="lazy" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t('task.history')}>
          <ol className="timeline">
            {history.map((h) => (
              <li key={h.id}>
                <span className="timeline-time">{fmt.full(h.at)}</span>
                <span>{historyText(h)}</span>
                {h.reason && h.type !== 'cancelled' && <span className="quote small">{t('common.quote', { text: h.reason! })}</span>}
              </li>
            ))}
          </ol>
        </Panel>

        <div className="stack">
          {task.status === 'pending_confirmation' && can('assign') && (
            <Button onClick={() => navigate(`/tasks/${task.id}/assign`)}>{t('task.reassignOther')}</Button>
          )}
          {can('unassign') && <Button disabled={busy} onClick={() => act('unassign', t('toast.published'))}>{t('task.toBoard')}</Button>}
          {can('complete') && <Button disabled={busy} onClick={() => act('complete', t('toast.completed'))}><Icon name="check" /> {t('task.complete')}</Button>}
          {canEdit && <Button onClick={() => navigate(`/tasks/${task.id}/edit`)}><Icon name="edit" size={20} /> {t('common.edit')}</Button>}
          {can('cancel') && !confirmCancel && <Button variant="danger" onClick={() => setConfirmCancel(true)}>{t('task.cancelTask')}</Button>}
          {confirmCancel && (
            <div className="confirm-box" role="alertdialog" aria-labelledby="cancel-task-q">
              <p id="cancel-task-q">{t('task.cancelConfirm')}</p>
              <div className="btn-pair">
                <Button onClick={() => setConfirmCancel(false)}>{t('common.no')}</Button>
                <Button variant="danger" disabled={busy} onClick={() => act('cancel', t('toast.cancelled'))}>{t('common.yesCancel')}</Button>
              </div>
            </div>
          )}
        </div>
      </div>
      {primary && <ActionBar>{primary}</ActionBar>}
    </div>
  );
}
