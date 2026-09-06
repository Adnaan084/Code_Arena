/**
 * Game balance & rules configuration.
 * The Game row stores a validated GameConfig blob; the host can override
 * defaults at game creation. Env variables can override the defaults
 * process-wide. Nothing here is hard-coded in gameplay code.
 */
import { z } from 'zod';
import { DIFFICULTIES, QUESTION_TYPES, MATCH_MODES, QUESTION_CATEGORIES } from './types';

export const DIFFICULTY_WEIGHT: Record<(typeof DIFFICULTIES)[number], number> = {
  EASY: 1,
  MEDIUM: 2,
  HARD: 3,
  EXTREME: 4,
};

export const gameConfigSchema = z.object({
  startingCoins: z.number().int().min(100).max(1_000_000),
  gameDurationMinutes: z.number().int().min(1).max(180),
  maxTeams: z.number().int().min(1).max(200),
  playersPerTeam: z.number().int().min(1).max(4),
  /* Answer options */
  maxAttempts: z.number().int().min(1).max(10),
  failMarksSolved: z.boolean(), // false => a wrong answer leaves the question UNSOLVED
  allowSubmitAfterClose: z.boolean(),
  /* Trading */
  maxTradesPerQuestion: z.number().int().min(0).max(20),
  tradeWindowMinutes: z.number().int().min(1).max(180), // trades close this many minutes after start (<= duration)
  tradeTTLSeconds: z.number().int().min(30).max(3600), // open offer expiry
  /* Auto phase transitions (server timer, after the clock passes boundaries) */
  finalScoringDelaySeconds: z.number().int().min(0).max(3600), // MARKET_CLOSED → FINAL_SCORING after close
  scoringDurationSeconds: z.number().int().min(0).max(3600), // FINAL_SCORING → COMPLETED
  /* Defaults applied when a question is created without explicit price/reward */
  priceTable: z.object({
    EASY: z.number().int().positive(),
    MEDIUM: z.number().int().positive(),
    HARD: z.number().int().positive(),
    EXTREME: z.number().int().positive(),
  }),
  rewardTable: z.object({
    EASY: z.number().int().positive(),
    MEDIUM: z.number().int().positive(),
    HARD: z.number().int().positive(),
    EXTREME: z.number().int().positive(),
  }),
  /* score = round(coins*wc + rewardsEarned*wr + solvedBonus*solved - failPenalty*failed) */
  scoring: z.object({
    coinsWeight: z.number().min(0).max(10),
    rewardsWeight: z.number().min(0).max(10),
    solvedBonus: z.number().int().min(0).max(10000),
    failPenalty: z.number().int().min(0).max(10000),
  }),
});

export type GameConfig = z.infer<typeof gameConfigSchema>;

export const DEFAULT_GAME_CONFIG: GameConfig = {
  startingCoins: 1000,
  gameDurationMinutes: 30,
  maxTeams: 40,
  playersPerTeam: 2,
  maxAttempts: 1,
  failMarksSolved: true, // wrong answer => question stays ownership but marked FAILED (no more attempts)
  allowSubmitAfterClose: false,
  maxTradesPerQuestion: 2,
  tradeWindowMinutes: 30,
  tradeTTLSeconds: 300,
  finalScoringDelaySeconds: 10,
  scoringDurationSeconds: 5,
  priceTable: { EASY: 120, MEDIUM: 300, HARD: 520, EXTREME: 750 },
  rewardTable: { EASY: 250, MEDIUM: 600, HARD: 950, EXTREME: 1300 },
  scoring: { coinsWeight: 1, rewardsWeight: 1, solvedBonus: 0, failPenalty: 0 },
};

/** Allow a partial config (any subset) — used by POST /api/games. */
export const gameConfigPatchSchema = gameConfigSchema.partial();

const numericEnv = (key: string, fallback: number, min: number, max: number): number => {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= min && n <= max) return n;
  return fallback;
};

const ENV_DEFAULTS: Record<string, number> = {
  STARTING_COINS: DEFAULT_GAME_CONFIG.startingCoins,
  GAME_DURATION_MINUTES: DEFAULT_GAME_CONFIG.gameDurationMinutes,
  MAX_TEAMS: DEFAULT_GAME_CONFIG.maxTeams,
  MAX_ATTEMPTS: DEFAULT_GAME_CONFIG.maxAttempts,
  MAX_TRADES_PER_QUESTION: DEFAULT_GAME_CONFIG.maxTradesPerQuestion,
};

/**
 * GameConfig with process-level env overrides applied to the defaults.
 * (Host-provided patches at POST /games are merged on top of this.)
 */
export function defaultConfigFromEnv(): GameConfig {
  return {
    ...DEFAULT_GAME_CONFIG,
    ...(numericEnv('STARTING_COINS', DEFAULT_GAME_CONFIG.startingCoins, 100, 1_000_000) !==
    DEFAULT_GAME_CONFIG.startingCoins
      ? { startingCoins: Number(process.env.STARTING_COINS) }
      : {}),
    ...(numericEnv('GAME_DURATION_MINUTES', DEFAULT_GAME_CONFIG.gameDurationMinutes, 1, 180) !==
    DEFAULT_GAME_CONFIG.gameDurationMinutes
      ? { gameDurationMinutes: Number(process.env.GAME_DURATION_MINUTES) }
      : {}),
    ...(numericEnv('MAX_TEAMS', DEFAULT_GAME_CONFIG.maxTeams, 1, 200) !== DEFAULT_GAME_CONFIG.maxTeams
      ? { maxTeams: Number(process.env.MAX_TEAMS) }
      : {}),
    ...(numericEnv('MAX_ATTEMPTS', DEFAULT_GAME_CONFIG.maxAttempts, 1, 10) !==
    DEFAULT_GAME_CONFIG.maxAttempts
      ? { maxAttempts: Number(process.env.MAX_ATTEMPTS) }
      : {}),
    ...(numericEnv('MAX_TRADES_PER_QUESTION', DEFAULT_GAME_CONFIG.maxTradesPerQuestion, 0, 20) !==
    DEFAULT_GAME_CONFIG.maxTradesPerQuestion
      ? { maxTradesPerQuestion: Number(process.env.MAX_TRADES_PER_QUESTION) }
      : {}),
  };
}

/** Question-creation defaults derived from the config. */
export function defaultPrice(config: GameConfig, difficulty: (typeof DIFFICULTIES)[number]): number {
  return config.priceTable[difficulty];
}
export function defaultReward(config: GameConfig, difficulty: (typeof DIFFICULTIES)[number]): number {
  return config.rewardTable[difficulty];
}

export { DIFFICULTIES, QUESTION_TYPES, MATCH_MODES, QUESTION_CATEGORIES };