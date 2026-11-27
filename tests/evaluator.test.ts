import { describe, expect, it } from 'vitest';
import rulesJson from '../src/data/rules.json';
import {
  calculateHaversineDistanceMeters,
  evaluateRuleEvent,
  evaluateSessionCompletion,
} from '../src/domain/evaluator.ts';
import {
  createGeneratedSession,
  createInitialProgress,
  resolveRule,
} from '../src/domain/generator.ts';
import type { FamiliarSpot, RuleDefinition } from '../src/domain/types.ts';

const ALL_RULES = rulesJson as RuleDefinition[];

function getRule(id: string): RuleDefinition {
  const found = ALL_RULES.find((r) => r.id === id);
  if (!found) throw new Error(`Rule not found: ${id}`);
  return found;
}

describe('manual evaluator & undo', () => {
  it('applies bonus up to maxBonusApplications and rolls back with UNDO_LAST', () => {
    const rule = resolveRule(getRule('waypoint-bakery-stop'), 'standard');
    let state = createInitialProgress(rule.ruleId);

    state = evaluateRuleEvent(rule, state, {
      type: 'MARK_BONUS',
      timestamp: '2026-11-28T01:10:00Z',
    });
    expect(state.bonusCount).toBe(1);
    expect(state.scoreDelta).toBe(25);

    state = evaluateRuleEvent(rule, state, {
      type: 'MARK_BONUS',
      timestamp: '2026-11-28T01:20:00Z',
    });
    expect(state.bonusCount).toBe(2);
    expect(state.scoreDelta).toBe(50);

    // maxBonusApplications is 2 -> 3rd call is ignored
    const capped = evaluateRuleEvent(rule, state, {
      type: 'MARK_BONUS',
      timestamp: '2026-11-28T01:30:00Z',
    });
    expect(capped.bonusCount).toBe(2);
    expect(capped.scoreDelta).toBe(50);

    // Undo restores 1 step
    const undone = evaluateRuleEvent(rule, capped, { type: 'UNDO_LAST' });
    expect(undone.bonusCount).toBe(1);
    expect(undone.scoreDelta).toBe(25);
    expect(undone.history).toHaveLength(1);
  });

  it('supports hybrid bonus and penalty on manual rules', () => {
    const rule = resolveRule(getRule('route-no-main-road'), 'hard');
    let state = createInitialProgress(rule.ruleId);

    // hard: baseBonus 35 * 1.4 = 49, basePenalty 20 * 1.5 = -30
    state = evaluateRuleEvent(rule, state, { type: 'MARK_PENALTY' });
    state = evaluateRuleEvent(rule, state, { type: 'MARK_BONUS' });
    expect(state.penaltyCount).toBe(1);
    expect(state.bonusCount).toBe(1);
    expect(state.scoreDelta).toBe(49 - 30);
  });
});

describe('counter evaluator', () => {
  it('auto-applies penalty for every count exceeding maxAllowedCount', () => {
    // hard: maxStops = 2, basePenalty 15 * 1.5 = -23
    const rule = resolveRule(getRule('constraint-max-stops'), 'hard');
    let state = createInitialProgress(rule.ruleId);

    state = evaluateRuleEvent(rule, state, { type: 'INCREMENT_COUNTER' });
    state = evaluateRuleEvent(rule, state, { type: 'INCREMENT_COUNTER' });
    expect(state.counterValue).toBe(2);
    expect(state.penaltyCount).toBe(0);
    expect(state.scoreDelta).toBe(0);

    // 3rd stop exceeds maxAllowedCount (2) -> -23pt
    state = evaluateRuleEvent(rule, state, { type: 'INCREMENT_COUNTER' });
    expect(state.counterValue).toBe(3);
    expect(state.penaltyCount).toBe(1);
    expect(state.scoreDelta).toBe(-23);

    // 4th stop -> another -23pt
    state = evaluateRuleEvent(rule, state, { type: 'INCREMENT_COUNTER' });
    expect(state.counterValue).toBe(4);
    expect(state.penaltyCount).toBe(2);
    expect(state.scoreDelta).toBe(-46);

    // Undo rolls back count and penalty
    state = evaluateRuleEvent(rule, state, { type: 'UNDO_LAST' });
    expect(state.counterValue).toBe(3);
    expect(state.penaltyCount).toBe(1);
    expect(state.scoreDelta).toBe(-23);
  });

  it('auto-applies bonus once targetCount is reached', () => {
    // standard: targetBlocks = 3, unitBonus = 40
    const rule = resolveRule(getRule('time-area-unexplored-blocks'), 'standard');
    let state = createInitialProgress(rule.ruleId);

    state = evaluateRuleEvent(rule, state, { type: 'INCREMENT_COUNTER' });
    state = evaluateRuleEvent(rule, state, { type: 'INCREMENT_COUNTER' });
    expect(state.bonusCount).toBe(0);
    expect(state.scoreDelta).toBe(0);

    state = evaluateRuleEvent(rule, state, { type: 'INCREMENT_COUNTER' });
    expect(state.bonusCount).toBe(1);
    expect(state.scoreDelta).toBe(40);

    // 4th increment does not double-award bonus (maxBonusApplications = 1)
    state = evaluateRuleEvent(rule, state, { type: 'INCREMENT_COUNTER' });
    expect(state.counterValue).toBe(4);
    expect(state.bonusCount).toBe(1);
    expect(state.scoreDelta).toBe(40);
  });
});

describe('location_check evaluator & Haversine', () => {
  const shibuya: FamiliarSpot = {
    id: 'spot-shibuya',
    name: '渋谷駅',
    lat: 35.658034,
    lng: 139.701636,
    radiusMeters: 300,
  };

  it('computes Haversine distance accurately', () => {
    const tokyo = { lat: 35.681236, lng: 139.767125 };
    const distance = calculateHaversineDistanceMeters(tokyo, shibuya);
    // Straight-line distance between Tokyo Station and Shibuya Station is ~6.45 km
    expect(distance).toBeGreaterThan(6200);
    expect(distance).toBeLessThan(6700);
  });

  it('penalizes when inside radius and rewards when outside for triggerWhen=near', () => {
    const rule = resolveRule(getRule('time-area-avoid-familiar'), 'standard');
    let state = createInitialProgress(rule.ruleId);

    // Inside 300m of Shibuya (~100m away)
    state = evaluateRuleEvent(rule, state, {
      type: 'LOCATION_CHECK',
      point: { lat: 35.6589, lng: 139.7016 },
      familiarSpots: [shibuya],
    });
    expect(state.penaltyCount).toBe(1);
    expect(state.scoreDelta).toBe(-25);

    // Outside 300m (~1km away)
    state = evaluateRuleEvent(rule, state, {
      type: 'LOCATION_CHECK',
      point: { lat: 35.667, lng: 139.7016 },
      familiarSpots: [shibuya],
    });
    expect(state.bonusCount).toBe(1);
    expect(state.scoreDelta).toBe(0);
  });

  it('rewards when outside radius for triggerWhen=away', () => {
    const rule = resolveRule(getRule('time-area-familiar-away'), 'standard');
    let state = createInitialProgress(rule.ruleId);

    // Inside spot radius -> no bonus
    state = evaluateRuleEvent(rule, state, {
      type: 'LOCATION_CHECK',
      point: { lat: 35.6582, lng: 139.7017 },
      familiarSpots: [shibuya],
    });
    expect(state.bonusCount).toBe(0);
    expect(state.scoreDelta).toBe(0);

    // Far away -> bonus
    state = evaluateRuleEvent(rule, state, {
      type: 'LOCATION_CHECK',
      point: { lat: 35.67, lng: 139.71 },
      familiarSpots: [shibuya],
    });
    expect(state.bonusCount).toBe(1);
    expect(state.scoreDelta).toBe(35);
  });
});

describe('session_rule evaluator', () => {
  it('awards bonus when finished within maxDurationMinutes and penalizes when overtime', () => {
    // standard: maxMinutes = 60, unitBonus = 35, unitPenalty = -20
    const rule = resolveRule(getRule('time-area-time-limit'), 'standard');

    const onTime = evaluateRuleEvent(rule, createInitialProgress(rule.ruleId), {
      type: 'COMPLETE_SESSION',
      elapsedMinutes: 48,
      completed: true,
    });
    expect(onTime.bonusCount).toBe(1);
    expect(onTime.scoreDelta).toBe(35);

    const overtime = evaluateRuleEvent(
      rule,
      createInitialProgress(rule.ruleId),
      {
        type: 'COMPLETE_SESSION',
        elapsedMinutes: 72,
        completed: true,
      },
    );
    expect(overtime.penaltyCount).toBe(1);
    expect(overtime.scoreDelta).toBe(-20);
  });

  it('auto-evaluates session_rule entries in evaluateSessionCompletion', () => {
    const timeLimitDef = getRule('time-area-time-limit');
    const session = createGeneratedSession([timeLimitDef], {
      config: {
        ruleCount: 1,
        difficulty: 'standard',
        revealMode: 'blind_secret',
        walkMode: 'solo',
        excludedCategories: [],
      },
      nowIso: '2026-11-28T01:00:00.000Z',
    });
    const active = {
      ...session,
      status: 'active' as const,
      startedAt: '2026-11-28T01:00:00.000Z',
    };

    const finished = evaluateSessionCompletion(
      active,
      '2026-11-28T01:45:00.000Z',
      true,
    );
    expect(finished.status).toBe('completed');
    expect(finished.totalScore).toBe(135);
    expect(finished.progress[timeLimitDef.id].bonusCount).toBe(1);
  });
});
