import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { CheckIcon, InformationCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ToastContextType {
  toast: (message: string, type?: Toast['type']) => void;
}

const ToastContext = createContext<ToastContextType>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

// Errors stay up longer: they are read, not glanced at, and often carry a
// server message. All three can be dismissed early with the close button.
const DURATION_MS: Record<Toast['type'], number> = {
  success: 4000,
  info: 4000,
  error: 8000,
};

const icons = {
  success: (
    <CheckIcon className="h-4 w-4" strokeWidth={2} />
  ),
  error: (
    <XMarkIcon className="h-4 w-4" strokeWidth={2} />
  ),
  info: (
    <InformationCircleIcon className="h-4 w-4" strokeWidth={2} />
  ),
};

// One dark surface, but a coloured edge per type so success and error are
// told apart at a glance and not only by the icon.
const colors = {
  success: 'bg-foreground text-background border-l-4 border-success',
  error: 'bg-foreground text-background border-l-4 border-destructive',
  info: 'bg-foreground text-background border-l-4 border-primary',
};

const iconColors = {
  success: 'text-success',
  error: 'text-destructive',
  info: 'text-primary',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Monotonic ids: Date.now() collided when two toasts fired in the same
  // millisecond, producing duplicate keys and a toast that never rendered.
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = ++nextId.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    timers.current.set(id, setTimeout(() => dismiss(id), DURATION_MS[type]));
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Above every modal: full-screen portals (arrears detail panel, record
          modal, global search) mount onto document.body after this container,
          so anything below their z-index gets painted under their backdrop and
          the confirmation is never seen. */}
      <div
        className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.type === 'error' ? 'alert' : 'status'}
            aria-live={t.type === 'error' ? 'assertive' : 'polite'}
            className={`flex items-center gap-3 rounded-2xl pl-5 pr-3 py-3 text-[14px] font-medium shadow-lg backdrop-blur-xl ${colors[t.type]}`}
            style={{ animation: 'toast-in 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
          >
            <span className={iconColors[t.type]}>{icons[t.type]}</span>
            <span>{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="ml-1 rounded-full p-1 opacity-60 hover:opacity-100 focus-visible:opacity-100 transition-opacity"
            >
              <XMarkIcon className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
