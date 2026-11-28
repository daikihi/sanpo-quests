import { describe, expect, it } from 'vitest';
import rulesJson from '../src/data/rules.json';
import {
  createGeneratedSession,
  drawRules,
  interpolateTemplate,
  rerollSingleRule,
  resolveRule,
} from '../src/domain/generator.ts';
import {
  calculateTotalScore,
  calculateUnitBonus,
  calculateUnitPenalty,
  summarizeScoreBreakdown,
} from '../src/domain/scorer.ts';
import type { RuleDefinition, SessionConfig } from '../src/domain/types.ts';

const ALL_RULES = rulesJson as RuleDefinition[];

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('scorer difficulty weights', () => {
  it('applies asymmetric bonus and penalty weights for light, standard, and hard', () => {
    // light: bonus * 0.8, penalty * 0.6
    expect(calculateUnitBonus(25, 'light')).toBe(20);
    expect(calculateUnitPenalty(25, 'light')).toBe(-15);

    // standard: bonus * 1.0, penalty * 1.0
    expect(calculateUnitBonus(25, 'standard')).toBe(25);
    expect(calculateUnitPenalty(25, 'standard')).toBe(-25);

    // hard: bonus * 1.4, penalty * 1.5
    expect(calculateUnitBonus(25, 'hard')).toBe(35);
    expect(calculateUnitPenalty(25, 'hard')).toBe(-38);
  });

  it('handles zero base points and negative basePenalty safely', () => {
    expect(calculateUnitBonus(0, 'hard')).toBe(0);
    expect(calculateUnitPenalty(0, 'hard')).toBe(0);
    expect(calculateUnitPenalty(-20, 'hard')).toBe(-30);
  });
});

describe('generator template interpolation & resolution', () => {
  it('interpolates template variables in title, description, and evaluator params', () => {
    expect(interpolateTemplate('立ち寄り {maxStops} 箇所', { maxStops: 2 })).toBe(
      '立ち寄り 2 箇所',
    );

    const maxStopsRule = ALL_RULES.find((r) => r.id === 'constraint-max-stops');
    expect(maxStopsRule).toBeDefined();

    const lightResolved = resolveRule(maxStopsRule!, 'light');
    expect(lightResolved.title).toContain('4');
    expect(lightResolved.evaluator.kind).toBe('counter');
    if (lightResolved.evaluator.kind === 'counter') {
      expect(lightResolved.evaluator.maxAllowedCount).toBe(4);
    }

    const hardResolved = resolveRule(maxStopsRule!, 'hard');
    expect(hardResolved.title).toContain('2');
    expect(hardResolved.unitPenalty).toBe(-23);
    if (hardResolved.evaluator.kind === 'counter') {
      expect(hardResolved.evaluator.maxAllowedCount).toBe(2);
    }
  });
});

describe('drawRules constraints and pinning', () => {
  it('prevents duplicate categories and respects excludedCategories & walkMode', () => {
    const config: SessionConfig = {
      ruleCount: 3,
      difficulty: 'standard',
      revealMode: 'open',
      walkMode: 'solo',
      excludedCategories: ['pace_style'],
    };

    for (let seed = 1; seed <= 25; seed++) {
      const drawn = drawRules(ALL_RULES, {
        config,
        rng: createSeededRng(seed),
      });
      expect(drawn).toHaveLength(3);

      const categories = new Set(drawn.map((r) => r.category));
      expect(categories.size).toBe(3);
      expect(categories.has('pace_style')).toBe(false);
      expect(drawn.some((r) => r.ruleId === 'pace-pair-turn-taking')).toBe(
        false,
      );
    }
  });

  it('respects minDifficulty filtering', () => {
    const config: SessionConfig = {
      ruleCount: 3,
      difficulty: 'light',
      revealMode: 'open',
      walkMode: 'solo',
      excludedCategories: [],
    };
    const defMap = new Map(ALL_RULES.map((r) => [r.id, r]));

    for (let seed = 1; seed <= 30; seed++) {
      const drawn = drawRules(ALL_RULES, {
        config,
        rng: createSeededRng(seed),
      });
      for (const rule of drawn) {
        expect(defMap.get(rule.ruleId)?.minDifficulty).toBe('light');
      }
    }
  });

  it('enforces mutual excludes including against pinned rules', () => {
    const pinnedDef = ALL_RULES.find(
      (r) => r.id === 'time-area-unexplored-blocks',
    )!;
    const pinned = resolveRule(pinnedDef, 'standard', true);

    const config: SessionConfig = {
      ruleCount: 3,
      difficulty: 'standard',
      revealMode: 'open',
      walkMode: 'solo',
      excludedCategories: [],
    };

    for (let seed = 1; seed <= 30; seed++) {
      const drawn = drawRules(ALL_RULES, {
        config,
        pinnedRules: [pinned],
        rng: createSeededRng(seed),
      });

      expect(drawn[0].ruleId).toBe('time-area-unexplored-blocks');
      expect(drawn[0].pinned).toBe(true);

      const ids = new Set(drawn.map((r) => r.ruleId));
      // excludes of time-area-unexplored-blocks: time-area-familiar-away, waypoint-familiar-new-shop
      expect(ids.has('time-area-familiar-away')).toBe(false);
      expect(ids.has('waypoint-familiar-new-shop')).toBe(false);
    }
  });

  it('suppresses recently drawn rules when fresh candidates exist', () => {
    const config: SessionConfig = {
      ruleCount: 2,
      difficulty: 'standard',
      revealMode: 'open',
      walkMode: 'solo',
      excludedCategories: [],
    };

    const recentRuleIds = [
      'waypoint-bakery-stop',
      'route-no-main-road',
      'constraint-max-stops',
    ];

    for (let seed = 1; seed <= 20; seed++) {
      const drawn = drawRules(ALL_RULES, {
        config,
        recentRuleIds,
        rng: createSeededRng(seed),
      });
      for (const rule of drawn) {
        expect(recentRuleIds).not.toContain(rule.ruleId);
      }
    }
  });

  it('rerolls only an unpinned slot and keeps pinned slots unchanged', () => {
    const config: SessionConfig = {
      ruleCount: 3,
      difficulty: 'standard',
      revealMode: 'open',
      walkMode: 'solo',
      excludedCategories: [],
    };

    const initial = drawRules(ALL_RULES, {
      config,
      rng: createSeededRng(42),
    });
    const withPinned = initial.map((r, i) => ({ ...r, pinned: i === 0 }));

    // Pinned index stays identical
    const unchanged = rerollSingleRule(ALL_RULES, withPinned, 0, {
      config,
      rng: createSeededRng(99),
    });
    expect(unchanged[0].ruleId).toBe(withPinned[0].ruleId);

    // Unpinned index gets replaced with a different rule
    const rerolled = rerollSingleRule(ALL_RULES, withPinned, 1, {
      config,
      rng: createSeededRng(99),
    });
    expect(rerolled[0].ruleId).toBe(withPinned[0].ruleId);
    expect(rerolled[2].ruleId).toBe(withPinned[2].ruleId);
    expect(rerolled[1].ruleId).not.toBe(withPinned[1].ruleId);
    expect(rerolled[1].pinned).toBe(false);
  });

  it('creates a GeneratedSession with initialized progress and totalScore', () => {
    const session = createGeneratedSession(ALL_RULES, {
      config: {
        ruleCount: 2,
        difficulty: 'hard',
        revealMode: 'blind_secret',
        walkMode: 'pair',
        excludedCategories: [],
      },
      rng: createSeededRng(7),
      nowIso: '2026-11-28T01:00:00.000Z',
    });

    expect(session.rules).toHaveLength(2);
    expect(session.baseScore).toBe(100);
    expect(session.totalScore).toBe(100);
    expect(session.handoffHint.sourceApp).toBe('sanpo-quests');
    expect(session.handoffHint.ruleIds).toEqual(
      session.rules.map((r) => r.ruleId),
    );

    const breakdown = summarizeScoreBreakdown(
      session.baseScore,
      session.rules,
      session.progress,
    );
    expect(breakdown.totalScore).toBe(
      calculateTotalScore(session.baseScore, session.progress),
    );
  });

  it('draws up to 8 non-conflicting rules for challenger mode', () => {
    const config: SessionConfig = {
      ruleCount: 8,
      difficulty: 'hard',
      revealMode: 'open',
      walkMode: 'solo',
      excludedCategories: [],
    };
    const defMap = new Map(ALL_RULES.map((r) => [r.id, r]));

    for (let seed = 1; seed <= 15; seed++) {
      const drawn = drawRules(ALL_RULES, {
        config,
        rng: createSeededRng(seed),
      });
      expect(drawn).toHaveLength(8);
      const ids = new Set(drawn.map((r) => r.ruleId));
      expect(ids.size).toBe(8);

      // Verify mutual excludes are still respected even beyond 5 categories
      for (const rule of drawn) {
        const def = defMap.get(rule.ruleId)!;
        for (const excludedId of def.excludes) {
          expect(ids.has(excludedId)).toBe(false);
        }
      }
    }
  });
});
