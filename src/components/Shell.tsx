import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { Icon } from './Icon';
import { LanguageSelect } from './ui';
import { useI18n } from '../i18n';
import { useAppState, useSelectors, useStore } from '../store';
import { useToast } from './Toast';

const NAV = [
  { to: '/', icon: 'home', key: 'nav.overview', end: true },
  { to: '/calendar', icon: 'calendar', key: 'nav.calendar' },
  { to: '/tasks', icon: 'tasks', key: 'nav.tasks' },
  { to: '/records', icon: 'records', key: 'nav.records' },
];

function NavItems({ badge }: { badge: number }) {
  const { t } = useI18n();
  return (
    <>
      {NAV.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} className="nav-item">
          <span className="nav-icon">
            <Icon name={n.icon} />
            {n.to === '/tasks' && badge > 0 && <span className="badge badge-dot">{badge}</span>}
          </span>
          <span className="nav-label">{t(n.key)}</span>
        </NavLink>
      ))}
    </>
  );
}

/** Bell + settings shortcuts shown in the top bar on phones/tablets and in the sidebar on desktop. */
export function TopActions() {
  const { t } = useI18n();
  const { unread } = useSelectors();
  return (
    <div className="top-actions">
      <NavLink to="/notifications" className="icon-btn" aria-label={`${t('nav.notifications')}${unread.length ? ` (${unread.length})` : ''}`}>
        <Icon name="bell" />
        {unread.length > 0 && <span className="badge badge-dot" aria-hidden="true">{unread.length}</span>}
      </NavLink>
      <NavLink to="/settings" className="icon-btn" aria-label={t('nav.settings')}>
        <Icon name="settings" />
      </NavLink>
    </div>
  );
}

/** Announces newly arrived notifications (e.g. "Jana assigned you a task") while the app is open. */
function useIncomingNotifications() {
  const s = useAppState();
  const { t } = useI18n();
  const toast = useToast();
  const { memberName, taskById } = useSelectors();
  const seen = useRef<number | null>(null);
  const location = useLocation();
  useEffect(() => {
    const maxId = s.notifications.reduce((m, n) => Math.max(m, n.id), 0);
    if (seen.current === null) {
      seen.current = maxId;
      return;
    }
    const fresh = s.notifications.filter((n) => n.id > (seen.current ?? 0) && !n.read_at);
    seen.current = Math.max(seen.current, maxId);
    if (location.pathname === '/notifications') return;
    for (const n of fresh.slice(0, 2)) {
      toast({
        title: t(`notif.${n.type}`, { name: memberName(n.actor_id) }),
        body: n.task_id ? taskById.get(n.task_id)?.title : undefined,
      });
    }
  }, [s.notifications]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function Shell() {
  const { t } = useI18n();
  const s = useAppState();
  const { needsHelper } = useSelectors();
  const { logout } = useStore();
  const navigate = useNavigate();
  useIncomingNotifications();
  return (
    <div className="shell">
      <a className="skip-link" href="#main">{t('common.skipToContent')}</a>
      <aside className="sidebar" aria-label={t('nav.main')}>
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">♥</span>
          <div>
            <div className="brand-name">{t('app.name')}</div>
            <div className="brand-sub">{t('app.caringFor', { name: s.recipient.name })}</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          <NavItems badge={needsHelper.length} />
          <NavLink to="/notifications" className="nav-item">
            <span className="nav-icon"><Icon name="bell" /></span>
            <span className="nav-label">{t('nav.notifications')}</span>
          </NavLink>
          <NavLink to="/settings" className="nav-item">
            <span className="nav-icon"><Icon name="settings" /></span>
            <span className="nav-label">{t('nav.settings')}</span>
          </NavLink>
        </nav>
        <div className="sidebar-foot">
          <LanguageSelect />
          <div className="sidebar-user">
            <Icon name="user" size={20} />
            <span>{s.me.name}</span>
            <button type="button" className="icon-btn" aria-label={t('settings.logout')} onClick={() => logout().then(() => navigate('/'))}>
              <Icon name="logout" size={20} />
            </button>
          </div>
        </div>
      </aside>
      <main id="main" className="main" tabIndex={-1}>
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label={t('nav.main')}>
        <NavItems badge={needsHelper.length} />
      </nav>
    </div>
  );
}
