import { CheckCircle2, TriangleAlert, Wifi, WifiOff } from 'lucide-react';
import { useConnectionStore } from '../../stores/connection';

/** Small status dot for headers: what users should see during a drop/reconnect. */
export function ConnectionBadge({ className = '' }: { className?: string }) {
  const status = useConnectionStore((s) => s.status);
  const lastError = useConnectionStore((s) => s.lastError);

  const cfg =
    status === 'connected'
      ? { icon: <CheckCircle2 className="size-3.5 text-positive" />, label: 'Connected', tone: 'text-positive' }
      : status === 'reconnecting'
        ? { icon: <Wifi className="size-3.5 animate-pulse text-warn" />, label: lastError?.message ?? 'Connection lost — reconnecting…', tone: 'text-warn' }
        : status === 'connecting'
          ? { icon: <Wifi className="size-3.5 text-info" />, label: 'Connecting…', tone: 'text-info' }
          : { icon: <WifiOff className="size-3.5 text-fg-faint" />, label: 'Offline', tone: 'text-fg-faint' };

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${cfg.tone} ${className}`} title={status}>
      {cfg.icon}
      <span className="max-w-56 truncate">{cfg.label}</span>
      {lastError && status !== 'connected' && <TriangleAlert className="size-3 text-warn" aria-hidden />}
    </span>
  );
}