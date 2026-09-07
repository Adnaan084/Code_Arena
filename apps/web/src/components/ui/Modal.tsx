import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[88vh] overflow-auto rounded-t-2xl sm:rounded-xl border border-ink-600 bg-ink-900 shadow-2xl`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-ink-700 px-4 py-3">
          <h2 className="text-sm font-bold text-fg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-fg-muted hover:bg-ink-800 hover:text-fg cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-ink-700 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}