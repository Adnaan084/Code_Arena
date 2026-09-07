import React, { Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { Outlet } from 'react-router-dom';
import { TeamShell } from './components/layout/TeamShell';
import { HostShell } from './components/layout/HostShell';
import { DisplayShell } from './components/layout/DisplayShell';
import { Spinner } from './components/ui/Spinner';

/**
 * Three frontend modes on one router. The outer layout chooses the shell based
 * on the path; inner routes handle each mode's pages.
 */

// Lazy page imports so the initial bundle stays small.
// Pages export named component functions, so adapt them to the `default`
// export shape React.lazy() requires (no re-export needed in each page).
function lazyPage<T extends React.ComponentType>(loader: () => Promise<Record<string, T>>, name: keyof Awaited<ReturnType<typeof loader>> & string) {
  return React.lazy(() => loader().then((m) => ({ default: m[name] as T })));
}

const Landing = lazyPage(() => import('./pages/Landing'), 'Landing');
const JoinGame = lazyPage(() => import('./pages/JoinGame'), 'JoinGame');
const JoinExisting = lazyPage(() => import('./pages/JoinExisting'), 'JoinExisting');
const CreateGame = lazyPage(() => import('./pages/CreateGame'), 'CreateGame');

const TeamLobby = lazyPage(() => import('./pages/team/Lobby'), 'TeamLobby');
const TeamMarketplace = lazyPage(() => import('./pages/team/Marketplace'), 'TeamMarketplace');
const TeamInventory = lazyPage(() => import('./pages/team/Inventory'), 'TeamInventory');
const TeamTrades = lazyPage(() => import('./pages/team/Trades'), 'TeamTrades');
const TeamLeaderboard = lazyPage(() => import('./pages/team/Leaderboard'), 'TeamLeaderboard');
const TeamSolve = lazyPage(() => import('./pages/team/Solve'), 'TeamSolve');

const HostConsole = lazyPage(() => import('./pages/host/Console'), 'HostConsole');
const HostLobby = lazyPage(() => import('./pages/host/Lobby'), 'HostLobby');
const HostQuestions = lazyPage(() => import('./pages/host/Questions'), 'HostQuestions');
const HostTransactions = lazyPage(() => import('./pages/host/Transactions'), 'HostTransactions');
const HostAudit = lazyPage(() => import('./pages/host/Audit'), 'HostAudit');

const DisplayProjector = lazyPage(() => import('./pages/display/Projector'), 'DisplayProjector');

function RootLanding() {
  return (
    <Suspense fallback={<Spinner label="Loading…" />}>
      <Outlet />
    </Suspense>
  );
}

function TeamLayout() {
  return (
    <Suspense fallback={<Spinner label="Loading…" />}>
      <TeamShell>
        <Outlet />
      </TeamShell>
    </Suspense>
  );
}

function HostLayout() {
  return (
    <Suspense fallback={<Spinner label="Loading…" />}>
      <HostShell>
        <Outlet />
      </HostShell>
    </Suspense>
  );
}

function DisplayLayout() {
  return (
    <Suspense fallback={<Spinner label="Loading…" />}>
      <DisplayShell>
        <Outlet />
      </DisplayShell>
    </Suspense>
  );
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLanding />,
    children: [
      { index: true, element: <Landing /> },
      { path: 'join', element: <JoinGame /> },
      { path: 'join-existing', element: <JoinExisting /> },
      { path: 'create', element: <CreateGame /> },
    ],
  },
  {
    path: '/team',
    element: <TeamLayout />,
    children: [
      { index: true, element: <TeamLobby /> },
      { path: 'market', element: <TeamMarketplace /> },
      { path: 'inventory', element: <TeamInventory /> },
      { path: 'trades', element: <TeamTrades /> },
      { path: 'leaderboard', element: <TeamLeaderboard /> },
      { path: 'solve/:ownershipId', element: <TeamSolve /> },
    ],
  },
  {
    path: '/host',
    element: <HostLayout />,
    children: [
      { index: true, element: <HostConsole /> },
      { path: 'lobby', element: <HostLobby /> },
      { path: 'questions', element: <HostQuestions /> },
      { path: 'transactions', element: <HostTransactions /> },
      { path: 'audit', element: <HostAudit /> },
    ],
  },
  {
    path: '/display/:gameCode',
    element: <DisplayLayout />,
    children: [
      { index: true, element: <DisplayProjector /> },
    ],
  },
]);