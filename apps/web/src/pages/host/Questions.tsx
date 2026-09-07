import { FileQuestion, Plus, Pencil, Trash2, Eye, EyeOff, Settings } from 'lucide-react';
import { Card, CardBody, Badge, Button, EmptyState, Modal } from '../../components/ui';
import { useHostStore } from '../../stores/host';
import { formatCoins, DIFFICULTY_TONE } from '../../lib/format';
import { useState } from 'react';

/** Host question management: list, add, edit, enable/disable, delete. */
export function HostQuestions() {
  const questions = useHostStore((s) => s.questions);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-fg-muted">QUESTIONS ({questions.length})</h2>
        <Button variant="primary" size="sm" onClick={() => setEditing('new')}>
          <Plus className="size-3.5" /> ADD QUESTION
        </Button>
      </div>

      {questions.length === 0 ? (
        <EmptyState title="No questions" body="Add questions to seed the marketplace." />
      ) : (
        <div className="space-y-2">
          {questions.map((q) => (
            <Card key={q.id}>
              <CardBody className="p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge tone={DIFFICULTY_TONE[q.difficulty] as any}>{q.difficulty}</Badge>
                      <span className="font-mono text-sm font-bold text-fg">{q.code}</span>
                      <span className="font-medium text-fg truncate">{q.title}</span>
                      <span className="text-[11px] text-fg-muted">{q.category}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-muted">
                      <span>{formatCoins(q.price)} coins</span>
                      <span>•</span>
                      <span className="text-positive">{formatCoins(q.reward)} reward</span>
                      <span>•</span>
                      <span>Trades: {q.tradeCount}/{q.maxTrades}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge tone={q.enabled ? 'positive' : 'muted'}>{q.enabled ? 'ENABLED' : 'DISABLED'}</Badge>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(q.id)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="text-rose-300 hover:text-rose-200">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'ADD QUESTION' : 'EDIT QUESTION'}
        wide
      >
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">Question editor — wire to the host API endpoints.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>CANCEL</Button>
            <Button variant="primary" onClick={() => setEditing(null)}>SAVE</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}