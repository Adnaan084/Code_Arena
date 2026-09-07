import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { useToastStore } from '../../stores/toasts';

const ICONS = {
  info: <Info className="size-4 text-info" />,
  success: <CheckCircle2 className="size-4 text-positive" />,
  error: <XCircle className="size-4 text-negative" />,
};

const TONE_BORDER = {
  info: 'border-sky-500/30',
  success: 'border-emerald-500/30',
  error: 'border-rose-500/30',
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-3 pb-4 sm:items-end sm:pr-5">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border bg-ink-900/95 px-3.5 py-3 shadow-xl backdrop-blur ${TONE_BORDER[t.kind]}`}
        >
          <div className="mt-0.5 shrink-0">{ICONS[t.kind]}</div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-fg">{t.title}</div>
            {t.body && <div className="mt-0.5 text-xs text-fg-muted">{t.body}</div>}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
            className="shrink-0 rounded p-0.5 text-fg-faint hover:text-fg cursor-pointer"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}