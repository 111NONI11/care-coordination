import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { useI18n } from './i18n';
import { useStore } from './store';
import { Shell } from './components/Shell';
import { Button, NotFound } from './components/ui';
import { LoginScreen } from './screens/LoginScreen';
import { OverviewScreen } from './screens/OverviewScreen';
import { CalendarScreen } from './screens/CalendarScreen';
import { EventDetailScreen, EventFormScreen } from './screens/EventScreens';
import { TaskFormScreen } from './screens/TaskFormScreen';
import { AssignScreen } from './screens/AssignScreen';
import { TasksScreen } from './screens/TasksScreen';
import { TaskDetailScreen } from './screens/TaskDetailScreen';
import { DeclineScreen } from './screens/DeclineScreen';
import { RecordFormScreen, RecordsScreen } from './screens/RecordScreens';
import { NotificationsScreen } from './screens/NotificationsScreen';
import { SettingsScreen } from './screens/SettingsScreen';

/** Keeps the page title in the current language and moves focus to new screens for screen readers. */
function useRouteEffects() {
  const { t } = useI18n();
  const location = useLocation();
  useEffect(() => {
    document.title = t('app.name');
    window.scrollTo(0, 0);
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [location.pathname, t]);
}

export function App() {
  const { status, refresh } = useStore();
  const { t } = useI18n();
  useRouteEffects();

  if (status === 'loading') return <div className="center-msg" role="status">{t('common.loading')}</div>;
  if (status === 'error') {
    return (
      <div className="center-msg" role="alert">
        <p>{t('errors.network')}</p>
        <Button onClick={refresh}>{t('common.retry')}</Button>
      </div>
    );
  }
  if (status === 'anonymous') return <LoginScreen />;

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<OverviewScreen />} />
        <Route path="calendar" element={<CalendarScreen />} />
        <Route path="events/new" element={<EventFormScreen />} />
        <Route path="events/:id" element={<EventDetailScreen />} />
        <Route path="events/:id/edit" element={<EventFormScreen />} />
        <Route path="tasks" element={<TasksScreen />} />
        <Route path="tasks/new" element={<TaskFormScreen />} />
        <Route path="tasks/:id" element={<TaskDetailScreen />} />
        <Route path="tasks/:id/edit" element={<TaskFormScreen />} />
        <Route path="tasks/:id/assign" element={<AssignScreen />} />
        <Route path="tasks/:id/decline" element={<DeclineScreen />} />
        <Route path="tasks/:id/records/new" element={<RecordFormScreen />} />
        <Route path="records" element={<RecordsScreen />} />
        <Route path="notifications" element={<NotificationsScreen />} />
        <Route path="settings" element={<SettingsScreen />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
