import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

interface Toast { id: number; title: string; body?: string; tone?: 'default' | 'error' }
const ToastContext = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});

/** Dark toast at the bottom of the screen, as in S6 ("Úloha poslaná Petrovi."). Announced to screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const show = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++seq.current;
    setToasts((xs) => [...xs.slice(-2), { ...t, id }]);
    window.setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone === 'error' ? 'toast-error' : ''}`}>
            <strong>{t.title}</strong>
            {t.body && <span>{t.body}</span>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
