import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
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

const colors = {
  success: 'bg-foreground text-background',
  error: 'bg-foreground text-background',
  info: 'bg-foreground text-background',
};

const iconColors = {
  success: 'text-success',
  error: 'text-destructive',
  info: 'text-primary',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Above every modal: full-screen portals (arrears detail panel, record
          modal, global search) mount onto document.body after this container,
          so anything below their z-index gets painted under their backdrop and
          the confirmation is never seen. */}
      <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-3 rounded-2xl px-5 py-3 text-[14px] font-medium shadow-lg backdrop-blur-xl ${colors[t.type]}`}
            style={{ animation: 'toast-in 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
          >
            <span className={iconColors[t.type]}>{icons[t.type]}</span>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
