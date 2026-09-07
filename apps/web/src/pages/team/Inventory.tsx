import { FileQuestion, CheckCircle2, XCircle, Scale, ArrowRight } from 'lucide-react';
import { Card, CardBody, Badge, Button, EmptyState, Tabs, TabList, Tab, TabPanels, TabPanel } from '../../components/ui';
import { useTeamStore } from '../../stores/team';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { toast } from '../../stores/toasts';
import { friendlyError } from '../../lib/errorMessages';
import { newIdempotencyKey } from '../../lib/api';
import { formatCoins, DIFFICULTY_TONE, QUESTION_TYPE_LABEL } from '../../lib/format';
import { useNavigate } from 'react-router-dom';

type Filter = 'ALL' | 'UNSOLVED' | 'SOLVED' | 'FAILED' | 'TRADABLE';

/** Inventory with tabs for each ownership status. */
export function TeamInventory() {
  const { teamToken } = useAuthStore();
  const inventory = useTeamStore((s) => s.inventory);
  const meta = useTeamStore((s) => s.meta);
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [trading, setTrading] = useState<string | null>(null);

  const filtered = inventory.filter((item) => {
    if (filter === 'ALL') return true;
    if (filter === 'TRADABLE') return item.status === 'UNSOLVED' && item.question.maxTrades > item.question.tradeCount;
    return item.status === filter;
  });

  const counts = {
    ALL: inventory.length,
    UNSOLVED: inventory.filter((i) => i.status === 'UNSOLVED').length,
    SOLVED: inventory.filter((i) => i.status === 'SOLVED').length,
    FAILED: inventory.filter((i) => i.status === 'FAILED').length,
    TRADABLE: inventory.filter((i) => i.status === 'UNSOLVED' && i.question.maxTrades > i.question.tradeCount).length,
  };

  const handleTrade = async (item: typeof inventory[0]) => {
    setTrading(item.ownershipId);
    try {
      await api.purchaseQuestion(teamToken ?? '', item.ownershipId, newIdempotencyKey());
    } catch {
      // handled by navigate
    }
  };

  const handleSolve = (ownershipId: string) => navigate(`/team/solve/${ownershipId}`);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-fg-muted">INVENTORY ({inventory.length})</h2>
        <Tabs value={filter} onValueChange={setFilter}>
          <TabList className="grid w-full grid-cols-5">
            {(['ALL', 'UNSOLVED', 'SOLVED', 'FAILED', 'TRADABLE'] as Filter[]).map((f) => (
              <Tab key={f} value={f} className="text-[11px]">
                {f} ({counts[f]})
              </Tab>
            ))}
          </TabList>
        </Tabs>
      </div>

      <TabPanels value={filter}>
        <TabPanel value="ALL">
          <InventoryList items={filtered} onSolve={handleSolve} onTrade={handleTrade} trading={trading} />
        </TabPanel>
        <TabPanel value="UNSOLVED">
          <InventoryList items={filtered} onSolve={handleSolve} onTrade={handleTrade} trading={trading} />
        </TabPanel>
        <TabPanel value="SOLVED">
          <InventoryList items={filtered} onSolve={handleSolve} onTrade={handleTrade} trading={trading} />
        </TabPanel>
        <TabPanel value="FAILED">
          <InventoryList items={filtered} onSolve={handleSolve} onTrade={handleTrade} trading={trading} />
        </TabPanel>
        <TabPanel value="TRADABLE">
          <InventoryList items={filtered} onSolve={handleSolve} onTrade={handleTrade} trading={trading} />
        </TabPanel>
      </TabPanels>
    </div>
  );
}

function InventoryList({
  items,
  onSolve,
  onTrade,
  trading,
}: {
  items: ReturnType<typeof import('../../stores/team').useTeamStore.getState>['inventory'];
  onSolve: (id: string) => void;
  onTrade: (item: typeof items[0]) => void;
  trading: string | null;
}) {
  if (items.length === 0) {
    return <EmptyState title="Nothing here" body="No questions match the current filter." />;
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <Card key={item.ownershipId} className="flex flex-col">
          <CardBody className="flex-1 flex flex-col p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Badge tone={DIFFICULTY_TONE[item.question.difficulty] as any}>{item.question.difficulty}</Badge>
                  <span className="font-mono text-xs font-bold text-fg">{item.question.code}</span>
                  <Badge
                    tone={
                      item.status === 'SOLVED' ? 'positive'
                      : item.status === 'FAILED' ? 'negative'
                      : 'muted'
                    }
                  >
                    {item.status}
                  </Badge>
                </div>
                <div className="mt-1 text-sm font-medium text-fg truncate">{item.question.title}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-muted">
                  <span>{QUESTION_TYPE_LABEL[item.question.type]}</span>
                  <span>•</span>
                  <span>{item.question.category}</span>
                  <span>•</span>
                  <span>Bought for {formatCoins(item.question.price)}</span>
                </div>
              </div>
            </div>

            <div className="mt-auto flex items-center justify-between gap-2 pt-2 border-t border-ink-700/50">
              <div className="flex items-center gap-1 text-[11px] text-fg-muted">
                <span>Reward: </span>
                <span className="font-mono font-bold text-positive">{formatCoins(item.question.reward)}</span>
                {item.question.maxTrades > 0 && (
                  <>
                    <span>•</span>
                    <span>Trades: {item.question.tradeCount}/{item.question.maxTrades}</span>
                  </>
                )}
              </div>

              <div className="flex gap-1.5">
                {item.status === 'UNSOLVED' && (
                  <>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => onSolve(item.ownershipId)}
                      className="h-9 px-3"
                    >
                      <CheckCircle2 className="size-3.5" />
                      SOLVE
                    </Button>
                    {item.question.maxTrades > item.question.tradeCount && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onTrade(item)}
                        disabled={trading === item.ownershipId}
                        loading={trading === item.ownershipId}
                        className="h-9 px-3"
                      >
                        <Scale className="size-3.5" />
                        TRADE
                      </Button>
                    )}
                  </>
                )}
                {item.status === 'SOLVED' && (
                  <Badge tone="positive">
                    <CheckCircle2 className="size-3" />
                    SOLVED
                  </Badge>
                )}
                {item.status === 'FAILED' && (
                  <Badge tone="negative">
                    <XCircle className="size-3" />
                    FAILED
                  </Badge>
                )}
              </div>
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

import { useState } from 'react';