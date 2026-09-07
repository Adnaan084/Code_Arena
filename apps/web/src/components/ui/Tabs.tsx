import { createContext, useContext, useState } from 'react';

interface TabsContextValue {
  value: string;
  onValueChange: (v: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('Tabs compound components must be used within a Tabs root');
  return ctx;
}

/**
 * Generic over the value type so a caller can hand a typed state setter
 * (e.g. `useState<'ALL' | 'SOLVED'>`) directly to `onValueChange`. Tab clicks
 * are still strings internally; the union is resolved at the root boundary.
 */
export function Tabs<T extends string>({ value, onValueChange, children, className = '' }: { value: T; onValueChange: (v: T) => void; children: React.ReactNode; className?: string }) {
  return (
    <TabsContext.Provider value={{ value, onValueChange: onValueChange as (v: string) => void }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabList({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex gap-1 ${className}`}>{children}</div>;
}

export function Tab({ value, children, className = '', disabled }: { value: string; children: React.ReactNode; className?: string; disabled?: boolean }) {
  const { value: current, onValueChange } = useTabsContext();
  const isActive = current === value;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => !disabled && onValueChange(value)}
      className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors cursor-pointer ${
        isActive ? 'bg-accent/15 text-accent' : 'text-fg-muted hover:text-fg hover:bg-ink-800'
      } ${disabled ? 'opacity-40 pointer-events-none' : ''} ${className}`}
    >
      {children}
    </button>
  );
}

export function TabPanels({ value, children, className = '' }: { value: string; children: React.ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}

export function TabPanel({ value, children, className = '' }: { value: string; children: React.ReactNode; className?: string }) {
  const { value: current } = useTabsContext();
  if (current !== value) return null;
  return <div className={className}>{children}</div>;
}