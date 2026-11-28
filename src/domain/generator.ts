import {
  DIFFICULTY_LABELS,
  DIFFICULTY_RANK,
  type Difficulty,
  type GeneratedSession,
  type ResolvedRule,
  type RuleCount,
  type RuleDefinition,
  type RuleEvaluatorConfig,
  type RuleParams,
  type RuleProgressState,
  type SessionConfig,
  type SessionHandoffHint,
} from './types.ts';
import {
  DEFAULT_BASE_SCORE,
  calculateTotalScore,
  calculateUnitBonus,
  calculateUnitPenalty,
} from './scorer.ts';

export const SESSION_SCHEMA_VERSION = 1;
export const APP_VERSION = '0.1.0';

export function interpolateTemplate(
  template: string,
  params: RuleParams,
): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => {
    const value = params[key];
    return value !== undefined ? String(value) : match;
  });
}

function resolveEvaluatorConfig(
  evaluator: RuleEvaluatorConfig,
  params: RuleParams,
): RuleEvaluatorConfig {
  switch (evaluator.kind) {
    case 'manual':
      return { ...evaluator };
    case 'counter': {
      const resolved = { ...evaluator };
      if (
        resolved.targetCountParam &&
        typeof params[resolved.targetCountParam] === 'number'
      ) {
        resolved.targetCount = params[resolved.targetCountParam] as number;
      }
      if (
        resolved.maxAllowedCountParam &&
        typeof params[resolved.maxAllowedCountParam] === 'number'
      ) {
        resolved.maxAllowedCount = params[
          resolved.maxAllowedCountParam
        ] as number;
      }
      return resolved;
    }
    case 'location_check':
      return { ...evaluator };
    case 'session_rule': {
      const resolved = { ...evaluator };
      if (
        resolved.maxDurationMinutesParam &&
        typeof params[resolved.maxDurationMinutesParam] === 'number'
      ) {
        resolved.maxDurationMinutes = params[
          resolved.maxDurationMinutesParam
        ] as number;
      }
      return resolved;
    }
  }
}

export function resolveRule(
  def: RuleDefinition,
  difficulty: Difficulty,
  pinned = false,
): ResolvedRule {
  const params: RuleParams = {
    ...(def.paramsByDifficulty?.[difficulty] ?? {}),
  };

  return {
    ruleId: def.id,
    title: interpolateTemplate(def.title, params),
    hintTitle: interpolateTemplate(def.hintTitle, params),
    description: interpolateTemplate(def.description, params),
    category: def.category,
    familiarity: def.familiarity,
    scoringType: def.scoringType,
    unitBonus: calculateUnitBonus(def.baseBonus, difficulty),
    unitPenalty: calculateUnitPenalty(def.basePenalty, difficulty),
    evaluator: resolveEvaluatorConfig(def.evaluator, params),
    pinned,
    params,
    tags: def.tags ? [...def.tags] : undefined,
    handoffHint: def.handoffHint,
  };
}

export function createInitialProgress(ruleId: string): RuleProgressState {
  return {
    ruleId,
    bonusCount: 0,
    penaltyCount: 0,
    counterValue: 0,
    scoreDelta: 0,
    evaluated: false,
    history: [],
  };
}

function hasExclusionConflict(
  candidate: RuleDefinition,
  selectedDefs: readonly RuleDefinition[],
): boolean {
  return selectedDefs.some(
    (selected) =>
      selected.id === candidate.id ||
      candidate.excludes.includes(selected.id) ||
      selected.excludes.includes(candidate.id),
  );
}

function hasCategoryConflict(
  candidate: RuleDefinition,
  selectedDefs: readonly RuleDefinition[],
): boolean {
  return selectedDefs.some((selected) => selected.category === candidate.category);
}

function pickRandom<T>(items: readonly T[], rng: () => number): T | undefined {
  if (items.length === 0) return undefined;
  const idx = Math.floor(Math.min(0.9999999, Math.max(0, rng())) * items.length);
  return items[idx];
}

export interface DrawRulesOptions {
  config: SessionConfig;
  pinnedRules?: readonly ResolvedRule[];
  recentRuleIds?: readonly string[];
  excludeRuleIds?: readonly string[];
  rng?: () => number;
}

export function drawRules(
  allRules: readonly RuleDefinition[],
  options: DrawRulesOptions,
): ResolvedRule[] {
  const {
    config,
    pinnedRules = [],
    recentRuleIds = [],
    excludeRuleIds = [],
    rng = Math.random,
  } = options;

  const defMap = new Map(allRules.map((rule) => [rule.id, rule]));
  const recentSet = new Set(recentRuleIds);
  const excludeSet = new Set(excludeRuleIds);

  const selectedDefs: RuleDefinition[] = [];
  const result: ResolvedRule[] = [];

  for (const pinned of pinnedRules) {
    if (result.length >= config.ruleCount) break;
    const def = defMap.get(pinned.ruleId);
    if (!def) continue;
    if (hasExclusionConflict(def, selectedDefs)) continue;
    selectedDefs.push(def);
    result.push(resolveRule(def, config.difficulty, true));
  }

  const eligiblePool = allRules.filter((rule) => {
    if (excludeSet.has(rule.id)) return false;
    if (DIFFICULTY_RANK[rule.minDifficulty] > DIFFICULTY_RANK[config.difficulty]) {
      return false;
    }
    if (!rule.supportedModes.includes(config.walkMode)) return false;
    if (config.excludedCategories.includes(rule.category)) return false;
    return true;
  });

  while (result.length < config.ruleCount) {
    const nonConflicting = eligiblePool.filter(
      (candidate) => !hasExclusionConflict(candidate, selectedDefs),
    );
    if (nonConflicting.length === 0) break;

    const uniqueCategory = nonConflicting.filter(
      (candidate) => !hasCategoryConflict(candidate, selectedDefs),
    );
    const freshUniqueCategory = uniqueCategory.filter(
      (candidate) => !recentSet.has(candidate.id),
    );
    const freshFallback = nonConflicting.filter(
      (candidate) => !recentSet.has(candidate.id),
    );

    const candidates =
      freshUniqueCategory.length > 0
        ? freshUniqueCategory
        : uniqueCategory.length > 0
          ? uniqueCategory
          : freshFallback.length > 0
            ? freshFallback
            : nonConflicting;

    const picked = pickRandom(candidates, rng);
    if (!picked) break;

    selectedDefs.push(picked);
    result.push(resolveRule(picked, config.difficulty, false));
  }

  return result;
}

export function rerollSingleRule(
  allRules: readonly RuleDefinition[],
  currentRules: readonly ResolvedRule[],
  targetIndex: number,
  options: Omit<DrawRulesOptions, 'pinnedRules' | 'excludeRuleIds'>,
): ResolvedRule[] {
  if (targetIndex < 0 || targetIndex >= currentRules.length) {
    return [...currentRules];
  }
  const target = currentRules[targetIndex];
  if (target.pinned) {
    return [...currentRules];
  }

  const otherRules = currentRules.filter((_, idx) => idx !== targetIndex);
  const pinnedTemporarily = otherRules.map((rule) => ({
    ...rule,
    pinned: true,
  }));

  const drawn = drawRules(allRules, {
    ...options,
    config: {
      ...options.config,
      ruleCount: currentRules.length as RuleCount,
    },
    pinnedRules: pinnedTemporarily,
    excludeRuleIds: [target.ruleId],
  });

  const replacement = drawn.find(
    (rule) => !otherRules.some((other) => other.ruleId === rule.ruleId),
  );
  if (!replacement) {
    return [...currentRules];
  }

  const next = [...currentRules];
  next[targetIndex] = { ...replacement, pinned: false };
  return next;
}

export function buildHandoffHint(
  config: SessionConfig,
  rules: readonly ResolvedRule[],
  totalScore: number,
): SessionHandoffHint {
  const tagSet = new Set<string>();
  const hints: string[] = [];

  for (const rule of rules) {
    rule.tags?.forEach((tag) => tagSet.add(tag));
    if (rule.handoffHint) {
      hints.push(rule.handoffHint);
    }
  }

  return {
    sourceApp: 'sanpo-quests',
    version: APP_VERSION,
    difficulty: config.difficulty,
    revealMode: config.revealMode,
    walkMode: config.walkMode,
    ruleIds: rules.map((r) => r.ruleId),
    ruleTags: Array.from(tagSet),
    hints,
    summary: `難易度:${DIFFICULTY_LABELS[config.difficulty]} / 縛り${rules.length}件 / スコア:${totalScore}pt`,
  };
}

export interface CreateSessionOptions extends DrawRulesOptions {
  id?: string;
  nowIso?: string;
  baseScore?: number;
}

export function createGeneratedSession(
  allRules: readonly RuleDefinition[],
  options: CreateSessionOptions,
): GeneratedSession {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const id =
    options.id ??
    `sq-${Date.now().toString(36)}-${Math.floor((options.rng ?? Math.random)() * 10000).toString(36)}`;
  const baseScore = options.baseScore ?? DEFAULT_BASE_SCORE;
  const rules = drawRules(allRules, options);

  const progress: Record<string, RuleProgressState> = {};
  for (const rule of rules) {
    progress[rule.ruleId] = createInitialProgress(rule.ruleId);
  }

  const totalScore = calculateTotalScore(baseScore, progress);

  return {
    id,
    schemaVersion: SESSION_SCHEMA_VERSION,
    createdAt: nowIso,
    status: 'draft',
    config: {
      ...options.config,
      excludedCategories: [...options.config.excludedCategories],
    },
    baseScore,
    rules,
    progress,
    memo: '',
    totalScore,
    handoffHint: buildHandoffHint(options.config, rules, totalScore),
  };
}
