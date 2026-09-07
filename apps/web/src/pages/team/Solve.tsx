import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, XCircle, Send, Clock, TerminalSquare } from 'lucide-react';
import { Card, CardBody, Badge, Button, FormField, TextInput, CodeBlock, EmptyState } from '../../components/ui';
import { useTeamStore } from '../../stores/team';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../lib/api';
import { toast } from '../../stores/toasts';
import { friendlyError } from '../../lib/errorMessages';
import { newIdempotencyKey } from '../../lib/api';
import { formatCoins, DIFFICULTY_TONE, QUESTION_TYPE_LABEL } from '../../lib/format';
import { useRemainingTime } from '../../hooks/useRemainingTime';

interface SubmitResult {
  correct: boolean;
  already: boolean;
  coinsAwarded: number;
  balanceAfter: number | null;
}

/** Focused solving screen. Shows question, code, answer input, submit, and the
 *  authoritative result the server returns (accepted/rejected + reward + balance). */
export function TeamSolve() {
  const { questionId } = useParams<{ questionId: string }>();
  const navigate = useNavigate();
  const { teamToken } = useAuthStore();
  const inventory = useTeamStore((s) => s.inventory);
  const meta = useTeamStore((s) => s.meta);
  const phase = meta?.phase;
  const canSubmit = phase?.canSubmit ?? false;
  const remaining = useRemainingTime();

  const item = inventory.find((i) => i.question.id === questionId);
  const q = item?.question;

  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  // Backend rules, surfaced here without re-implementing them:
  //   - a SOLVED / FAILED question can no longer be answered
  //   - a pending submission is server-authoritative, so we just await it
  const alreadyDecided = item ? item.status !== 'UNSOLVED' : false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!questionId || !canSubmit || !q) return;
    setSubmitting(true);
    setResult(null);
    try {
      const answerSubmission =
        q.type === 'MULTIPLE_CHOICE'
          ? { kind: 'mcq' as const, selectedIndex: Number(answer) }
          : { kind: 'free' as const, text: answer };
      const res = await api.submitAnswer(teamToken ?? '', q.id, answerSubmission, newIdempotencyKey());
      setResult(res);
      if (res.correct) {
        toast.success('Accepted!', `+${formatCoins(res.coinsAwarded)} coins.`);
      } else {
        toast.error('Rejected', 'That answer was not correct.');
      }
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
              <Badge tone="muted">{QUESTION_TYPE_LABEL[q.type]}</Badge>
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
            <div className="flex items-center gap-1.5 font-mono text-sm text-fg-muted">
              <Clock className="size-3.5" />
              {formatCoins(q.reward)} coins
            </div>
          </div>
          <h2 className="mt-2 text-lg font-semibold text-fg">{q.title}</h2>
          <p className="mt-1 text-sm text-fg-muted">{q.body}</p>

          {q.snippet && <div className="mt-3"><CodeBlock code={q.snippet} title={q.code} fileName={`${q.code}.c`} /></div>}

          {q.type === 'CODING_CHALLENGE' && q.sampleInput && (
            <div className="mt-3 rounded-lg border border-ink-700 bg-[#0a0e15] px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-fg-muted">
                <TerminalSquare className="size-3.5" />
                Sample input
              </div>
              <pre className="mt-1 overflow-x-auto font-mono text-[13px] text-fg">{q.sampleInput}</pre>
            </div>
          )}

          {q.hint && <p className="mt-2 text-xs text-fg-faint">Hint: {q.hint}</p>}

          {q.type === 'MULTIPLE_CHOICE' && q.options && (
            <div className="mt-3 space-y-2">
              <FormField label="Select answer" htmlFor="solve-mcq">
                <select
                  id="solve-mcq"
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

          {/* Authoritative result — rendered only from the server's response. */}
          {result && (
            <div
              role="status"
              className={`mt-4 rounded-lg border px-3 py-3 ${
                result.correct
                  ? 'border-positive/40 bg-positive/10'
                  : 'border-negative/40 bg-negative/10'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold text-fg">
                {result.correct ? (
                  <CheckCircle2 className="size-5 text-positive" />
                ) : (
                  <XCircle className="size-5 text-negative" />
                )}
                <span className={result.correct ? 'text-positive' : 'text-negative'}>
                  {result.correct ? 'ACCEPTED' : 'REJECTED'}
                </span>
              </div>
              <div className="mt-1 text-sm text-fg-muted">
                {result.correct ? (
                  <>
                    Reward <span className="font-mono font-bold text-positive">+{formatCoins(result.coinsAwarded)}</span>
                    {result.balanceAfter !== null && (
                      <> · New balance <span className="font-mono font-bold text-fg">{formatCoins(result.balanceAfter)}</span></>
                    )}
                  </>
                ) : (
                  <>No reward — the answer was not correct.</>
                )}
                {result.already && (
                  <span className="ml-1 text-warn">(This submission was already recorded.)</span>
                )}
              </div>
              {result.correct && (
                <Button variant="secondary" size="sm" className="mt-2" onClick={() => navigate('/team/inventory', { replace: true })}>
                  Back to inventory
                </Button>
              )}
            </div>
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
              disabled={submitting || !canSubmit || !answer.trim() || alreadyDecided}
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
          {canSubmit && item.status === 'SOLVED' && (
            <p className="text-xs text-positive text-center">This question is already solved.</p>
          )}
          {canSubmit && item.status === 'FAILED' && (
            <p className="text-xs text-negative text-center">
              {item.attemptsUsed >= item.maxAttempts ? 'No attempts remaining for this question.' : 'This question has been marked failed.'}
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
