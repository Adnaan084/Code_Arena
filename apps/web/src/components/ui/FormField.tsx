import type { InputHTMLAttributes, ReactNode } from 'react';

interface FormFieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}

export function FormField({ label, hint, error, children, htmlFor }: FormFieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-fg-faint">{hint}</p>}
      {error && <p className="text-xs text-negative" role="alert">{error}</p>}
    </div>
  );
}

export function TextInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={`h-11 w-full rounded-lg border border-ink-600 bg-ink-850 px-3.5 text-sm text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none ${className}`}
    />
  );
}