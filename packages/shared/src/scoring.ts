/**
 * Scoring — pure, configurable, and identical wherever it runs.
 * The live leaderboard and the FINAL_SCORING pass both use this so a running
 * score can never diverge from the final score.
 */
import { GameConfig } from './config';

export interface ScoreInput {
  coins: number;
  /** Sum of all rewards actually earned by correct submissions. */
  rewardsEarned: number;
  solvedCount: number;
  failedCount: number;
}

export function computeScore(config: Pick<GameConfig, 'scoring'>, input: ScoreInput): number {
  const { coinsWeight, rewardsWeight, solvedBonus, failPenalty } = config.scoring;
  return Math.max(
    0,
    Math.round(
      input.coins * coinsWeight +
        input.rewardsEarned * rewardsWeight +
        input.solvedCount * solvedBonus -
        input.failedCount * failPenalty,
    ),
  );
}

/** What a solved question contributes to the score (excluding the coin balance change). */
export function rewardScore(config: Pick<GameConfig, 'scoring'>, reward: number): number {
  return Math.round(reward * config.scoring.rewardsWeight);
}