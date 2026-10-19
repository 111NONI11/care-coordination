import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useFormat, localDateKey } from '../format';
import { useAppState, useSelectors, useStore } from '../store';
import { Checkbox, EmptyState, Panel, ScreenHeader, StatusChip, errorMessage, Button } from '../components/ui';
import { TopActions } from '../components/Shell';
import { useToast } from '../components/Toast';
import { isExpired } from '../../shared/domain.js';
import { Icon } from '../components/Icon';

/** S1 – overview of the cared-for person: today's medicines, upcoming events, tasks without a helper. */
export function OverviewScreen() {
  const { t } = useI18n();
  const fmt = useFormat();
  const s = useAppState();
  const { needsHelper, memberName } = useSelectors();
  const { mutate } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const today = localDateKey(new Date());
  const now = Date.now();

  const upcoming = s.events.filter((e) => !e.cancelled && new Date(e.starts_at).getTime() > now - 3 * 3600_000).slice(0, 4);
  const mine = s.tasks.filter((x) => x.assignee_id === s.me.id && (x.status === 'pending_confirmation' || x.status === 'accepted'));

  async function toggleMed(id: number, checked: boolean) {
    try {
      await mutate('post', `/api/medications/${id}/check`, { date: today, checked });
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: 'error' });
    }
  }

  return (
    <div className="screen">
      <ScreenHeader title={t('overview.title', { name: s.recipient.name })} actions={<TopActions />} />
      <div className="screen-body overview-grid">
        <Panel title={t('overview.medsToday')} className="area-meds">
          {s.medications.length === 0 ? (
            <EmptyState>{t('overview.noMeds')}</EmptyState>
          ) : (
            <ul className="plain-list">
              {s.medications.map((m) => {
                const check = s.medicationChecks.find((c) => c.medication_id === m.id && c.date === today);
                return (
                  <li key={m.id}>
                    <Checkbox
                      checked={!!check}
                      onChange={(v) => toggleMed(m.id, v)}
                      label={
                        <>
                          {fmt.clock(m.time)} {m.label}
                          {check && <span className="muted small"> · {t('overview.givenBy', { name: memberName(check.checked_by) })}</span>}
                        </>
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title={t('overview.events')} className="area-events" action={<Link className="link-sm" to="/calendar">{t('overview.openCalendar')}</Link>}>
          {upcoming.length === 0 ? (
            <EmptyState>{t('overview.noEvents')}</EmptyState>
          ) : (
            <ul className="plain-list">
              {upcoming.map((e) => (
                <li key={e.id}>
                  <Link to={`/events/${e.id}`} className="row-card">
                    <span>{fmt.dayShort(e.starts_at)} {fmt.time(e.starts_at)} · {e.title}</span>
                    {e.needs_transport && <Icon name="car" size={18} />}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t('overview.withoutHelper')} badge={needsHelper.length} className="area-unassigned">
          {needsHelper.length === 0 ? (
            <EmptyState>{t('overview.allCovered')}</EmptyState>
          ) : (
            <ul className="plain-list">
              {needsHelper.map((x) => (
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

        <Panel title={t('overview.myTasks')} className="area-mine">
          {mine.length === 0 ? (
            <EmptyState>{t('overview.noMyTasks')}</EmptyState>
          ) : (
            <ul className="plain-list">
              {mine.map((x) => (
                <li key={x.id}>
                  <Link to={`/tasks/${x.id}`} className="row-card">
                    <span>
                      {x.title}
                      {x.due_at && <span className="muted small block">{fmt.dateTime(x.due_at)}</span>}
                    </span>
                    <StatusChip status={x.status} expired={isExpired(x)} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <div className="area-cta">
          <Button variant="primary" block onClick={() => navigate('/events/new')}>
            <Icon name="plus" /> {t('calendar.addEvent')}
          </Button>
        </div>
      </div>
    </div>
  );
}
