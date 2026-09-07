import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, XCircle, Send, Clock } from 'lucide-react';
import { Card, CardBody, Badge, Button, FormField, TextInput, CodeBlock, EmptyState } from '../../components/ui';
import { useTeamStore } from '../../stores/team';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../lib/api';
import { toast } from '../../stores/toasts';
import { friendlyError } from '../../lib/errorMessages';
import { newIdempotencyKey } from '../../lib/api';
import { formatCoins, DIFFICULTY_TONE, QUESTION_TYPE_LABEL } from '../../lib/format';
import { useRemainingTime } from '../../hooks/useRemainingTime';

/** Focused solving screen. Shows question, code, answer input, submit. */
export function TeamSolve() {
  const { ownershipId } = useParams<{ ownershipId: string }>();
  const navigate = useNavigate();
  const { teamToken } = useAuthStore();
  const inventory = useTeamStore((s) => s.inventory);
  const meta = useTeamStore((s) => s.meta);
  const phase = meta?.phase;
  const canSubmit = phase?.canSubmit ?? false;
  const remaining = useRemainingTime();

  const item = inventory.find((i) => i.ownershipId === ownershipId);
  const q = item?.question;

  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ownershipId || !canSubmit) return;
    setSubmitting(true);
    try {
      await api.submitAnswer(teamToken ?? '', ownershipId, { kind: 'free', text: answer }, newIdempotencyKey());
      toast.success('Submitted!', 'Answer recorded.');
      navigate('/team/inventory', { replace: true });
    } catch (err) {
      const { message } = friendlyError(err);
      toast.error('Submit failed', message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!item) {
    return <EmptyState title="Question not found" body="This question is no longer in your inventory." action={<Button variant="ghost" onClick={() => navigate('/team/inventory')}>Back to inventory</Button>} />;
  }

  if (!q) {
    return <EmptyState title="Loading…" />;
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate('/team/inventory')} className="self-start">
        <ArrowLeft className="size-3.5" />
        BACK
      </Button>

      <Card>
        <CardBody className="pt-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Badge tone={DIFFICULTY_TONE[q.difficulty] as any}>{q.difficulty}</Badge>
              <span className="font-mono text-sm font-bold text-fg">{q.code}</span>
            </div>
            <div className="flex items-center gap-1.5 font-mono text-sm text-fg-muted">
              <Clock className="size-3.5" />
              {formatCoins(q.reward)} coins
            </div>
          </div>
          <h2 className="mt-2 text-lg font-semibold text-fg">{q.title}</h2>
          <p className="mt-1 text-sm text-fg-muted">{q.body}</p>

          {q.snippet && <CodeBlock code={q.snippet} title={q.code} fileName={`${q.code}.c`} />}

          {q.type === 'MULTIPLE_CHOICE' && q.options && (
            <div className="mt-3 space-y-2">
              <FormField label="Select answer">
                <select
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  className="h-11 w-full rounded-lg border border-ink-600 bg-ink-850 px-3.5 text-sm text-fg focus:border-accent focus:outline-none"
                >
                  <option value="">— Choose —</option>
                  {q.options.map((opt, i) => (
                    <option key={i} value={String(i)}>
                      {opt}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
          )}

          {q.type !== 'MULTIPLE_CHOICE' && (
            <FormField label="Your answer" htmlFor="answer">
              <TextInput
                id="answer"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder={q.hint ?? 'Type your answer here…'}
                maxLength={8000}
              />
            </FormField>
          )}

          <div className="mt-4 flex items-center justify-between gap-3 pt-3 border-t border-ink-700/50">
            <div className="flex items-center gap-2 text-sm text-fg-muted">
              <span className="font-semibold">Time:</span>
              <span className="font-mono tabular-nums">{formatCoins(remaining ?? 0) || '—'}</span>
            </div>
            <Button
              variant="primary"
              size="lg"
              loading={submitting}
              disabled={submitting || !canSubmit || !answer.trim()}
              onClick={handleSubmit}
              className="w-full sm:w-auto"
            >
              <Send className="size-4" />
              SUBMIT
            </Button>
          </div>

          {!canSubmit && (
            <p className="text-xs text-fg-muted text-center">Submissions are closed for this phase.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

import { useState } from 'react';