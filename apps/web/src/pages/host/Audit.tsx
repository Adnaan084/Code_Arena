import { ShieldAlert, Search, Filter } from 'lucide-react';
import { Card, CardBody, Badge, EmptyState, Tabs, TabList, Tab, TabPanels, TabPanel } from '../../components/ui';
import { useHostStore } from '../../stores/host';
import { useAuthStore } from '../../stores/auth';

/** Host audit log. */
export function HostAudit() {
  const audit = useHostStore((s) => s.audit);

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-fg-muted">AUDIT LOG ({audit.length})</h2>

      {audit.length === 0 ? (
        <EmptyState title="No audit entries" body="Host actions are recorded here." />
      ) : (
        <div className="space-y-2">
          {audit.map((entry, i) => (
            <Card key={i}>
              <CardBody className="p-3">
                <div className="grid grid-cols-[auto_1fr_auto_auto] gap-3 items-center">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="size-4 text-warn" />
                    <Badge tone="muted">{entry.actorType}</Badge>
                  </div>
                  <div className="text-sm font-medium text-fg">{entry.action}</div>
                  <div className="text-[10px] text-fg-muted">{entry.actorName ?? 'SYSTEM'}</div>
                  <div className="text-[10px] text-fg-muted font-mono">{new Date(entry.createdAt).toLocaleString()}</div>
                </div>
                {entry.detail != null && (
                  <div className="mt-2 text-[11px] text-fg-muted font-mono bg-ink-850 rounded p-2">
                    {JSON.stringify(entry.detail, null, 2)}
                  </div>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}