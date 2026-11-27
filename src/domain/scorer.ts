import {
  DIFFICULTY_WEIGHTS,
  type Difficulty,
  type ResolvedRule,
  type RuleProgressState,
} from './types.ts';

export const DEFAULT_BASE_SCORE = 100;

export function calculateUnitBonus(
  baseBonus: number,
  difficulty: Difficulty,
): number {
  const positiveBase = Math.max(0, baseBonus);
  if (positiveBase === 0) return 0;
  return Math.round(positiveBase * DIFFICULTY_WEIGHTS[difficulty].bonus);
}

export function calculateUnitPenalty(
  basePenalty: number,
  difficulty: Difficulty,
): number {
  const absPenalty = Math.abs(basePenalty);
  if (absPenalty === 0) return 0;
  return -Math.round(absPenalty * DIFFICULTY_WEIGHTS[difficulty].penalty);
}

export function calculateTotalScore(
  baseScore: number,
  progress: Record<string, RuleProgressState> | readonly RuleProgressState[],
): number {
  const entries = Array.isArray(progress)
    ? progress
    : Object.values(progress);
  const deltaSum = entries.reduce((sum, item) => sum + item.scoreDelta, 0);
  return baseScore + deltaSum;
}

export interface ScoreBreakdown {
  baseScore: number;
  totalBonus: number;
  totalPenalty: number;
  netDelta: number;
  totalScore: number;
  perRule: Array<{
    ruleId: string;
    title: string;
    bonusPoints: number;
    penaltyPoints: number;
    scoreDelta: number;
  }>;
}

export function summarizeScoreBreakdown(
  baseScore: number,
  rules: readonly ResolvedRule[],
  progress: Record<string, RuleProgressState>,
): ScoreBreakdown {
  let totalBonus = 0;
  let totalPenalty = 0;

  const perRule = rules.map((rule) => {
    const state = progress[rule.ruleId];
    const bonusPoints = state ? state.bonusCount * rule.unitBonus : 0;
    const penaltyPoints = state ? state.penaltyCount * rule.unitPenalty : 0;
    const scoreDelta = state ? state.scoreDelta : 0;
    totalBonus += bonusPoints;
    totalPenalty += penaltyPoints;
    return {
      ruleId: rule.ruleId,
      title: rule.title,
      bonusPoints,
      penaltyPoints,
      scoreDelta,
    };
  });

  const netDelta = perRule.reduce((sum, item) => sum + item.scoreDelta, 0);

  return {
    baseScore,
    totalBonus,
    totalPenalty,
    netDelta,
    totalScore: baseScore + netDelta,
    perRule,
  };
}
