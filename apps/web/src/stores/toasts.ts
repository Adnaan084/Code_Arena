import { create } from 'zustand';

/**
 * Lightweight global toasts. Every async action surfaces feedback through here
 * so the whole app has one consistent error/loading vocabulary. Toasts
 * auto-dismiss after `duration`; loading is shown inline on buttons instead.
 */
export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  body?: string;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'> & { id?: string }) => void;
  dismiss: (id: string) => void;
}

let toastSeq = 0;

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],

  push: (t) => {
    const id = t.id ?? `toast-${++toastSeq}`;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    window.setTimeout(() => {
      if (get().toasts.some((x) => x.id === id)) {
        set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
      }
    }, t.kind === 'error' ? 6000 : 3500);
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

/** Convenience helpers used across pages. */
export const toast = {
  push: (t: Omit<Toast, 'id'> & { id?: string }) => useToastStore.getState().push(t),
  info: (title: string, body?: string) => toast.push({ kind: 'info', title, body }),
  success: (title: string, body?: string) => toast.push({ kind: 'success', title, body }),
  error: (title: string, body?: string) => toast.push({ kind: 'error', title, body }),
};