import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useFormat, firstDayOfWeek, localDateKey, sameDay } from '../format';
import { useAppState } from '../store';
import { ActionBar, Button, EmptyState, ScreenHeader, StatusChip } from '../components/ui';
import { Icon } from '../components/Icon';
import { TopActions } from '../components/Shell';
import { isExpired } from '../../shared/domain.js';

function startOfWeek(d: Date, first: number) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const jsFirst = first % 7; // Intl: 7 = Sunday → JS 0
  const diff = (x.getDay() - jsFirst + 7) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}

/** S2 – week strip with the selected day's events and task deadlines. */
export function CalendarScreen() {
  const { t, locale } = useI18n();
  const fmt = useFormat();
  const s = useAppState();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const selected = params.get('d') ? new Date(`${params.get('d')}T12:00:00`) : new Date();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(selected, firstDayOfWeek(locale)));

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i)), [weekStart]);
  const select = (d: Date) => setParams({ d: localDateKey(d) }, { replace: true });
  const shiftWeek = (n: number) => {
    const w = new Date(weekStart);
    w.setDate(w.getDate() + n * 7);
    setWeekStart(w);
    select(w);
  };

  const hasItems = (d: Date) =>
    s.events.some((e) => !e.cancelled && sameDay(new Date(e.starts_at), d)) ||
    s.tasks.some((x) => x.due_at && x.status !== 'cancelled' && sameDay(new Date(x.due_at), d));

  const events = s.events.filter((e) => sameDay(new Date(e.starts_at), selected));
  const tasks = s.tasks.filter((x) => x.due_at && sameDay(new Date(x.due_at), selected));
  const today = new Date();

  return (
    <div className="screen">
      <ScreenHeader title={t('calendar.title')} actions={<TopActions />} />
      <div className="screen-body">
        <div className="week-nav">
          <button type="button" className="icon-btn" onClick={() => shiftWeek(-1)} aria-label={t('calendar.prevWeek')}>
            <Icon name="back" />
          </button>
          <span className="week-label">{fmt.monthYear(days[3])}</span>
          <button type="button" className="icon-btn" onClick={() => shiftWeek(1)} aria-label={t('calendar.nextWeek')}>
            <Icon name="forward" />
          </button>
        </div>
        <div className="week-strip" role="group" aria-label={t('calendar.week')}>
          {days.map((d) => {
            const isSel = sameDay(d, selected);
            return (
              <button
                key={d.toISOString()}
                type="button"
                className={`day ${isSel ? 'day-selected' : ''} ${sameDay(d, today) ? 'day-today' : ''}`}
                aria-pressed={isSel}
                aria-label={fmt.dayLong(d)}
                onClick={() => select(d)}
              >
                <span className="day-name">{fmt.narrowWeekday(d)}</span>
                <span className="day-num">{d.getDate().toLocaleString(locale)}</span>
                {hasItems(d) && <span className="day-dot" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
        <button type="button" className="link-sm today-link" onClick={() => { setWeekStart(startOfWeek(today, firstDayOfWeek(locale))); select(today); }}>
          {t('calendar.today')}
        </button>

        <h2 className="section-title">{fmt.dayLong(selected)}</h2>
        {events.length === 0 && tasks.length === 0 && <EmptyState>{t('calendar.empty')}</EmptyState>}
        <ul className="plain-list">
          {events.map((e) => (
            <li key={`e${e.id}`}>
              <Link to={`/events/${e.id}`} className={`row-card ${e.cancelled ? 'is-cancelled' : ''}`}>
                <span>
                  <strong>{fmt.time(e.starts_at)}</strong> {e.title}
                  {e.location && <span className="muted small block">{e.location}</span>}
                </span>
                {e.cancelled ? <span className="chip chip-cancelled">{t('event.cancelled')}</span> : e.needs_transport && <Icon name="car" size={18} />}
              </Link>
            </li>
          ))}
          {tasks.map((x) => (
            <li key={`t${x.id}`}>
              <Link to={`/tasks/${x.id}`} className="row-card row-task">
                <span>
                  <span className="muted small block">{t('calendar.taskDeadline', { time: fmt.time(x.due_at!) })}</span>
                  {x.title}
                </span>
                <StatusChip status={x.status} expired={isExpired(x)} />
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <ActionBar>
        <Button variant="primary" block onClick={() => navigate(`/events/new?d=${localDateKey(selected)}`)}>
          <Icon name="plus" /> {t('calendar.addEvent')}
        </Button>
      </ActionBar>
    </div>
  );
}
