import { Users, UserCheck, UserX, Coins, Trophy, Scale, FileQuestion, Search, MoreHorizontal } from 'lucide-react';
import { Card, CardBody, Badge, EmptyState } from '../../components/ui';
import { useHostStore } from '../../stores/host';
import { formatCoins, timeAgo } from '../../lib/format';
import type { SeatPresence } from '@wcc/shared';

/** Compact per-seat presence line: "Seat 1 Ada ● · Seat 2 Bob ○ 42s ago". */
function SeatRow({ seat }: { seat: SeatPresence }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
      <span className="text-fg-faint">Seat {seat.seat}</span>
      <span className="font-medium text-fg">{seat.playerName}</span>
      {seat.connected ? (
        <span className="text-emerald-400" title="connected">●</span>
      ) : (
        <span className="text-fg-faint" title="disconnected">
          ○ {seat.lastSeenAt ? timeAgo(seat.lastSeenAt) : '—'}
        </span>
      )}
    </span>
  );
}

/** Host lobby: compact team rows with connection status. */
export function HostLobby() {
  const teams = useHostStore((s) => s.teams);
  const connected = useHostStore((s) => s.connectedCount);
  const presence = useHostStore((s) => s.presence);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-fg-muted">TEAMS ({teams.length})</h2>
      </div>

      {teams.length === 0 ? (
        <EmptyState title="No teams joined" body="Teams appear here when they join the game code." />
      ) : (
        <div className="space-y-2">
          {teams.map((t) => {
            const c = connected(t.id) ?? (t.online ? 1 : 0);
            const p = presence[t.id];
            const seats = p?.seats;
            return (
              <Card key={t.id}>
                <CardBody className="p-3">
                  <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-3 items-center">
                    <div className="flex items-center gap-2">
                      <span className="w-8 text-center font-mono font-bold text-fg-muted">{t.joinOrder}</span>
                      <span className="font-medium text-fg">{t.name}</span>
                    </div>
                    <div className="hidden sm:flex items-center gap-3 text-xs text-fg-muted">
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="size-3" />
                        <span>{c}/{seats?.length ?? 2}</span>
                      </span>
                      {seats && seats.length > 0 && (
                        <span className="hidden lg:inline-flex items-center gap-3">
                          {seats.map((seat) => <SeatRow key={seat.seat} seat={seat} />)}
                        </span>
                      )}
                    </div>
                    <div className="w-20 text-right font-mono text-warn">{formatCoins(t.coins)}</div>
                    <div className="w-16 text-right font-mono">{t.score}</div>
                    <div className="w-16 text-right font-mono">{t.solvedCount}</div>
                    <div className="flex items-center justify-end gap-1.5">
                      <Badge tone={t.status === 'ACTIVE' ? 'positive' : 'negative'}>{t.status}</Badge>
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}