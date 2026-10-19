import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useAppState, useSelectors, useStore } from '../store';
import { Button, EmptyState, ScreenHeader, errorMessage } from '../components/ui';
import { useToast } from '../components/Toast';
import { checkAction } from '../../shared/domain.js';
import type { AppNotification } from '../types';

/** S7 – the helper's notifications. An assignment request has Decline / Accept buttons. */
export function NotificationsScreen() {
  const { t } = useI18n();
  const fmt = useFormat();
  const s = useAppState();
  const { memberName, taskById, unread } = useSelectors();
  const { mutate } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<number | null>(null);
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  async function accept(n: AppNotification) {
    const task = taskById.get(n.task_id!);
    if (!task) return;
    setBusy(n.id);
    try {
      await mutate('post', `/api/tasks/${task.id}/actions`, { action: 'accept', version: task.version });
      toast({ title: t('toast.accepted') });
      navigate(`/tasks/${task.id}`); // S7 → S8
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function markAllRead() {
    try {
      await mutate('post', '/api/notifications/read', {});
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: 'error' });
    }
  }

  return (
    <div className="screen">
      <ScreenHeader
        title={t('notif.title')}
        back="/"
        actions={unread.length > 0 ? <button type="button" className="link-sm" onClick={markAllRead}>{t('notif.markAllRead')}</button> : undefined}
      />
      <div className="screen-body">
        <p className="phone-clock" aria-hidden="true">{fmt.time(clock)}</p>
        {s.notifications.length === 0 && <EmptyState>{t('notif.empty')}</EmptyState>}
        <ul className="plain-list">
          {s.notifications.map((n) => {
            const task = n.task_id ? taskById.get(n.task_id) : undefined;
            const actionable = n.type === 'assigned' && task && !checkAction('accept', task, { id: s.me.id, role: s.me.role });
            return (
              <li key={n.id} className={`notif ${n.read_at ? '' : 'notif-unread'}`}>
                <p className="notif-app">{t('notif.appTitle', { name: s.recipient.name })} · <span className="muted">{fmt.dateTime(n.created_at)}</span></p>
                <p className="notif-text">{t(`notif.${n.type}`, { name: memberName(n.actor_id) })}</p>
                {task && (
                  <Link to={`/tasks/${task.id}`} className="notif-task">
                    {task.title}{task.due_at && <> · {fmt.dayShort(task.due_at)} {fmt.time(task.due_at)}</>}
                  </Link>
                )}
                {n.reason && <p className="quote">{t('common.quote', { text: n.reason! })}</p>}
                {actionable && (
                  <div className="btn-pair">
                    <Button onClick={() => navigate(`/tasks/${task!.id}/decline`)}>{t('task.decline')}</Button>
                    <Button variant="primary" disabled={busy === n.id} onClick={() => accept(n)}>{t('task.accept')}</Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
