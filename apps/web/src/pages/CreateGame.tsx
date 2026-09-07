import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Key, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardHeader, CardBody, Button, FormField, TextInput, Badge, Spinner, Modal } from '../components/ui';
import { api } from '../lib/api';
import { toast } from '../stores/toasts';
import { friendlyError } from '../lib/errorMessages';
import { formatCoins } from '../lib/format';
import { useAuthStore } from '../stores/auth';

/** Host creates a game, gets a one-time host token (never shown again). */
export function CreateGame() {
  const navigate = useNavigate();
  const setHostSession = useAuthStore((s) => s.setHostSession);
  const [title, setTitle] = useState('Will It Compile?');
  const [submitting, setSubmitting] = useState(false);
  const [showToken, setShowToken] = useState<{ gameCode: string; hostToken: string } | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.createGame(title);
      setHostSession({ gameCode: res.gameCode, hostToken: res.hostToken });
      setShowToken(res);
    } catch (err) {
      const { message } = friendlyError(err);
      toast.error('Could not create game', message);
    } finally {
      setSubmitting(false);
    }
  };

  if (showToken) {
    return (
      <div className="mx-auto max-w-md">
        <Link to="/" className="flex items-center gap-1.5 mb-4 text-sm text-fg-muted hover:text-fg cursor-pointer">
          <ArrowLeft className="size-4" />
          Back
        </Link>

        <Card>
          <CardHeader>
            <h2 className="flex items-center gap-2 text-base font-bold text-fg">
              <Key className="size-5 text-warn" />
              GAME CREATED
            </h2>
          </CardHeader>
          <CardBody>
            <div className="space-y-4">
              <div className="rounded-lg border border-ink-700 bg-ink-850 p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-fg-muted">GAME CODE</div>
                <div className="font-mono text-2xl font-bold tracking-widest text-fg break-all">{showToken.gameCode}</div>
                <div className="mt-2 text-xs text-fg-muted">Share this with teams so they can join.</div>
              </div>

              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-rose-300">
                  <AlertTriangle className="size-4" />
                  HOST TOKEN (shown once — copy now)
                </div>
                <div className="font-mono text-sm break-all text-rose-200">{showToken.hostToken}</div>
                <div className="mt-2 text-xs text-rose-300/80">Store this securely. It cannot be recovered.</div>
              </div>

              <div className="flex gap-2">
                <Button variant="success" size="lg" full onClick={() => { navigate('/host', { replace: true }); setShowToken(null); }}>
                  GO TO HOST CONSOLE
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>

        <Modal
          open={true}
          onClose={() => {}}
          title="⚠️ Host token copied?"
          footer={
            <>
              <Button variant="ghost" onClick={() => { navigate('/host', { replace: true }); setShowToken(null); }}>
                I SAVED IT
              </Button>
            </>
          }
        >
          <p className="text-sm text-fg-muted">If you lose this token you cannot administer the game. Paste it somewhere safe now.</p>
        </Modal>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <Link to="/" className="flex items-center gap-1.5 mb-4 text-sm text-fg-muted hover:text-fg cursor-pointer">
        <ArrowLeft className="size-4" />
        Back
      </Link>

      <Card>
        <CardHeader>
          <h2 className="flex items-center gap-2 text-base font-bold text-fg">
            <Key className="size-5 text-accent" />
            CREATE GAME
          </h2>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-3">
            <FormField label="Game Title" htmlFor="title" hint="Shown on the projector and team screens">
              <TextInput id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Will It Compile?" maxLength={80} required />
            </FormField>

            <div className="pt-2">
              <Button type="submit" size="xl" full loading={submitting} disabled={submitting}>
                {submitting ? 'CREATING…' : 'CREATE GAME'}
              </Button>
            </div>

            <div className="mt-4 text-xs text-fg-muted text-center">
              Default: 30 min · 40 teams · 2 players/team · 1000 starting coins
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}