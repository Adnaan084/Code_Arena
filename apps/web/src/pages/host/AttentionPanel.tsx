/**
 * H3 — Attention Panel.
 *
 * Compact section in the Host Console that surfaces situations requiring
 * human attention. Categories:
 *   1. Partially connected teams
 *   2. Disqualified teams
 *   3. OPEN trades
 *
 * Items are derived from authoritative state (no arbitrary thresholds).
 */
import { AlertTriangle, WifiOff, UserX, ArrowRightLeft } from 'lucide-react';
import { Card, CardBody, Badge } from '../../components/ui';
import { useAttentionItems, type AttentionReason } from '../../hooks/useAttentionItems';

const REASON_META: Record<AttentionReason, { icon: typeof AlertTriangle; label: string; tone: 'warn' | 'negative' | 'muted' }> = {
  PARTIAL_CONNECTION: { icon: WifiOff, label: 'PARTIAL CONNECTION', tone: 'warn' },
  DISQUALIFIED: { icon: UserX, label: 'DISQUALIFIED', tone: 'negative' },
  OPEN_TRADE: { icon: ArrowRightLeft, label: 'OPEN TRADE', tone: 'muted' },
};

export function AttentionPanel() {
  const items = useAttentionItems();

  if (items.length === 0) return null;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-widest text-warn">
          <AlertTriangle className="size-4" aria-hidden /> ATTENTION
        </h3>
        <span className="text-[11px] text-fg-muted">{items.length} item{items.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="space-y-2">
        {items.map((item) => {
          const meta = REASON_META[item.reason];
          const Icon = meta.icon;
          return (
            <Card key={item.id}>
              <CardBody className="p-3">
                <div className="flex items-center gap-3">
                  <Icon className="size-4 shrink-0 text-fg-muted" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      {item.teamName && (
                        <span className="truncate text-sm font-medium text-fg">{item.teamName}</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-fg-muted">{item.detail}</div>
                  </div>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
