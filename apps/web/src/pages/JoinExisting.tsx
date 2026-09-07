import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Lock, User } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardHeader, CardBody, Button, FormField, TextInput, Badge, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { toast } from '../stores/toasts';
import { friendlyError } from '../lib/errorMessages';

/** Second player seats-in by presenting the shared team access token. */
export function JoinExisting() {
  const navigate = useNavigate();
  const setTeamSession = useAuthStore((s) => s.setTeamSession);
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.joinExisting(code.toUpperCase(), token);
      // Note: we don't get a teamAccessToken back from join-existing,
      // the user must already have it (it's the same token they pasted).
      // We reuse the token they entered.
      setTeamSession({
        gameCode: code.toUpperCase(),
        teamToken: token,
        teamId: res.teamId,
        teamName: res.teamName,
        playerName: null, // unknown at this point; can be patched later if needed
      });
      toast.success('Rejoined!', `Welcome back, ${res.teamName}`);
      navigate('/team', { replace: true });
    } catch (err) {
      const { message } = friendlyError(err);
      toast.error('Could not rejoin', message);
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
            REJOIN TEAM
          </h2>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-3">
            <FormField label="Game Code" htmlFor="code" hint="Same code your teammate used">
              <TextInput id="code" value={code.toUpperCase()} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC123" maxLength={8} required />
            </FormField>

            <FormField label="Team Access Token" htmlFor="token" hint="The long code your teammate received when they created the team">
              <TextInput
                id="token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste the team access token here"
                autoComplete="off"
                required
              />
            </FormField>

            <div className="pt-2">
              <Button type="submit" size="xl" full loading={submitting} disabled={submitting}>
                {submitting ? 'REJOINING…' : 'REJOIN TEAM'}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}