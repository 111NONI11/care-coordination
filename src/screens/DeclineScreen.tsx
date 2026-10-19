import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useAppState, useSelectors, useStore } from '../store';
import { ActionBar, Button, NotFound, ScreenHeader, TextArea, errorMessage } from '../components/ui';
import { useToast } from '../components/Toast';
import { checkAction, LIMITS } from '../../shared/domain.js';

/** S9 – decline a task with an optional reason; the coordinator is notified (→ S10). */
export function DeclineScreen() {
  const { t } = useI18n();
  const fmt = useFormat();
  const s = useAppState();
  const { memberName } = useSelectors();
  const { mutate } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const { id } = useParams();
  const task = s.tasks.find((x) => x.id === Number(id));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!task) return <NotFound />;
  const blocked = checkAction('decline', task, { id: s.me.id, role: s.me.role });
  const notifyName = memberName(task.assigned_by ?? task.created_by);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await mutate('post', `/api/tasks/${task!.id}/actions`, { action: 'decline', reason, version: task!.version });
      toast({ title: t('toast.declined'), body: t('decline.willBeNotified', { name: notifyName }) });
      navigate(`/tasks/${task!.id}`, { replace: true });
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <ScreenHeader title={t('decline.title')} back />
      <div className="screen-body form-body">
        <p className="detail-strong">{task.title}{task.due_at && ` · ${fmt.dayShort(task.due_at)}`}</p>
        {blocked ? (
          <p className="form-error" role="alert">{t(`errors.${blocked}`)}</p>
        ) : (
          <>
            <TextArea label={t('decline.reason')} hint={t('decline.reasonHint')} rows={4} maxLength={LIMITS.reason} value={reason} onChange={(e) => setReason(e.target.value)} />
            <p className="muted small">{t('decline.willBeNotified', { name: notifyName })}</p>
          </>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      {!blocked && (
        <ActionBar>
          <Button variant="primary" block disabled={busy} onClick={send}>{t('decline.send')}</Button>
        </ActionBar>
      )}
    </div>
  );
}
