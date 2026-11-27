import './style.css';
import rulesJson from './data/rules.json';
import {
  buildHandoffHint,
  createGeneratedSession,
  createInitialProgress,
  rerollSingleRule,
  resolveRule,
} from './domain/generator.ts';
import {
  evaluateRuleEvent,
  evaluateSessionCompletion,
} from './domain/evaluator.ts';
import { calculateTotalScore } from './domain/scorer.ts';
import type {
  FamiliarSpot,
  GeneratedSession,
  GeoPoint,
  RuleDefinition,
  RuleEventPayload,
  SessionConfig,
} from './domain/types.ts';
import {
  appendCompletedSession,
  clearActiveSession,
  deleteFamiliarSpot,
  deleteSessionFromHistory,
  loadActiveSession,
  loadFamiliarSpots,
  loadLastConfig,
  loadRecentRuleIds,
  loadSessionHistory,
  recordRecentRuleIds,
  saveActiveSession,
  saveLastConfig,
  upsertFamiliarSpot,
} from './storage/localStore.ts';
import { el, showToast } from './ui/dom.ts';
import { renderDrawView } from './ui/drawView.ts';
import { openImportModal, openSpotsModal } from './ui/modals.ts';
import { mountPlayView, type MountedPlayView } from './ui/playView.ts';
import { renderResultView } from './ui/resultView.ts';

const ALL_RULES = rulesJson as RuleDefinition[];
const RULE_DEF_MAP = new Map(ALL_RULES.map((r) => [r.id, r]));

type ActiveTab = 'draw' | 'play' | 'result';

interface AppState {
  activeTab: ActiveTab;
  config: SessionConfig;
  draftSession: GeneratedSession | null;
  activeSession: GeneratedSession | null;
  history: GeneratedSession[];
  selectedResultId: string | null;
  familiarSpots: FamiliarSpot[];
  showDirectionIcons: boolean;
}

const DEFAULT_CONFIG: SessionConfig = {
  ruleCount: 2,
  difficulty: 'standard',
  revealMode: 'open',
  walkMode: 'solo',
  excludedCategories: [],
};

const savedActive = loadActiveSession();
const savedHistory = loadSessionHistory();

const state: AppState = {
  activeTab: savedActive ? 'play' : 'draw',
  config: loadLastConfig() ?? DEFAULT_CONFIG,
  draftSession: null,
  activeSession: savedActive,
  history: savedHistory,
  selectedResultId: savedHistory[0]?.id ?? null,
  familiarSpots: loadFamiliarSpots(),
  showDirectionIcons: false, // Default OFF per specification
};

let mountedPlayView: MountedPlayView | null = null;

function cleanupPlayView(): void {
  if (mountedPlayView) {
    mountedPlayView.cleanup();
    mountedPlayView = null;
  }
}

function handleConfigChange(nextConfig: SessionConfig): void {
  state.config = nextConfig;
  saveLastConfig(nextConfig);

  // Re-resolve pinned/existing draft rules to reflect difficulty or revealMode change
  if (state.draftSession) {
    const resolved = state.draftSession.rules.map((r) => {
      const def = RULE_DEF_MAP.get(r.ruleId);
      return def ? resolveRule(def, nextConfig.difficulty, r.pinned) : r;
    });
    const nextProgress = { ...state.draftSession.progress };
    for (const r of resolved) {
      if (!nextProgress[r.ruleId]) {
        nextProgress[r.ruleId] = createInitialProgress(r.ruleId);
      }
    }
    state.draftSession = {
      ...state.draftSession,
      config: { ...nextConfig, excludedCategories: [...nextConfig.excludedCategories] },
      rules: resolved,
      progress: nextProgress,
      handoffHint: buildHandoffHint(
        nextConfig,
        resolved,
        state.draftSession.totalScore,
      ),
    };
  }
  renderApp();
}

function handleDraw(): void {
  const pinnedRules = state.draftSession
    ? state.draftSession.rules.filter((r) => r.pinned)
    : [];
  const recentRuleIds = loadRecentRuleIds();

  const drawn = createGeneratedSession(ALL_RULES, {
    config: state.config,
    pinnedRules,
    recentRuleIds,
  });

  if (drawn.rules.length === 0) {
    showToast(
      '条件に合うルールが見つかりませんでした。除外カテゴリを減らしてください。',
      'error',
    );
    return;
  }

  state.draftSession = drawn;
  recordRecentRuleIds(drawn.rules.map((r) => r.ruleId));
  showToast(`${drawn.rules.length}件の縛りを抽選しました`, 'success');
  renderApp();
}

function handleTogglePin(index: number): void {
  if (!state.draftSession) return;
  const rules = state.draftSession.rules.map((r, idx) =>
    idx === index ? { ...r, pinned: !r.pinned } : r,
  );
  state.draftSession = { ...state.draftSession, rules };
  renderApp();
}

function handleRerollOne(index: number): void {
  if (!state.draftSession) return;
  const recentRuleIds = loadRecentRuleIds();
  const nextRules = rerollSingleRule(
    ALL_RULES,
    state.draftSession.rules,
    index,
    {
      config: state.config,
      recentRuleIds,
    },
  );
  const nextProgress = Object.fromEntries(
    nextRules.map((r) => [r.ruleId, createInitialProgress(r.ruleId)]),
  );

  state.draftSession = {
    ...state.draftSession,
    rules: nextRules,
    progress: nextProgress,
    handoffHint: buildHandoffHint(
      state.config,
      nextRules,
      state.draftSession.totalScore,
    ),
  };
  recordRecentRuleIds([nextRules[index].ruleId]);
  showToast('枠をリロールしました', 'info');
  renderApp();
}

function handleStartWalk(): void {
  if (!state.draftSession || state.draftSession.rules.length === 0) return;

  const started: GeneratedSession = {
    ...state.draftSession,
    status: 'active',
    startedAt: new Date().toISOString(),
  };
  state.activeSession = started;
  state.draftSession = null;
  saveActiveSession(started);

  cleanupPlayView();
  state.activeTab = 'play';
  showToast('散歩をスタートしました！安全に気をつけて楽しんでください', 'success');
  renderApp();
}

function applyRuleEventToSession(
  session: GeneratedSession,
  ruleId: string,
  event: RuleEventPayload,
): GeneratedSession {
  const rule = session.rules.find((r) => r.ruleId === ruleId);
  const currentProgress = session.progress[ruleId];
  if (!rule || !currentProgress) return session;

  const updatedRuleProgress = evaluateRuleEvent(rule, currentProgress, event);
  const nextProgress = {
    ...session.progress,
    [ruleId]: updatedRuleProgress,
  };
  const totalScore = calculateTotalScore(session.baseScore, nextProgress);

  return {
    ...session,
    progress: nextProgress,
    totalScore,
    handoffHint: buildHandoffHint(session.config, session.rules, totalScore),
  };
}

function handlePlayRuleEvent(ruleId: string, event: RuleEventPayload): void {
  if (!state.activeSession) return;
  const updated = applyRuleEventToSession(state.activeSession, ruleId, event);
  state.activeSession = updated;
  saveActiveSession(updated);

  if (
    state.activeTab === 'play' &&
    mountedPlayView &&
    mountedPlayView.sessionId === updated.id
  ) {
    mountedPlayView.update(updated, state.familiarSpots);
  } else {
    renderApp();
  }
}

function handleSecretLocationCheck(point: GeoPoint): void {
  if (!state.activeSession) return;
  let updated = state.activeSession;
  for (const rule of updated.rules) {
    if (rule.evaluator.kind !== 'location_check') continue;
    updated = applyRuleEventToSession(updated, rule.ruleId, {
      type: 'LOCATION_CHECK',
      timestamp: new Date().toISOString(),
      point,
      familiarSpots: state.familiarSpots,
    });
  }
  state.activeSession = updated;
  saveActiveSession(updated);
}

function handleMemoChange(memo: string): void {
  if (!state.activeSession) return;
  state.activeSession = { ...state.activeSession, memo };
  saveActiveSession(state.activeSession);
}

function handleFinishSession(): void {
  if (!state.activeSession) return;
  const completed = evaluateSessionCompletion(
    state.activeSession,
    new Date().toISOString(),
    true,
  );

  state.history = appendCompletedSession(completed);
  state.selectedResultId = completed.id;
  state.activeSession = null;
  clearActiveSession();

  cleanupPlayView();
  state.activeTab = 'result';
  showToast(`散歩終了！最終スコア: ${completed.totalScore}pt`, 'success');
  renderApp();
}

function handleRetroactiveRuleEvent(
  sessionId: string,
  ruleId: string,
  event: RuleEventPayload,
): void {
  const target = state.history.find((h) => h.id === sessionId);
  if (!target) return;
  const updated = applyRuleEventToSession(target, ruleId, event);
  state.history = appendCompletedSession(updated);
  state.selectedResultId = updated.id;
  renderApp();
}

function handleDeleteHistory(sessionId: string): void {
  state.history = deleteSessionFromHistory(sessionId);
  if (state.selectedResultId === sessionId) {
    state.selectedResultId = state.history[0]?.id ?? null;
  }
  renderApp();
}

function handleOpenSpots(): void {
  openSpotsModal({
    getSpots: () => state.familiarSpots,
    onSaveSpot: (spot: FamiliarSpot) => {
      state.familiarSpots = upsertFamiliarSpot(spot);
      if (state.activeTab === 'play' && mountedPlayView && state.activeSession) {
        mountedPlayView.update(state.activeSession, state.familiarSpots);
      } else {
        renderApp();
      }
    },
    onDeleteSpot: (spotId: string) => {
      state.familiarSpots = deleteFamiliarSpot(spotId);
      if (state.activeTab === 'play' && mountedPlayView && state.activeSession) {
        mountedPlayView.update(state.activeSession, state.familiarSpots);
      } else {
        renderApp();
      }
    },
  });
}

function handleOpenImport(): void {
  openImportModal((imported) => {
    if (imported.status === 'completed') {
      state.history = appendCompletedSession(imported);
      state.selectedResultId = imported.id;
      cleanupPlayView();
      state.activeTab = 'result';
    } else if (imported.status === 'active') {
      state.activeSession = imported;
      saveActiveSession(imported);
      cleanupPlayView();
      state.activeTab = 'play';
    } else {
      state.config = imported.config;
      state.draftSession = imported;
      cleanupPlayView();
      state.activeTab = 'draw';
    }
    renderApp();
  });
}

function switchTab(tab: ActiveTab): void {
  if (state.activeTab === tab) return;
  if (state.activeTab === 'play') {
    cleanupPlayView();
  }
  state.activeTab = tab;
  renderApp();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderApp(): void {
  const root = document.querySelector<HTMLDivElement>('#app');
  if (!root) return;

  cleanupPlayView();
  root.innerHTML = '';

  const header = el('header', { class: 'app-header' }, [
    el('div', { class: 'app-header__inner' }, [
      el('div', { class: 'brand' }, [
        el('h1', { class: 'brand__title' }, ['Sanpo Quests']),
        el('p', { class: 'brand__sub' }, ['週末ウォーク縛りルールジェネレータ']),
      ]),
      state.activeSession
        ? el('span', { class: 'live-pill' }, ['散歩中'])
        : null,
    ]),
  ]);

  const main = el('main', { class: 'app-main', id: 'main-content' });

  if (state.activeTab === 'draw') {
    main.append(
      renderDrawView({
        config: state.config,
        draftSession: state.draftSession,
        familiarSpotCount: state.familiarSpots.length,
        onConfigChange: handleConfigChange,
        onDraw: handleDraw,
        onTogglePin: handleTogglePin,
        onRerollOne: handleRerollOne,
        onStartWalk: handleStartWalk,
        onOpenSpots: handleOpenSpots,
        onOpenImport: handleOpenImport,
      }),
    );
  } else if (state.activeTab === 'play') {
    mountedPlayView = mountPlayView({
      session: state.activeSession,
      familiarSpots: state.familiarSpots,
      showDirectionIcons: state.showDirectionIcons,
      onRuleEvent: handlePlayRuleEvent,
      onSecretLocationCheck: handleSecretLocationCheck,
      onMemoChange: handleMemoChange,
      onToggleDirectionIcons: (visible) => {
        state.showDirectionIcons = visible;
      },
      onFinishSession: handleFinishSession,
      onGoToDraw: () => switchTab('draw'),
      onOpenSpots: handleOpenSpots,
    });
    main.append(mountedPlayView.element);
  } else {
    const selectedSession =
      state.history.find((h) => h.id === state.selectedResultId) ??
      state.history[0] ??
      null;
    main.append(
      renderResultView({
        selectedSession,
        history: state.history,
        onSelectSession: (id) => {
          state.selectedResultId = id;
          renderApp();
        },
        onDeleteHistory: handleDeleteHistory,
        onRetroactiveRuleEvent: handleRetroactiveRuleEvent,
        onStartNewWalk: () => switchTab('draw'),
      }),
    );
  }

  const tabs: Array<{ id: ActiveTab; label: string; badge?: string }> = [
    { id: 'draw', label: '抽選・編成' },
    {
      id: 'play',
      label: '散歩中',
      badge: state.activeSession ? '●' : undefined,
    },
    {
      id: 'result',
      label: '結果・履歴',
      badge: state.history.length > 0 ? String(state.history.length) : undefined,
    },
  ];

  const bottomNav = el(
    'nav',
    { class: 'bottom-nav', 'aria-label': 'メインナビゲーション' },
    [
      el(
        'div',
        { class: 'bottom-nav__inner', role: 'tablist' },
        tabs.map((tab) => {
          const isActive = state.activeTab === tab.id;
          const btn = el(
            'button',
            {
              type: 'button',
              role: 'tab',
              'aria-selected': String(isActive),
              class: `tab-btn${isActive ? ' tab-btn--active' : ''}`,
            },
            [
              el('span', { class: 'tab-btn__label' }, [tab.label]),
              tab.badge
                ? el('span', { class: 'tab-btn__badge', 'aria-hidden': 'true' }, [
                    tab.badge,
                  ])
                : null,
            ],
          );
          btn.addEventListener('click', () => switchTab(tab.id));
          return btn;
        }),
      ),
    ],
  );

  root.append(header, main, bottomNav);
}

renderApp();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(() => {
        // Ignore registration errors in restricted contexts
      });
  });
}
