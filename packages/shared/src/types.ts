/**
 * Core domain types for "Will It Compile?".
 * These are shared verbatim between the server (authority), the client (renderer)
 * and tests. All money/ownership/phase rules live server-side; these types only
 * describe the shape of state and messages.
 */

// ─── Game lifecycle ──────────────────────────────────────────────────────
/** Persisted game phases. PAUSED is recorded separately (pausedAt) not as a state. */
export const GAME_STATES = [
  'LOBBY', // teams join; no market, no play
  'MARKET_OPEN', // buy / solve / trade enabled
  'FINAL_MINUTE', // last 60 s of the match — same rules as MARKET_OPEN, urgent UI
  'MARKET_CLOSED', // market frozen; no buys/trades; submits per config
  'FINAL_SCORING', // server computes the final leaderboard
  'COMPLETED', // frozen, final results broadcast
] as const;
export type GameState = (typeof GAME_STATES)[number];

/** What the UI shows — includes PAUSED derived from pausedAt. */
export const DISPLAY_STATES = [...GAME_STATES, 'PAUSED'] as const;
export type DisplayState = (typeof DISPLAY_STATES)[number];

export interface PhaseRules {
  canBuy: boolean;
  canTrade: boolean;
  canSubmit: boolean;
  canJoin: boolean;
  marketOpen: boolean;
}

export type TeamStatus = 'ACTIVE' | 'DISQUALIFIED';

export type QuestionOwnershipStatus = 'UNSOLVED' | 'SOLVED' | 'FAILED';

export type TradeState = 'OPEN' | 'EXECUTED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';

export type TransactionType =
  | 'INITIAL'
  | 'PURCHASE'
  | 'REFUND'
  | 'REWARD'
  | 'TRADE_OUT'
  | 'TRADE_IN'
  | 'BONUS'
  | 'PENALTY'
  | 'ADMIN_ADJUST';

// ─── Questions & grading ────────────────────────────────────────────────
export const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD', 'EXTREME'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const QUESTION_TYPES = [
  'MULTIPLE_CHOICE',
  'OUTPUT_PREDICTION',
  'WILL_IT_COMPILE',
  'FIND_ERROR',
  'FIND_UB',
  'SHORT_ANSWER',
  'CODE_CORRECTION',
  'CODING_CHALLENGE',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const MATCH_MODES = ['EXACT', 'NORMALIZED', 'CONTAINS', 'REGEX'] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

/** The full, stored answer specification. NEVER sent to team clients. */
export type AnswerData =
  | { type: 'MULTIPLE_CHOICE'; options: string[]; correctIndex: number }
  | {
      type:
        | 'OUTPUT_PREDICTION'
        | 'WILL_IT_COMPILE'
        | 'FIND_ERROR'
        | 'FIND_UB'
        | 'SHORT_ANSWER'
        | 'CODE_CORRECTION';
      matchMode: MatchMode;
      /** Accepted answers (e.g. ["COMPILER_ERROR", "compile error"]) */
      accepted: string[];
      /** Optional numeric tolerance when answers are numbers. */
      numericTolerance?: number;
    }
  | {
      type: 'CODING_CHALLENGE';
      sampleInput?: string;
      matchMode: MatchMode;
      /** Expected outputs for the challenge (team submits a program's output). */
      acceptedOutputs: string[];
      numericTolerance?: number;
    };

export type AnswerDataOf<T extends QuestionType> = Extract<AnswerData, { type: T }>;

/** What a team sends when submitting. The server validates it matches the question type. */
export type AnswerSubmission =
  | { kind: 'mcq'; selectedIndex: number }
  | { kind: 'free'; text: string };

export type QuestionStatus = 'AVAILABLE' | 'SOLD' | 'DISABLED';

export const QUESTION_CATEGORIES = [
  'C SYNTAX',
  'VARIABLES',
  'OPERATORS',
  'LOOPS',
  'FUNCTIONS',
  'ARRAYS',
  'STRINGS',
  'POINTERS',
  'STRUCTURES',
  'DYNAMIC MEMORY',
  'RECURSION',
  'PREPROCESSOR',
  'FILE HANDLING',
  'COMPILATION',
  'UNDEFINED BEHAVIOR',
  'OUTPUT PREDICTION',
  'TRICKY C',
  'COMPILER QUIRKS',
] as const;

// ─── DTOs (API + socket payload shapes) ─────────────────────────────────
/** Public question — every field a team is allowed to see. Answers stripped. */
export interface QuestionPublic {
  id: string;
  code: string;
  type: QuestionType;
  difficulty: Difficulty;
  category: string;
  title: string;
  body: string;
  /** C code block shown to the team (null when none). */
  snippet: string | null;
  price: number;
  reward: number;
  hint: string | null;
  /** MCQ: options in display order (correct index withheld). */
  options?: string[];
  /** CODING_CHALLENGE: sample input shown to the team. */
  sampleInput?: string;
  status: QuestionStatus;
  tradeCount: number;
  maxTrades: number;
  tradable: boolean;
}

/** Host sees the full question including the stored answer specification. */
export interface QuestionAdmin extends QuestionPublic {
  answerData: AnswerData;
  explanation: string | null;
  enabled: boolean;
}

export interface MarketItem extends QuestionPublic {
  purchasedByMe: boolean;
}

export interface InventoryItem {
  ownershipId: string;
  question: QuestionPublic;
  status: QuestionOwnershipStatus;
  attemptsUsed: number;
  maxAttempts: number;
  purchasedAt: string;
}

export interface TeamSummary {
  id: string;
  name: string;
  coins: number;
  score: number;
  solvedCount: number;
  purchasedCount: number;
  failedCount: number;
  tradeCount: number;
  status: TeamStatus;
  joinOrder: number;
  online: boolean;
}

export type TradeDirection = 'IN' | 'OUT';

export interface TradeDto {
  id: string;
  direction: TradeDirection;
  state: TradeState;
  coins: number;
  expiresAt: string;
  createdAt: string;
  fromTeam: { id: string; name: string };
  toTeam: { id: string; name: string };
  /** Questions the OFFERING team is giving away. */
  offered: { id: string; code: string; title: string; difficulty: Difficulty }[];
  /** Questions the OFFERING team wants back. */
  requested: { id: string; code: string; title: string; difficulty: Difficulty }[];
}

export interface TransactionDto {
  id: string;
  type: TransactionType;
  amount: number;
  balanceAfter: number;
  reason: string;
  createdAt: string;
}

export interface ActivityDto {
  seq: number;
  type: string;
  message: string;
  teamName: string | null;
  questionCode: string | null;
  at: string;
}

export interface LeaderboardRow {
  rank: number;
  teamName: string;
  score: number;
  coins: number;
  solved: number;
  purchased: number;
  trades: number;
}

export interface AnnouncementDto {
  id: string;
  message: string;
  createdAt: string;
}

// ─── Game state: what a client (team / host / display) receives ─────────
export interface GameMeta {
  id: string;
  code: string;
  title: string;
  state: DisplayState;
  /** Effective rules for the current game moment (server-authoritative). */
  phase: PhaseRules;
  startTime: string | null;
  endTime: string | null;
  /** Remaining game time at the moment this state was produced, ms. */
  remainingMs: number | null;
  maxTeams: number;
  gameDurationMinutes: number;
  announcements: AnnouncementDto[];
  lastEventSeq: number;
}

export interface TeamGameState {
  meta: GameMeta;
  team: TeamSummary;
  transactions: TransactionDto[];
  lastEventSeq: number;
}

export interface PublicDisplayState {
  meta: GameMeta;
  leaderboard: LeaderboardRow[];
  recentActivity: ActivityDto[];
}

export interface HostGameState {
  meta: GameMeta;
  teams: TeamSummary[];
  activity: ActivityDto[];
  transactions: TransactionDto[];
  audit: AuditLogEntry[];
  leaderboard: LeaderboardRow[];
}

export interface AuditLogEntry {
  id: string;
  actorType: 'HOST' | 'SYSTEM' | 'TEAM';
  actorName: string | null;
  action: string;
  detail: string | null;
  createdAt: string;
}