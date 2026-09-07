import { Coins, FileText, Filter, Download, Settings } from 'lucide-react';
import { Card, CardBody, Badge, EmptyState, Tabs, TabList, Tab, TabPanels, TabPanel } from '../../components/ui';
import { useHostStore } from '../../stores/host';
import { formatCoins } from '../../lib/format';
import { TransactionType } from '@wcc/shared';

type TxFilter = 'ALL' | 'PURCHASE' | 'REWARD' | 'TRADE' | 'ADMIN';

/** Host transaction ledger with filters. */
export function HostTransactions() {
  const transactions = useHostStore((s) => s.transactions);
  const teams = useHostStore((s) => s.teams);
  const [filter, setFilter] = useState<TxFilter>('ALL');

  const filtered = transactions.filter((tx) => filter === 'ALL' || tx.type === filter);

  const typeTone = {
    INITIAL: 'info' as const,
    PURCHASE: 'negative' as const,
    REWARD: 'positive' as const,
    TRADE_OUT: 'negative' as const,
    TRADE_IN: 'positive' as const,
    REFUND: 'info' as const,
    BONUS: 'positive' as const,
    PENALTY: 'negative' as const,
    ADMIN_ADJUST: 'warn' as const,
  };

  function typeIcon(type: TransactionType) {
    switch (type) {
      case 'PURCHASE': return <FileText className="size-4" />;
      case 'ADMIN_ADJUST': return <Settings className="size-4" />;
      default: return <Coins className="size-4" />;
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-fg-muted">LEDGER ({transactions.length})</h2>
        <Tabs value={filter} onValueChange={setFilter}>
          <TabList className="grid w-full grid-cols-5">
            <Tab value="ALL" className="text-[11px]">ALL</Tab>
            <Tab value="PURCHASE" className="text-[11px]">BUYS</Tab>
            <Tab value="REWARD" className="text-[11px]">REWARDS</Tab>
            <Tab value="TRADE" className="text-[11px]">TRADES</Tab>
            <Tab value="ADMIN" className="text-[11px]">ADMIN</Tab>
          </TabList>
        </Tabs>
      </div>

      <TabPanels value={filter}>
        <TabPanel value="ALL">
          {filtered.length === 0 ? (
            <EmptyState title="No transactions" body="Activity appears here." className="py-6" />
          ) : (
            <div className="space-y-2">
              {filtered.map((tx, i) => (
                <Card key={i}>
                  <CardBody className="p-3">
                    <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 items-center">
                      <div className="flex items-center gap-2">
                        {typeIcon(tx.type)}
                        <Badge tone={typeTone[tx.type]}>{tx.type}</Badge>
                      </div>
                      <div className="text-sm font-medium text-fg truncate">{tx.reason}</div>
                      <div className="text-right">
                        <div className={`font-mono text-sm ${tx.amount > 0 ? 'text-positive' : 'text-negative'}`}>
                          {tx.amount > 0 ? '+' : ''}{formatCoins(tx.amount)}
                        </div>
                        <div className="text-[10px] text-fg-muted font-mono">{formatCoins(tx.balanceAfter)}</div>
                      </div>
                      <div className="text-[10px] text-fg-muted">{new Date(tx.createdAt).toLocaleString()}</div>
                      <div className="w-20 text-right text-[10px] text-fg-muted font-mono">{tx.teamId ? teams.find((t) => t.id === tx.teamId)?.name.slice(0, 12) : '—'}</div>
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </TabPanel>
        <TabPanel value="PURCHASE">
          <EmptyState title="Select a filter" body="Choose a transaction type above." className="py-6" />
        </TabPanel>
        <TabPanel value="REWARD">
          <EmptyState title="Select a filter" body="Choose a transaction type above." className="py-6" />
        </TabPanel>
        <TabPanel value="TRADE">
          <EmptyState title="Select a filter" body="Choose a transaction type above." className="py-6" />
        </TabPanel>
        <TabPanel value="ADMIN">
          <EmptyState title="Select a filter" body="Choose a transaction type above." className="py-6" />
        </TabPanel>
      </TabPanels>
    </div>
  );
}

import { useState } from 'react';