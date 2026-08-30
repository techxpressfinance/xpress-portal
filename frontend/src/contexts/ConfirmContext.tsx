import { useCallback, useRef, useState, type ReactNode } from 'react';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { ConfirmContext, type ConfirmFn, type ConfirmOptions } from './confirm-context';

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={options !== null}
        title={options?.title ?? ''}
        message={options?.message}
        confirmText={options?.confirmText ?? 'Confirm'}
        cancelText={options?.cancelText ?? 'Cancel'}
        variant={options?.variant ?? 'primary'}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </ConfirmContext.Provider>
  );
}
