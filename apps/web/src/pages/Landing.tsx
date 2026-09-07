import { Link } from 'react-router-dom';
import { Sprout, Monitor } from 'lucide-react';
import { Card, CardBody, Button, Badge, Stat, FormField, TextInput } from '../components/ui';

/** Home / landing: join, create, or spectate. */
export function Landing() {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-80px)] max-w-md flex-col items-center justify-center px-4">
      <div className="mx-auto mb-8 flex max-w-md flex-col items-center text-center">
        <Sprout className="size-14 text-accent" aria-hidden />
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-fg">WILL IT COMPILE?</h1>
        <p className="mt-2 text-sm text-fg-muted">Live C marketplace game. Buy questions. Solve them. Trade. Win.</p>
      </div>

      <div className="w-full space-y-3">
        <Link to="/join">
          <Button variant="primary" size="xl" full className="h-14">
            <span className="flex items-center justify-center gap-2">
              <Sprout className="size-5" />
              JOIN A GAME
            </span>
          </Button>
        </Link>
        <Link to="/create">
          <Button variant="secondary" size="xl" full className="h-14">
            <span className="flex items-center justify-center gap-2">CREATE HOST GAME</span>
          </Button>
        </Link>
        <Link to="/display/ABC123">
          <Button variant="ghost" size="lg" full className="h-12">
            <span className="flex items-center justify-center gap-2">
              <Monitor className="size-4" />
              PROJECTOR DISPLAY
            </span>
          </Button>
        </Link>
      </div>

      <div className="mt-6 w-full">
        <Card>
          <CardBody className="pt-2">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-widest text-fg-muted">Already have a team code?</h3>
            <Link to="/join-existing" className="w-full">
              <Button variant="ghost" size="md" full>
                REJOIN MY TEAM
              </Button>
            </Link>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}