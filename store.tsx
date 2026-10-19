import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import type { AppState, Member, Task } from './types';
import { NEEDS_HELPER_STATUSES } from '../shared/domain.js';

type Status = 'loading' | 'anonymous' | 'ready' | 'error';

interface StoreValue {
  status: Status;
  state: AppState | null;
  demo: boolean;
  seedLocales: string[];
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Performs a mutating call; the server responds with fresh state. */
  mutate: <T extends object = object>(method: 'post' | 'patch' | 'del', path: string, body?: unknown) => Promise<T>;
}

const StoreContext = createContext<StoreValue | null>(null);
const POLL_MS = 5000;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [state, setState] = useState<AppState | null>(null);
  const [config, setConfig] = useState({ demo: false, seedLocales: [] as string[] });
  const revision = useRef(0);

  const apply = useCallback((s: AppState) => {
    revision.current = s.revision;
    setState(s);
    setStatus('ready');
  }, []);

  const handleAuthError = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) {
      setState(null);
      setStatus('anonymous');
      return true;
    }
    return false;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ state: AppState }>('/api/state');
      apply(r.state);
    } catch (e) {
      if (!handleAuthError(e)) setStatus((s) => (s === 'loading' ? 'error' : s));
    }
  }, [apply, handleAuthError]);

  useEffect(() => {
    api.get<{ demo: boolean; seedLocales: string[] }>('/api/config').then(setConfig).catch(() => {});
    refresh();
  }, [refresh]);

  // Other family members change data on their own devices: poll a cheap revision counter.
  useEffect(() => {
    if (status !== 'ready') return;
    let stopped = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const r = await api.get<{ revision: number }>('/api/revision');
        if (!stopped && r.revision !== revision.current) await refresh();
      } catch (e) {
        handleAuthError(e);
      }
    };
    const id = window.setInterval(tick, POLL_MS);
    const onFocus = () => tick();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      stopped = true;
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [status, refresh, handleAuthError]);

  const login = useCallback(async (username: string, password: string) => {
    await api.post('/api/auth/login', { username, password });
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setState(null);
      setStatus('anonymous');
    }
  }, []);

  const mutate = useCallback(async <T extends object>(method: 'post' | 'patch' | 'del', path: string, body?: unknown) => {
    try {
      const r = await (method === 'del' ? api.del<any>(path) : api[method]<any>(path, body ?? {}));
      if (r?.state) apply(r.state);
      return r as T;
    } catch (e) {
      handleAuthError(e);
      // A conflict means someone else changed the data: reload so the UI shows the truth.
      if (e instanceof ApiError && e.status === 409) refresh();
      throw e;
    }
  }, [apply, handleAuthError, refresh]);

  const value = useMemo(
    () => ({ status, state, demo: config.demo, seedLocales: config.seedLocales, login, logout, refresh, mutate }),
    [status, state, config, login, logout, refresh, mutate],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore outside provider');
  return ctx;
}

/** The loaded state; only call inside screens rendered after login. */
export function useAppState() {
  const { state } = useStore();
  if (!state) throw new Error('state not loaded');
  return state;
}

export function useSelectors() {
  const s = useAppState();
  return useMemo(() => {
    const memberById = new Map<number, Member>(s.members.map((m) => [m.id, m]));
    const taskById = new Map<number, Task>(s.tasks.map((t) => [t.id, t]));
    const eventById = new Map(s.events.map((e) => [e.id, e]));
    return {
      memberById,
      taskById,
      eventById,
      memberName: (id: number | null | undefined) => (id ? memberById.get(id)?.name ?? '—' : '—'),
      needsHelper: s.tasks.filter((t) => NEEDS_HELPER_STATUSES.includes(t.status)),
      unread: s.notifications.filter((n) => !n.read_at),
      isCoordinatorFor: (t: Task) => s.me.role === 'coordinator' || t.created_by === s.me.id,
    };
  }, [s]);
}
