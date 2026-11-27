import {
  type FamiliarSpot,
  type GeneratedSession,
  type GeoPoint,
  type LocationCheckResult,
  type ResolvedRule,
  type RuleEventLogEntry,
  type RuleEventPayload,
  type RuleProgressState,
} from './types.ts';
import { buildHandoffHint } from './generator.ts';
import { calculateTotalScore } from './scorer.ts';

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function calculateHaversineDistanceMeters(
  a: GeoPoint,
  b: GeoPoint,
): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  return EARTH_RADIUS_METERS * c;
}

function appendLog(
  state: RuleProgressState,
  entry: RuleEventLogEntry,
): RuleProgressState {
  return {
    ...state,
    bonusCount: state.bonusCount + entry.bonusApplied,
    penaltyCount: state.penaltyCount + entry.penaltyApplied,
    counterValue: state.counterValue + entry.counterDelta,
    scoreDelta: state.scoreDelta + entry.scoreDelta,
    evaluated: true,
    lastCheckDetail: entry.detail ?? state.lastCheckDetail,
    history: [...state.history, entry],
  };
}

function undoLastEvent(state: RuleProgressState): RuleProgressState {
  if (state.history.length === 0) {
    return state;
  }
  const nextHistory = state.history.slice(0, -1);
  const last = state.history[state.history.length - 1];
  const previousDetail =
    nextHistory.length > 0
      ? nextHistory[nextHistory.length - 1].detail
      : undefined;

  return {
    ...state,
    bonusCount: Math.max(0, state.bonusCount - last.bonusApplied),
    penaltyCount: Math.max(0, state.penaltyCount - last.penaltyApplied),
    counterValue: Math.max(0, state.counterValue - last.counterDelta),
    scoreDelta: state.scoreDelta - last.scoreDelta,
    evaluated: nextHistory.length > 0,
    lastCheckDetail: previousDetail,
    history: nextHistory,
  };
}

function canApplyBonus(
  state: RuleProgressState,
  unitBonus: number,
  maxApplications?: number,
): boolean {
  if (unitBonus <= 0) return false;
  if (maxApplications !== undefined && state.bonusCount >= maxApplications) {
    return false;
  }
  return true;
}

function canApplyPenalty(
  state: RuleProgressState,
  unitPenalty: number,
  maxApplications?: number,
): boolean {
  if (unitPenalty >= 0) return false;
  if (maxApplications !== undefined && state.penaltyCount >= maxApplications) {
    return false;
  }
  return true;
}

function evaluateNearestSpot(
  point: GeoPoint,
  spots: readonly FamiliarSpot[],
  defaultRadiusMeters: number,
): {
  nearestSpot: FamiliarSpot;
  nearestDistance: number;
  nearestRadius: number;
  matchedInsideSpot?: { spot: FamiliarSpot; distance: number; radius: number };
} {
  let nearestSpot = spots[0];
  let nearestDistance = calculateHaversineDistanceMeters(point, spots[0]);
  let nearestRadius =
    spots[0].radiusMeters > 0 ? spots[0].radiusMeters : defaultRadiusMeters;

  let matchedInsideSpot:
    | { spot: FamiliarSpot; distance: number; radius: number }
    | undefined;

  for (const spot of spots) {
    const distance = calculateHaversineDistanceMeters(point, spot);
    const radius =
      spot.radiusMeters > 0 ? spot.radiusMeters : defaultRadiusMeters;

    if (distance < nearestDistance) {
      nearestSpot = spot;
      nearestDistance = distance;
      nearestRadius = radius;
    }

    if (distance <= radius) {
      if (!matchedInsideSpot || distance < matchedInsideSpot.distance) {
        matchedInsideSpot = { spot, distance, radius };
      }
    }
  }

  return { nearestSpot, nearestDistance, nearestRadius, matchedInsideSpot };
}

export function evaluateRuleEvent(
  rule: ResolvedRule,
  state: RuleProgressState,
  event: RuleEventPayload,
): RuleProgressState {
  if (event.type === 'UNDO_LAST') {
    return undoLastEvent(state);
  }

  const timestamp = event.timestamp ?? new Date().toISOString();
  const evaluator = rule.evaluator;

  switch (evaluator.kind) {
    case 'manual': {
      if (event.type === 'MARK_BONUS') {
        if (
          !canApplyBonus(state, rule.unitBonus, evaluator.maxBonusApplications)
        ) {
          return state;
        }
        return appendLog(state, {
          type: 'MARK_BONUS',
          timestamp,
          bonusApplied: 1,
          penaltyApplied: 0,
          counterDelta: 0,
          scoreDelta: rule.unitBonus,
          detail: event.note ?? `${evaluator.bonusLabel ?? '達成'} (+${rule.unitBonus}pt)`,
        });
      }
      if (event.type === 'MARK_PENALTY') {
        if (
          !canApplyPenalty(
            state,
            rule.unitPenalty,
            evaluator.maxPenaltyApplications,
          )
        ) {
          return state;
        }
        return appendLog(state, {
          type: 'MARK_PENALTY',
          timestamp,
          bonusApplied: 0,
          penaltyApplied: 1,
          counterDelta: 0,
          scoreDelta: rule.unitPenalty,
          detail: event.note ?? `${evaluator.penaltyLabel ?? '違反'} (${rule.unitPenalty}pt)`,
        });
      }
      return state;
    }

    case 'counter': {
      if (event.type !== 'INCREMENT_COUNTER') {
        return state;
      }
      const nextCount = state.counterValue + 1;
      let bonusApplied = 0;
      let penaltyApplied = 0;
      let scoreDelta = 0;
      const details: string[] = [`${nextCount}${evaluator.unitLabel}`];

      if (
        evaluator.targetCount !== undefined &&
        nextCount >= evaluator.targetCount &&
        canApplyBonus(
          state,
          rule.unitBonus,
          evaluator.maxBonusApplications ?? 1,
        )
      ) {
        bonusApplied = 1;
        scoreDelta += rule.unitBonus;
        details.push(`目標到達 +${rule.unitBonus}pt`);
      }

      if (
        evaluator.maxAllowedCount !== undefined &&
        nextCount > evaluator.maxAllowedCount &&
        canApplyPenalty(
          state,
          rule.unitPenalty,
          evaluator.maxPenaltyApplications,
        )
      ) {
        penaltyApplied = 1;
        scoreDelta += rule.unitPenalty;
        details.push(
          `上限(${evaluator.maxAllowedCount}${evaluator.unitLabel})超過 ${rule.unitPenalty}pt`,
        );
      }

      return appendLog(state, {
        type: 'INCREMENT_COUNTER',
        timestamp,
        bonusApplied,
        penaltyApplied,
        counterDelta: 1,
        scoreDelta,
        detail: details.join(' / '),
      });
    }

    case 'location_check': {
      if (event.type !== 'LOCATION_CHECK' || !event.point) {
        return state;
      }
      const spots = event.familiarSpots ?? [];
      if (spots.length === 0) {
        return {
          ...state,
          lastCheckDetail:
            '「よく通る場所」が未登録のため距離判定をスキップしました',
        };
      }

      const {
        nearestSpot,
        nearestDistance,
        nearestRadius,
        matchedInsideSpot,
      } = evaluateNearestSpot(
        event.point,
        spots,
        evaluator.defaultRadiusMeters,
      );

      const isNear = Boolean(matchedInsideSpot);
      const refSpot = matchedInsideSpot?.spot ?? nearestSpot;
      const refDistance = Math.round(
        matchedInsideSpot?.distance ?? nearestDistance,
      );
      const refRadius = Math.round(matchedInsideSpot?.radius ?? nearestRadius);

      let bonusApplied = 0;
      let penaltyApplied = 0;
      let scoreDelta = 0;
      let triggered: LocationCheckResult['triggered'] = 'none';

      if (evaluator.triggerWhen === 'near') {
        if (isNear) {
          if (
            canApplyPenalty(
              state,
              rule.unitPenalty,
              evaluator.maxPenaltyApplications,
            )
          ) {
            penaltyApplied = 1;
            scoreDelta = rule.unitPenalty;
            triggered = 'penalty';
          }
        } else if (
          canApplyBonus(state, rule.unitBonus, evaluator.maxBonusApplications)
        ) {
          bonusApplied = 1;
          scoreDelta = rule.unitBonus;
          triggered = 'bonus';
        }
      } else {
        // triggerWhen === 'away'
        if (!isNear) {
          if (
            canApplyBonus(state, rule.unitBonus, evaluator.maxBonusApplications)
          ) {
            bonusApplied = 1;
            scoreDelta = rule.unitBonus;
            triggered = 'bonus';
          }
        } else if (
          canApplyPenalty(
            state,
            rule.unitPenalty,
            evaluator.maxPenaltyApplications,
          )
        ) {
          penaltyApplied = 1;
          scoreDelta = rule.unitPenalty;
          triggered = 'penalty';
        }
      }

      const locationResult: LocationCheckResult = {
        matchedSpotName: refSpot.name,
        distanceMeters: refDistance,
        radiusMeters: refRadius,
        triggered,
      };

      const statusText =
        triggered === 'bonus'
          ? `圏外クリア +${rule.unitBonus}pt`
          : triggered === 'penalty'
            ? `圏内接近 ${rule.unitPenalty}pt`
            : isNear
              ? '圏内（スコア変動なし）'
              : '圏外（上限到達済み）';

      return appendLog(state, {
        type: 'LOCATION_CHECK',
        timestamp,
        bonusApplied,
        penaltyApplied,
        counterDelta: 0,
        scoreDelta,
        detail: `「${refSpot.name}」から ${refDistance}m（基準 ${refRadius}m）→ ${statusText}`,
        locationResult,
      });
    }

    case 'session_rule': {
      if (event.type !== 'COMPLETE_SESSION') {
        return state;
      }
      if (state.evaluated) {
        return state;
      }

      const completed = event.completed ?? true;
      const elapsedMinutes = event.elapsedMinutes ?? 0;

      let bonusApplied = 0;
      let penaltyApplied = 0;
      let scoreDelta = 0;
      let detail = '';

      if (evaluator.maxDurationMinutes !== undefined) {
        const withinLimit =
          completed && elapsedMinutes <= evaluator.maxDurationMinutes;
        if (withinLimit && rule.unitBonus > 0) {
          bonusApplied = 1;
          scoreDelta = rule.unitBonus;
          detail = `経過 ${Math.round(elapsedMinutes)}分 / 上限 ${evaluator.maxDurationMinutes}分（時間内完走 +${rule.unitBonus}pt）`;
        } else if (!withinLimit && rule.unitPenalty < 0) {
          penaltyApplied = 1;
          scoreDelta = rule.unitPenalty;
          detail = `経過 ${Math.round(elapsedMinutes)}分 / 上限 ${evaluator.maxDurationMinutes}分（時間超過 ${rule.unitPenalty}pt）`;
        } else {
          detail = `経過 ${Math.round(elapsedMinutes)}分 / 上限 ${evaluator.maxDurationMinutes}分`;
        }
      } else if (evaluator.requireCompletion) {
        if (completed && rule.unitBonus > 0) {
          bonusApplied = 1;
          scoreDelta = rule.unitBonus;
          detail = `完走達成 (+${rule.unitBonus}pt)`;
        } else if (!completed && rule.unitPenalty < 0) {
          penaltyApplied = 1;
          scoreDelta = rule.unitPenalty;
          detail = `未完走 (${rule.unitPenalty}pt)`;
        } else {
          detail = completed ? '完走記録' : '未完走';
        }
      }

      return appendLog(state, {
        type: 'COMPLETE_SESSION',
        timestamp,
        bonusApplied,
        penaltyApplied,
        counterDelta: 0,
        scoreDelta,
        detail,
      });
    }
  }
}

export function evaluateSessionCompletion(
  session: GeneratedSession,
  completedAtIso: string = new Date().toISOString(),
  completed = true,
): GeneratedSession {
  const startedMs = session.startedAt
    ? Date.parse(session.startedAt)
    : Date.parse(session.createdAt);
  const completedMs = Date.parse(completedAtIso);
  const elapsedMinutes = Math.max(0, (completedMs - startedMs) / 60_000);

  const nextProgress: Record<string, RuleProgressState> = {
    ...session.progress,
  };

  for (const rule of session.rules) {
    if (rule.evaluator.kind !== 'session_rule') continue;
    const current = nextProgress[rule.ruleId];
    if (!current || current.evaluated) continue;
    nextProgress[rule.ruleId] = evaluateRuleEvent(rule, current, {
      type: 'COMPLETE_SESSION',
      timestamp: completedAtIso,
      elapsedMinutes,
      completed,
    });
  }

  const totalScore = calculateTotalScore(session.baseScore, nextProgress);

  return {
    ...session,
    status: 'completed',
    completedAt: completedAtIso,
    progress: nextProgress,
    totalScore,
    handoffHint: buildHandoffHint(session.config, session.rules, totalScore),
  };
}
