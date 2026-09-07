import type { ReactNode } from 'react';

export function Spinner({ label = 'Loading…', className = '' }: { label?: string; className?: string }) {
  return (
    <div role="status" className={`flex items-center justify-center gap-3 px-6 py-10 text-fg-muted ${className}`}>
      <span aria-hidden className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className = '',
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 px-6 py-12 text-center ${className}`}>
      {icon && <div className="text-fg-faint">{icon}</div>}
      <div className="text-sm font-semibold text-fg">{title}</div>
      {body && <div className="max-w-sm text-sm text-fg-muted">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}