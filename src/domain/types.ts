export type WalkMode = 'solo' | 'pair';

export type Difficulty = 'light' | 'standard' | 'hard';

export type RevealMode = 'open' | 'blind_hint' | 'blind_secret';

export type Familiarity = 'unexplored' | 'familiar' | 'any';

export type ScoringType = 'bonus' | 'penalty' | 'hybrid';

export type RuleCategory =
  | 'route'
  | 'waypoint'
  | 'constraint'
  | 'pace_style'
  | 'time_area';

export type EvaluatorKind =
  | 'manual'
  | 'counter'
  | 'location_check'
  | 'session_rule';

export const DIFFICULTY_WEIGHTS: Record<
  Difficulty,
  { readonly bonus: number; readonly penalty: number }
> = {
  light: { bonus: 0.8, penalty: 0.6 },
  standard: { bonus: 1.0, penalty: 1.0 },
  hard: { bonus: 1.4, penalty: 1.5 },
} as const;

export const DIFFICULTY_RANK: Record<Difficulty, number> = {
  light: 0,
  standard: 1,
  hard: 2,
} as const;

export const RULE_CATEGORIES: readonly RuleCategory[] = [
  'route',
  'waypoint',
  'constraint',
  'pace_style',
  'time_area',
] as const;

export const RULE_CATEGORY_LABELS: Record<RuleCategory, string> = {
  route: '経路・進行',
  waypoint: '立ち寄り・目的地',
  constraint: '制限・カウント',
  pace_style: '歩き方・視点',
  time_area: '時間・エリア',
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  light: 'ライト',
  standard: 'スタンダード',
  hard: 'ハード',
};

export const REVEAL_MODE_LABELS: Record<RevealMode, string> = {
  open: 'オープン',
  blind_hint: '条件秘匿（ヒントのみ）',
  blind_secret: '完全シークレット',
};

export const WALK_MODE_LABELS: Record<WalkMode, string> = {
  solo: 'ソロ',
  pair: 'ペア',
};

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface FamiliarSpot extends GeoPoint {
  id: string;
  name: string;
  radiusMeters: number;
  createdAt?: string;
}

export interface ManualEvaluatorConfig {
  kind: 'manual';
  bonusLabel?: string;
  penaltyLabel?: string;
  maxBonusApplications?: number;
  maxPenaltyApplications?: number;
}

export interface CounterEvaluatorConfig {
  kind: 'counter';
  unitLabel: string;
  actionLabel: string;
  targetCount?: number;
  targetCountParam?: string;
  maxAllowedCount?: number;
  maxAllowedCountParam?: string;
  maxBonusApplications?: number;
  maxPenaltyApplications?: number;
}

export interface LocationCheckEvaluatorConfig {
  kind: 'location_check';
  triggerWhen: 'near' | 'away';
  defaultRadiusMeters: number;
  actionLabel?: string;
  maxBonusApplications?: number;
  maxPenaltyApplications?: number;
}

export interface SessionRuleEvaluatorConfig {
  kind: 'session_rule';
  maxDurationMinutes?: number;
  maxDurationMinutesParam?: string;
  requireCompletion?: boolean;
  actionLabel?: string;
}

export type RuleEvaluatorConfig =
  | ManualEvaluatorConfig
  | CounterEvaluatorConfig
  | LocationCheckEvaluatorConfig
  | SessionRuleEvaluatorConfig;

export type RuleParams = Record<string, number | string>;

export interface RuleDefinition {
  id: string;
  title: string;
  hintTitle: string;
  description: string;
  category: RuleCategory;
  familiarity: Familiarity;
  scoringType: ScoringType;
  baseBonus: number;
  basePenalty: number;
  minDifficulty: Difficulty;
  supportedModes: WalkMode[];
  excludes: string[];
  evaluator: RuleEvaluatorConfig;
  paramsByDifficulty?: Partial<Record<Difficulty, RuleParams>>;
  tags?: string[];
  handoffHint?: string;
}

export interface ResolvedRule {
  ruleId: string;
  title: string;
  hintTitle: string;
  description: string;
  category: RuleCategory;
  familiarity: Familiarity;
  scoringType: ScoringType;
  unitBonus: number;
  unitPenalty: number;
  evaluator: RuleEvaluatorConfig;
  pinned: boolean;
  params: RuleParams;
  tags?: string[];
  handoffHint?: string;
}

export type RuleEventType =
  | 'MARK_BONUS'
  | 'MARK_PENALTY'
  | 'INCREMENT_COUNTER'
  | 'LOCATION_CHECK'
  | 'COMPLETE_SESSION'
  | 'UNDO_LAST';

export interface RuleEventPayload {
  type: RuleEventType;
  timestamp?: string;
  point?: GeoPoint;
  familiarSpots?: FamiliarSpot[];
  elapsedMinutes?: number;
  completed?: boolean;
  note?: string;
}

export interface LocationCheckResult {
  matchedSpotName?: string;
  distanceMeters: number;
  radiusMeters: number;
  triggered: 'bonus' | 'penalty' | 'none';
}

export interface RuleEventLogEntry {
  type: Exclude<RuleEventType, 'UNDO_LAST'>;
  timestamp: string;
  bonusApplied: number;
  penaltyApplied: number;
  counterDelta: number;
  scoreDelta: number;
  detail?: string;
  locationResult?: LocationCheckResult;
}

export interface RuleProgressState {
  ruleId: string;
  bonusCount: number;
  penaltyCount: number;
  counterValue: number;
  scoreDelta: number;
  evaluated: boolean;
  lastCheckDetail?: string;
  history: RuleEventLogEntry[];
}

export const MIN_RULE_COUNT = 1;
export const MAX_RULE_COUNT = 8;

export type RuleCount = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface SessionConfig {
  ruleCount: RuleCount;
  difficulty: Difficulty;
  revealMode: RevealMode;
  walkMode: WalkMode;
  excludedCategories: RuleCategory[];
}

export type SessionStatus = 'draft' | 'active' | 'completed';

export interface SessionHandoffHint {
  sourceApp: 'sanpo-quests';
  version: string;
  difficulty: Difficulty;
  revealMode: RevealMode;
  walkMode: WalkMode;
  ruleIds: string[];
  ruleTags: string[];
  hints: string[];
  summary: string;
}

export interface GeneratedSession {
  id: string;
  schemaVersion: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  status: SessionStatus;
  config: SessionConfig;
  baseScore: number;
  rules: ResolvedRule[];
  progress: Record<string, RuleProgressState>;
  memo: string;
  totalScore: number;
  handoffHint: SessionHandoffHint;
}
