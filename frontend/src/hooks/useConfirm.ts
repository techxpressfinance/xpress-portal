import { useContext } from 'react';
import { ConfirmContext } from '../contexts/confirm-context';

/**
 * Promise-based replacement for the native `confirm()`.
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: 'Delete this task?', variant: 'danger' }))) return;
 *
 * Native `confirm()` blocks the main thread, cannot be branded, and is
 * suppressed outright in some embedded contexts.
 */
export function useConfirm() {
  return useContext(ConfirmContext);
}
