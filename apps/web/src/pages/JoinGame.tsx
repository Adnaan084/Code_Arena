import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Lock, User, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardHeader, CardBody, Button, FormField, TextInput, Badge, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { toast } from '../stores/toasts';
import { friendlyError } from '../lib/errorMessages';
import { newIdempotencyKey } from '../lib/api';

/** Join a game: game code + team name + player names. Returns shared team token. */
export function JoinGame() {
  const navigate = useNavigate();
  const setTeamSession = useAuthStore((s) => s.setTeamSession);
  const [code, setCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [player1, setPlayer1] = useState('');
  const [player2, setPlayer2] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.joinGame(code.toUpperCase(), teamName, player1, player2 || undefined);
      setTeamSession({
        gameCode: code.toUpperCase(),
        teamToken: res.teamAccessToken,
        teamId: res.teamId,
        teamName: res.teamName,
        playerName: player1,
      });
      toast.success('Joined!', `Welcome, ${res.teamName}`);
      navigate('/team', { replace: true });
    } catch (err) {
      const { message } = friendlyError(err);
      toast.error('Could not join', message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md">
      <Link to="/" className="flex items-center gap-1.5 mb-4 text-sm text-fg-muted hover:text-fg cursor-pointer">
        <ArrowLeft className="size-4" />
        Back
      </Link>

      <Card>
        <CardHeader>
          <h2 className="flex items-center gap-2 text-base font-bold text-fg">
            <Lock className="size-5 text-accent" />
            JOIN GAME
          </h2>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-3">
            <FormField label="Game Code" htmlFor="code" hint="4–8 letters/digits (case-insensitive)">
              <TextInput
                id="code"
                value={code.toUpperCase()}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ABC123"
                maxLength={8}
                required
                autoFocus
              />
            </FormField>

            <FormField label="Team Name" htmlFor="teamName" hint="2–32 characters">
              <TextInput id="teamName" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Team Alpha" maxLength={32} required />
            </FormField>

            <FormField label="Player 1 (You)" htmlFor="p1" hint="Your display name">
              <TextInput id="p1" value={player1} onChange={(e) => setPlayer1(e.target.value)} placeholder="Ada" maxLength={32} required />
            </FormField>

            <FormField label="Player 2 (Optional)" htmlFor="p2" hint="Teammate's name (they can join later with the team code)">
              <TextInput id="p2" value={player2} onChange={(e) => setPlayer2(e.target.value)} placeholder="Grace" maxLength={32} />
            </FormField>

            <div className="pt-2">
              <Button type="submit" size="xl" full loading={submitting} disabled={submitting}>
                {submitting ? 'JOINING…' : 'JOIN GAME'}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}