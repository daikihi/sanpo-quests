import { describe, expect, it } from 'vitest';
import rulesJson from '../src/data/rules.json';
import { createGeneratedSession } from '../src/domain/generator.ts';
import { evaluateRuleEvent } from '../src/domain/evaluator.ts';
import { calculateTotalScore } from '../src/domain/scorer.ts';
import type { FamiliarSpot, RuleDefinition } from '../src/domain/types.ts';
import {
  appendCompletedSession,
  clearActiveSession,
  createMemoryStorage,
  deleteCustomRule,
  deleteFamiliarSpot,
  deleteSessionFromHistory,
  exportSessionJson,
  formatWalkMemoText,
  importSessionJson,
  loadActiveSession,
  loadCustomRules,
  loadFamiliarSpots,
  loadRecentRuleIds,
  loadSessionHistory,
  recordRecentRuleIds,
  saveActiveSession,
  upsertCustomRule,
  upsertFamiliarSpot,
} from '../src/storage/localStore.ts';

const ALL_RULES = rulesJson as RuleDefinition[];

describe('localStore session & history persistence', () => {
  it('saves, loads, and clears the active session', () => {
    const storage = createMemoryStorage();
    const session = createGeneratedSession(ALL_RULES, {
      id: 'session-active-1',
      config: {
        ruleCount: 2,
        difficulty: 'standard',
        revealMode: 'open',
        walkMode: 'solo',
        excludedCategories: [],
      },
      nowIso: '2026-11-28T02:00:00.000Z',
      rng: () => 0.2,
    });

    saveActiveSession(session, storage);
    const loaded = loadActiveSession(storage);
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe('session-active-1');
    expect(loaded?.rules).toHaveLength(2);

    clearActiveSession(storage);
    expect(loadActiveSession(storage)).toBeNull();
  });

  it('appends completed sessions without duplicating IDs and supports deletion', () => {
    const storage = createMemoryStorage();
    const s1 = createGeneratedSession(ALL_RULES, {
      id: 'hist-1',
      config: {
        ruleCount: 1,
        difficulty: 'light',
        revealMode: 'open',
        walkMode: 'solo',
        excludedCategories: [],
      },
      rng: () => 0.1,
    });
    const s2 = createGeneratedSession(ALL_RULES, {
      id: 'hist-2',
      config: {
        ruleCount: 1,
        difficulty: 'hard',
        revealMode: 'blind_secret',
        walkMode: 'pair',
        excludedCategories: [],
      },
      rng: () => 0.5,
    });

    appendCompletedSession({ ...s1, status: 'completed' }, storage);
    appendCompletedSession({ ...s2, status: 'completed' }, storage);
    appendCompletedSession({ ...s1, status: 'completed', memo: 'updated' }, storage);

    const history = loadSessionHistory(storage);
    expect(history.map((h) => h.id)).toEqual(['hist-1', 'hist-2']);
    expect(history[0].memo).toBe('updated');

    deleteSessionFromHistory('hist-1', storage);
    expect(loadSessionHistory(storage).map((h) => h.id)).toEqual(['hist-2']);
  });

  it('tracks recent rule IDs with deduplication and max cap', () => {
    const storage = createMemoryStorage();
    recordRecentRuleIds(['a', 'b', 'c'], storage, 4);
    recordRecentRuleIds(['c', 'd', 'e'], storage, 4);
    expect(loadRecentRuleIds(storage)).toEqual(['c', 'd', 'e', 'a']);
  });
});

describe('localStore FamiliarSpot CRUD', () => {
  it('creates, updates, and deletes familiar spots', () => {
    const storage = createMemoryStorage();
    const spot: FamiliarSpot = {
      id: 'spot-1',
      name: '最寄り駅',
      lat: 35.658,
      lng: 139.701,
      radiusMeters: 300,
    };

    upsertFamiliarSpot(spot, storage);
    expect(loadFamiliarSpots(storage)).toHaveLength(1);

    upsertFamiliarSpot({ ...spot, name: '渋谷駅', radiusMeters: 450 }, storage);
    const updated = loadFamiliarSpots(storage);
    expect(updated).toHaveLength(1);
    expect(updated[0].name).toBe('渋谷駅');
    expect(updated[0].radiusMeters).toBe(450);

    deleteFamiliarSpot('spot-1', storage);
    expect(loadFamiliarSpots(storage)).toHaveLength(0);
  });
});

describe('localStore custom rules CRUD', () => {
  it('creates, updates, and deletes custom rules', () => {
    const storage = createMemoryStorage();
    const custom: RuleDefinition = {
      id: 'custom-croquette',
      title: '商店街でコロッケを買う',
      hintTitle: '揚げたての誘惑',
      description: '商店街の精肉店や惣菜屋でコロッケを1つ買う。',
      category: 'waypoint',
      familiarity: 'any',
      scoringType: 'bonus',
      baseBonus: 30,
      basePenalty: 0,
      minDifficulty: 'light',
      supportedModes: ['solo', 'pair'],
      excludes: [],
      evaluator: { kind: 'manual', bonusLabel: 'コロッケを購入' },
    };

    upsertCustomRule(custom, storage);
    expect(loadCustomRules(storage)).toHaveLength(1);
    expect(loadCustomRules(storage)[0].tags).toContain('custom');

    upsertCustomRule({ ...custom, baseBonus: 40 }, storage);
    expect(loadCustomRules(storage)[0].baseBonus).toBe(40);

    deleteCustomRule('custom-croquette', storage);
    expect(loadCustomRules(storage)).toHaveLength(0);
  });
});

describe('walk memo formatter and JSON import/export', () => {
  it('formats walk memo text and round-trips JSON export/import with handoffHint', () => {
    const bakery = ALL_RULES.find((r) => r.id === 'waypoint-bakery-stop')!;
    const session = createGeneratedSession([bakery], {
      id: 'export-test-1',
      config: {
        ruleCount: 1,
        difficulty: 'standard',
        revealMode: 'open',
        walkMode: 'solo',
        excludedCategories: [],
      },
      nowIso: '2026-11-28T03:00:00.000Z',
    });

    const updatedProgress = {
      ...session.progress,
      [bakery.id]: evaluateRuleEvent(
        session.rules[0],
        session.progress[bakery.id],
        { type: 'MARK_BONUS' },
      ),
    };
    const finalSession = {
      ...session,
      status: 'completed' as const,
      completedAt: '2026-11-28T03:45:00.000Z',
      progress: updatedProgress,
      totalScore: calculateTotalScore(session.baseScore, updatedProgress),
      memo: 'メロンパンが美味しかった',
    };

    const memoText = formatWalkMemoText(finalSession);
    expect(memoText).toContain('【Sanpo Quests 散歩メモ】');
    expect(memoText).toContain('パン屋に立ち寄る');
    expect(memoText).toContain('125pt');
    expect(memoText).toContain('メロンパンが美味しかった');

    const json = exportSessionJson(finalSession);
    const imported = importSessionJson(json);
    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.session.id).toBe('export-test-1');
      expect(imported.session.totalScore).toBe(125);
      expect(imported.session.handoffHint.sourceApp).toBe('sanpo-quests');
      expect(imported.session.handoffHint.hints).toContain('bakery-stop');
    }
  });

  it('rejects malformed or incomplete JSON payloads', () => {
    expect(importSessionJson('{invalid json').ok).toBe(false);
    expect(importSessionJson(JSON.stringify({ id: 'x' })).ok).toBe(false);
    expect(
      importSessionJson(
        JSON.stringify({
          id: 'x',
          config: {
            ruleCount: 99,
            difficulty: 'standard',
            revealMode: 'open',
            walkMode: 'solo',
            excludedCategories: [],
          },
          rules: [],
        }),
      ).ok,
    ).toBe(false);
  });
});
