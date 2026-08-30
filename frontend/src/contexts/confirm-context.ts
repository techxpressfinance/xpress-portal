import { createContext, type ReactNode } from 'react';

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'primary' | 'danger' | 'success';
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<ConfirmFn>(async () => false);
