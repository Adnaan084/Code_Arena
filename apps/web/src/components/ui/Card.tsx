import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ className = '', children, ...rest }: CardProps) {
  return (
    <div
      {...rest}
      className={`rounded-xl border border-ink-700 bg-ink-900/80 shadow-sm backdrop-blur-sm ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`flex items-center justify-between gap-3 border-b border-ink-700/70 px-4 py-3 ${className}`}>{children}</div>;
}

export function CardBody({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`px-4 py-3 ${className}`}>{children}</div>;
}