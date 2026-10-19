import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useAppState, useSelectors, useStore } from '../store';
import { ActionBar, Button, EmptyState, ScreenHeader, StatusChip, errorMessage } from '../components/ui';
import { TopActions } from '../components/Shell';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { checkAction, isExpired, TERMINAL_STATUSES } from '../../shared/domain.js';
import type { Task } from '../types';

const TABS = ['board', 'mine', 'all'] as const;
type Tab = (typeof TABS)[number];

/** S5b – task board ("Nástenka úloh") plus my tasks and all tasks. */
export function TasksScreen() {
  const { t } = useI18n();
  const fmt = useFormat();
  const s = useAppState();
  const { needsHelper, memberName } = useSelectors();
  const { mutate } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'board';
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showDone, setShowDone] = useState(false);

  async function claim(task: Task) {
    setBusyId(task.id);
    try {
      await mutate('post', `/api/tasks/${task.id}/actions`, { action: 'claim', version: task.version });
      toast({ title: t('toast.claimed', { title: task.title }) });
      navigate(`/tasks/${task.id}`);
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  const mine = s.tasks.filter((x) => x.assignee_id === s.me.id && !TERMINAL_STATUSES.includes(x.status));
  const all = s.tasks.filter((x) => showDone || !TERMINAL_STATUSES.includes(x.status));

  const card = (x: Task, withClaim: boolean) => {
    const expired = isExpired(x);
    const canClaim = withClaim && !checkAction('claim', x, { id: s.me.id, role: s.me.role });
    return (
      <li key={x.id} className="task-card">
        <Link to={`/tasks/${x.id}`} className="task-card-link">
          <strong className="task-card-title">{x.title}</strong>
          {x.due_at && (
            <span className={`small ${expired ? 'text-danger' : withClaim ? 'text-danger' : 'muted'}`}>
              {fmt.dateTime(x.due_at)} · {expired ? t('board.overdue') : fmt.relative(x.due_at)}
            </span>
          )}
          {!withClaim && x.assignee_id && <span className="small muted">{t('task.handledBy', { name: memberName(x.assignee_id) })}</span>}
          <StatusChip status={x.status} expired={expired} />
        </Link>
        {canClaim && (
          <Button variant="secondary" className="claim-btn" disabled={busyId === x.id} onClick={() => claim(x)}>
            {t('board.claim')}
          </Button>
        )}
      </li>
    );
  };

  return (
    <div className="screen">
      <ScreenHeader title={t('board.title')} actions={<TopActions />} />
      <div className="screen-body">
        <div className="tabs" role="tablist" aria-label={t('board.title')}>
          {TABS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              id={`tab-${k}`}
              aria-selected={tab === k}
              aria-controls={`panel-${k}`}
              className={`tab ${tab === k ? 'tab-active' : ''}`}
              onClick={() => setParams({ tab: k }, { replace: true })}
            >
              {t(`board.tab_${k}`)}
              {k === 'board' && needsHelper.length > 0 && <span className="badge">{needsHelper.length}</span>}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'board' && (
            <>
              {needsHelper.length === 0 ? <EmptyState>{t('board.empty')}</EmptyState> : <ul className="plain-list">{needsHelper.map((x) => card(x, true))}</ul>}
              <p className="muted small">{t('board.everyoneNotified')}</p>
            </>
          )}
          {tab === 'mine' && (mine.length === 0 ? <EmptyState>{t('overview.noMyTasks')}</EmptyState> : <ul className="plain-list">{mine.map((x) => card(x, false))}</ul>)}
          {tab === 'all' && (
            <>
              <label className="inline-toggle">
                <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> {t('board.showDone')}
              </label>
              {all.length === 0 ? <EmptyState>{t('board.noTasks')}</EmptyState> : <ul className="plain-list">{all.map((x) => card(x, false))}</ul>}
            </>
          )}
        </div>
      </div>
      <ActionBar>
        <Button variant="primary" block onClick={() => navigate('/tasks/new')}>
          <Icon name="plus" /> {t('task.newTitle')}
        </Button>
      </ActionBar>
    </div>
  );
}
