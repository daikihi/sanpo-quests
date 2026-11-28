import {
  DIFFICULTY_LABELS,
  MAX_RULE_COUNT,
  MIN_RULE_COUNT,
  REVEAL_MODE_LABELS,
  WALK_MODE_LABELS,
  type Difficulty,
  type FamiliarSpot,
  type GeneratedSession,
  type RevealMode,
  type RuleCategory,
  type RuleDefinition,
  type SessionConfig,
  type WalkMode,
} from '../domain/types.ts';
import {
  SESSION_SCHEMA_VERSION,
  buildHandoffHint,
  createInitialProgress,
} from '../domain/generator.ts';
import { calculateTotalScore } from '../domain/scorer.ts';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const STORAGE_KEYS = {
  ACTIVE_SESSION: 'sanpo-quests:active-session',
  SESSION_HISTORY: 'sanpo-quests:session-history',
  RECENT_RULE_IDS: 'sanpo-quests:recent-rule-ids',
  FAMILIAR_SPOTS: 'sanpo-quests:familiar-spots',
  CUSTOM_RULES: 'sanpo-quests:custom-rules',
  LAST_CONFIG: 'sanpo-quests:last-config',
} as const;

const MAX_HISTORY_ITEMS = 50;
const MAX_RECENT_RULE_IDS = 12;

export function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

const fallbackMemoryStorage = createMemoryStorage();

function resolveStorage(storage?: StorageLike): StorageLike {
  if (storage) return storage;
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Restricted storage context
  }
  return fallbackMemoryStorage;
}

function readJson<T>(storage: StorageLike, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(storage: StorageLike, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors cleanly
  }
}

// --- Active Session ---

export function saveActiveSession(
  session: GeneratedSession,
  storage?: StorageLike,
): void {
  writeJson(resolveStorage(storage), STORAGE_KEYS.ACTIVE_SESSION, session);
}

export function loadActiveSession(
  storage?: StorageLike,
): GeneratedSession | null {
  const raw = readJson<unknown>(
    resolveStorage(storage),
    STORAGE_KEYS.ACTIVE_SESSION,
    null,
  );
  if (!raw) return null;
  const validated = validateSessionObject(raw);
  return validated.ok ? validated.session : null;
}

export function clearActiveSession(storage?: StorageLike): void {
  resolveStorage(storage).removeItem(STORAGE_KEYS.ACTIVE_SESSION);
}

// --- Completed History ---

export function loadSessionHistory(
  storage?: StorageLike,
): GeneratedSession[] {
  const list = readJson<unknown[]>(
    resolveStorage(storage),
    STORAGE_KEYS.SESSION_HISTORY,
    [],
  );
  if (!Array.isArray(list)) return [];
  const valid: GeneratedSession[] = [];
  for (const item of list) {
    const res = validateSessionObject(item);
    if (res.ok) valid.push(res.session);
  }
  return valid;
}

export function appendCompletedSession(
  session: GeneratedSession,
  storage?: StorageLike,
): GeneratedSession[] {
  const store = resolveStorage(storage);
  const existing = loadSessionHistory(store).filter((s) => s.id !== session.id);
  const next = [session, ...existing].slice(0, MAX_HISTORY_ITEMS);
  writeJson(store, STORAGE_KEYS.SESSION_HISTORY, next);
  return next;
}

export function deleteSessionFromHistory(
  sessionId: string,
  storage?: StorageLike,
): GeneratedSession[] {
  const store = resolveStorage(storage);
  const next = loadSessionHistory(store).filter((s) => s.id !== sessionId);
  writeJson(store, STORAGE_KEYS.SESSION_HISTORY, next);
  return next;
}

// --- Recent Rule IDs (duplicate suppression) ---

export function loadRecentRuleIds(storage?: StorageLike): string[] {
  const ids = readJson<unknown>(
    resolveStorage(storage),
    STORAGE_KEYS.RECENT_RULE_IDS,
    [],
  );
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is string => typeof id === 'string');
}

export function recordRecentRuleIds(
  ruleIds: readonly string[],
  storage?: StorageLike,
  maxItems = MAX_RECENT_RULE_IDS,
): string[] {
  const store = resolveStorage(storage);
  const current = loadRecentRuleIds(store);
  const merged: string[] = [];
  for (const id of [...ruleIds, ...current]) {
    if (!merged.includes(id)) {
      merged.push(id);
    }
    if (merged.length >= maxItems) break;
  }
  writeJson(store, STORAGE_KEYS.RECENT_RULE_IDS, merged);
  return merged;
}

// --- Familiar Spots CRUD ---

export function loadFamiliarSpots(storage?: StorageLike): FamiliarSpot[] {
  const raw = readJson<unknown>(
    resolveStorage(storage),
    STORAGE_KEYS.FAMILIAR_SPOTS,
    [],
  );
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidFamiliarSpot);
}

export function upsertFamiliarSpot(
  spot: FamiliarSpot,
  storage?: StorageLike,
): FamiliarSpot[] {
  if (!isValidFamiliarSpot(spot)) {
    throw new Error('Invalid FamiliarSpot data');
  }
  const store = resolveStorage(storage);
  const current = loadFamiliarSpots(store);
  const idx = current.findIndex((item) => item.id === spot.id);
  const normalized: FamiliarSpot = {
    id: spot.id,
    name: spot.name.trim(),
    lat: Number(spot.lat),
    lng: Number(spot.lng),
    radiusMeters: Math.max(50, Math.round(Number(spot.radiusMeters))),
    createdAt: spot.createdAt ?? new Date().toISOString(),
  };

  const next =
    idx >= 0
      ? current.map((item, i) => (i === idx ? normalized : item))
      : [normalized, ...current];

  writeJson(store, STORAGE_KEYS.FAMILIAR_SPOTS, next);
  return next;
}

export function deleteFamiliarSpot(
  spotId: string,
  storage?: StorageLike,
): FamiliarSpot[] {
  const store = resolveStorage(storage);
  const next = loadFamiliarSpots(store).filter((spot) => spot.id !== spotId);
  writeJson(store, STORAGE_KEYS.FAMILIAR_SPOTS, next);
  return next;
}

// --- Custom Rules CRUD ---

export function loadCustomRules(storage?: StorageLike): RuleDefinition[] {
  const raw = readJson<unknown>(
    resolveStorage(storage),
    STORAGE_KEYS.CUSTOM_RULES,
    [],
  );
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidRuleDefinition);
}

export function upsertCustomRule(
  rule: RuleDefinition,
  storage?: StorageLike,
): RuleDefinition[] {
  if (!isValidRuleDefinition(rule)) {
    throw new Error('Invalid custom RuleDefinition');
  }
  const store = resolveStorage(storage);
  const current = loadCustomRules(store);
  const idx = current.findIndex((item) => item.id === rule.id);
  const normalized: RuleDefinition = {
    ...rule,
    title: rule.title.trim(),
    hintTitle: rule.hintTitle.trim() || rule.title.trim(),
    description: rule.description.trim() || rule.title.trim(),
    baseBonus: Math.max(0, Math.round(Number(rule.baseBonus))),
    basePenalty: Math.max(0, Math.round(Math.abs(Number(rule.basePenalty)))),
    excludes: Array.isArray(rule.excludes) ? [...rule.excludes] : [],
    tags: Array.from(new Set([...(rule.tags ?? []), 'custom'])),
  };

  const next =
    idx >= 0
      ? current.map((item, i) => (i === idx ? normalized : item))
      : [normalized, ...current];

  writeJson(store, STORAGE_KEYS.CUSTOM_RULES, next);
  return next;
}

export function deleteCustomRule(
  ruleId: string,
  storage?: StorageLike,
): RuleDefinition[] {
  const store = resolveStorage(storage);
  const next = loadCustomRules(store).filter((rule) => rule.id !== ruleId);
  writeJson(store, STORAGE_KEYS.CUSTOM_RULES, next);
  return next;
}

// --- Last Session Config ---

export function saveLastConfig(
  config: SessionConfig,
  storage?: StorageLike,
): void {
  writeJson(resolveStorage(storage), STORAGE_KEYS.LAST_CONFIG, config);
}

export function loadLastConfig(storage?: StorageLike): SessionConfig | null {
  const raw = readJson<unknown>(
    resolveStorage(storage),
    STORAGE_KEYS.LAST_CONFIG,
    null,
  );
  return isValidSessionConfig(raw) ? raw : null;
}

// --- Formatters & Import / Export ---

function formatDateTimeJa(iso?: string): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatSignedScore(score: number): string {
  return score >= 0 ? `+${score}pt` : `${score}pt`;
}

export function formatWalkMemoText(session: GeneratedSession): string {
  const lines: string[] = [];
  lines.push('【Sanpo Quests 散歩メモ】');
  lines.push(`日時: ${formatDateTimeJa(session.completedAt ?? session.startedAt ?? session.createdAt)}`);
  lines.push(
    `条件: ${DIFFICULTY_LABELS[session.config.difficulty]} / ${REVEAL_MODE_LABELS[session.config.revealMode]} / ${WALK_MODE_LABELS[session.config.walkMode]}`,
  );
  lines.push(`最終スコア: ${session.totalScore}pt（基礎点 ${session.baseScore}pt）`);
  lines.push('');
  lines.push('■ 縛りルール結果');

  for (const [index, rule] of session.rules.entries()) {
    const state = session.progress[rule.ruleId];
    const delta = state ? state.scoreDelta : 0;
    const statsParts: string[] = [];
    if (state) {
      if (state.bonusCount > 0) statsParts.push(`達成×${state.bonusCount}`);
      if (state.penaltyCount > 0) statsParts.push(`違反×${state.penaltyCount}`);
      if (rule.evaluator.kind === 'counter') {
        statsParts.push(
          `カウント:${state.counterValue}${rule.evaluator.unitLabel}`,
        );
      }
    }
    const statsSuffix =
      statsParts.length > 0 ? ` [${statsParts.join(' / ')}]` : '';
    lines.push(
      `${index + 1}. ${rule.title} : ${formatSignedScore(delta)}${statsSuffix}`,
    );
    if (state?.lastCheckDetail) {
      lines.push(`   └ ${state.lastCheckDetail}`);
    }
  }

  if (session.memo.trim()) {
    lines.push('');
    lines.push('■ 散歩メモ');
    lines.push(session.memo.trim());
  }

  return lines.join('\n');
}

export function exportSessionJson(session: GeneratedSession): string {
  const normalized: GeneratedSession = {
    ...session,
    totalScore: calculateTotalScore(session.baseScore, session.progress),
    handoffHint: buildHandoffHint(
      session.config,
      session.rules,
      calculateTotalScore(session.baseScore, session.progress),
    ),
  };
  return JSON.stringify(normalized, null, 2);
}

export type ImportSessionResult =
  | { ok: true; session: GeneratedSession }
  | { ok: false; error: string };

const VALID_DIFFICULTIES: readonly Difficulty[] = ['light', 'standard', 'hard'];
const VALID_REVEAL_MODES: readonly RevealMode[] = [
  'open',
  'blind_hint',
  'blind_secret',
];
const VALID_WALK_MODES: readonly WalkMode[] = ['solo', 'pair'];
const VALID_CATEGORIES: readonly RuleCategory[] = [
  'route',
  'waypoint',
  'constraint',
  'pace_style',
  'time_area',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidFamiliarSpot(value: unknown): value is FamiliarSpot {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    typeof value.lat === 'number' &&
    Number.isFinite(value.lat) &&
    value.lat >= -90 &&
    value.lat <= 90 &&
    typeof value.lng === 'number' &&
    Number.isFinite(value.lng) &&
    value.lng >= -180 &&
    value.lng <= 180 &&
    typeof value.radiusMeters === 'number' &&
    Number.isFinite(value.radiusMeters) &&
    value.radiusMeters > 0
  );
}

function isValidRuleDefinition(value: unknown): value is RuleDefinition {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.trim().length === 0) return false;
  if (typeof value.title !== 'string' || value.title.trim().length === 0) {
    return false;
  }
  if (typeof value.hintTitle !== 'string') return false;
  if (typeof value.description !== 'string') return false;
  if (!VALID_CATEGORIES.includes(value.category as RuleCategory)) return false;
  if (
    value.familiarity !== 'unexplored' &&
    value.familiarity !== 'familiar' &&
    value.familiarity !== 'any'
  ) {
    return false;
  }
  if (
    value.scoringType !== 'bonus' &&
    value.scoringType !== 'penalty' &&
    value.scoringType !== 'hybrid'
  ) {
    return false;
  }
  if (typeof value.baseBonus !== 'number' || !Number.isFinite(value.baseBonus)) {
    return false;
  }
  if (
    typeof value.basePenalty !== 'number' ||
    !Number.isFinite(value.basePenalty)
  ) {
    return false;
  }
  if (!VALID_DIFFICULTIES.includes(value.minDifficulty as Difficulty)) {
    return false;
  }
  if (
    !Array.isArray(value.supportedModes) ||
    value.supportedModes.length === 0 ||
    !value.supportedModes.every((m) => VALID_WALK_MODES.includes(m as WalkMode))
  ) {
    return false;
  }
  if (!isRecord(value.evaluator) || typeof value.evaluator.kind !== 'string') {
    return false;
  }
  return true;
}

function isValidSessionConfig(value: unknown): value is SessionConfig {
  if (!isRecord(value)) return false;
  if (
    typeof value.ruleCount !== 'number' ||
    !Number.isInteger(value.ruleCount) ||
    value.ruleCount < MIN_RULE_COUNT ||
    value.ruleCount > MAX_RULE_COUNT
  ) {
    return false;
  }
  if (!VALID_DIFFICULTIES.includes(value.difficulty as Difficulty)) return false;
  if (!VALID_REVEAL_MODES.includes(value.revealMode as RevealMode)) return false;
  if (!VALID_WALK_MODES.includes(value.walkMode as WalkMode)) return false;
  if (!Array.isArray(value.excludedCategories)) return false;
  if (
    !value.excludedCategories.every((cat) =>
      VALID_CATEGORIES.includes(cat as RuleCategory),
    )
  ) {
    return false;
  }
  return true;
}

export function validateSessionObject(value: unknown): ImportSessionResult {
  if (!isRecord(value)) {
    return { ok: false, error: 'JSON のルートはオブジェクトである必要があります。' };
  }
  if (typeof value.id !== 'string' || value.id.trim().length === 0) {
    return { ok: false, error: 'セッション ID (id) が不正です。' };
  }
  if (!isValidSessionConfig(value.config)) {
    return { ok: false, error: 'セッション設定 (config) の形式が不正です。' };
  }
  if (!Array.isArray(value.rules) || value.rules.length === 0) {
    return { ok: false, error: 'ルール一覧 (rules) が空または不正です。' };
  }

  for (const rule of value.rules) {
    if (
      !isRecord(rule) ||
      typeof rule.ruleId !== 'string' ||
      typeof rule.title !== 'string' ||
      typeof rule.hintTitle !== 'string' ||
      typeof rule.unitBonus !== 'number' ||
      typeof rule.unitPenalty !== 'number' ||
      !isRecord(rule.evaluator) ||
      typeof rule.evaluator.kind !== 'string'
    ) {
      return { ok: false, error: 'ルール定義 (rules[]) に必須項目が不足しています。' };
    }
  }

  const rules = value.rules as GeneratedSession['rules'];
  const baseScore =
    typeof value.baseScore === 'number' && Number.isFinite(value.baseScore)
      ? value.baseScore
      : 100;

  const rawProgress = isRecord(value.progress) ? value.progress : {};
  const progress: GeneratedSession['progress'] = {};
  for (const rule of rules) {
    const existing = rawProgress[rule.ruleId];
    if (
      isRecord(existing) &&
      typeof existing.bonusCount === 'number' &&
      typeof existing.penaltyCount === 'number' &&
      typeof existing.counterValue === 'number' &&
      typeof existing.scoreDelta === 'number'
    ) {
      progress[rule.ruleId] = {
        ruleId: rule.ruleId,
        bonusCount: existing.bonusCount,
        penaltyCount: existing.penaltyCount,
        counterValue: existing.counterValue,
        scoreDelta: existing.scoreDelta,
        evaluated: Boolean(existing.evaluated),
        lastCheckDetail:
          typeof existing.lastCheckDetail === 'string'
            ? existing.lastCheckDetail
            : undefined,
        history: Array.isArray(existing.history) ? existing.history : [],
      };
    } else {
      progress[rule.ruleId] = createInitialProgress(rule.ruleId);
    }
  }

  const totalScore = calculateTotalScore(baseScore, progress);
  const status =
    value.status === 'draft' ||
    value.status === 'active' ||
    value.status === 'completed'
      ? value.status
      : 'draft';

  const session: GeneratedSession = {
    id: value.id,
    schemaVersion:
      typeof value.schemaVersion === 'number'
        ? value.schemaVersion
        : SESSION_SCHEMA_VERSION,
    createdAt:
      typeof value.createdAt === 'string'
        ? value.createdAt
        : new Date().toISOString(),
    startedAt:
      typeof value.startedAt === 'string' ? value.startedAt : undefined,
    completedAt:
      typeof value.completedAt === 'string' ? value.completedAt : undefined,
    status,
    config: value.config,
    baseScore,
    rules,
    progress,
    memo: typeof value.memo === 'string' ? value.memo : '',
    totalScore,
    handoffHint: buildHandoffHint(value.config, rules, totalScore),
  };

  return { ok: true, session };
}

export function importSessionJson(rawJson: string): ImportSessionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return {
      ok: false,
      error: 'JSON の構文エラーです。正しい JSON 文字列を確認してください。',
    };
  }
  return validateSessionObject(parsed);
}
