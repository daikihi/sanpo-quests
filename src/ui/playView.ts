import {
  DIFFICULTY_LABELS,
  REVEAL_MODE_LABELS,
  RULE_CATEGORY_LABELS,
  type FamiliarSpot,
  type GeneratedSession,
  type GeoPoint,
  type ResolvedRule,
  type RuleEventPayload,
} from '../domain/types.ts';
import { createSanpoMapView, type SanpoMapController } from '../map/mapView.ts';
import { el, requestOneShotPosition, showToast } from './dom.ts';

export interface PlayViewProps {
  session: GeneratedSession | null;
  familiarSpots: FamiliarSpot[];
  showDirectionIcons: boolean;
  onRuleEvent: (ruleId: string, event: RuleEventPayload) => void;
  onSecretLocationCheck: (point: GeoPoint) => void;
  onMemoChange: (memo: string) => void;
  onToggleDirectionIcons: (visible: boolean) => void;
  onFinishSession: () => void;
  onGoToDraw: () => void;
  onOpenSpots: () => void;
}

export interface MountedPlayView {
  element: HTMLElement;
  sessionId: string | null;
  update: (session: GeneratedSession, familiarSpots: FamiliarSpot[]) => void;
  cleanup: () => void;
}

function formatElapsed(startedAt?: string): string {
  if (!startedAt) return '00:00';
  const diffSec = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(startedAt)) / 1000),
  );
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function renderRuleActionButtons(
  rule: ResolvedRule,
  hasHistory: boolean,
  isHintMode: boolean,
  onEvent: (event: RuleEventPayload) => void,
  onLocationRequest: () => Promise<void>,
): HTMLElement {
  const row = el('div', { class: 'eval-actions' });
  const ev = rule.evaluator;

  if (ev.kind === 'manual') {
    if (rule.unitBonus > 0) {
      const bonusBtn = el(
        'button',
        { type: 'button', class: 'btn btn--bonus' },
        [
          isHintMode
            ? '＋ 達成を記録'
            : `＋ ${ev.bonusLabel ?? '達成'} (+${rule.unitBonus}pt)`,
        ],
      );
      bonusBtn.addEventListener('click', () =>
        onEvent({ type: 'MARK_BONUS', timestamp: new Date().toISOString() }),
      );
      row.append(bonusBtn);
    }
    if (rule.unitPenalty < 0) {
      const penBtn = el(
        'button',
        { type: 'button', class: 'btn btn--penalty' },
        [
          isHintMode
            ? '− 違反を記録'
            : `− ${ev.penaltyLabel ?? '違反'} (${rule.unitPenalty}pt)`,
        ],
      );
      penBtn.addEventListener('click', () =>
        onEvent({ type: 'MARK_PENALTY', timestamp: new Date().toISOString() }),
      );
      row.append(penBtn);
    }
  } else if (ev.kind === 'counter') {
    const countBtn = el(
      'button',
      { type: 'button', class: 'btn btn--primary' },
      [isHintMode ? '+1 カウント' : ev.actionLabel],
    );
    countBtn.addEventListener('click', () =>
      onEvent({
        type: 'INCREMENT_COUNTER',
        timestamp: new Date().toISOString(),
      }),
    );
    row.append(countBtn);
  } else if (ev.kind === 'location_check') {
    const locBtn = el(
      'button',
      { type: 'button', class: 'btn btn--primary' },
      [isHintMode ? '現在地をチェック' : (ev.actionLabel ?? '現在地チェック')],
    );
    locBtn.addEventListener('click', async () => {
      locBtn.disabled = true;
      const original = locBtn.textContent;
      locBtn.textContent = '位置取得中...';
      try {
        await onLocationRequest();
      } finally {
        locBtn.disabled = false;
        locBtn.textContent = original;
      }
    });
    row.append(locBtn);
  } else if (ev.kind === 'session_rule') {
    row.append(
      el('span', { class: 'badge badge--neutral' }, [
        ev.maxDurationMinutes !== undefined
          ? '終了時に経過時間で自動判定'
          : '終了時に完走ステータスで自動判定',
      ]),
    );
  }

  if (hasHistory) {
    const undoBtn = el(
      'button',
      { type: 'button', class: 'btn btn--ghost btn--sm' },
      ['1手戻す (Undo)'],
    );
    undoBtn.addEventListener('click', () => onEvent({ type: 'UNDO_LAST' }));
    row.append(undoBtn);
  }

  return row;
}

export function mountPlayView(props: PlayViewProps): MountedPlayView {
  let currentSession = props.session;
  let currentSpots = props.familiarSpots;

  if (!currentSession) {
    const goBtn = el(
      'button',
      { type: 'button', class: 'btn btn--primary btn--lg' },
      ['抽選・編成タブへ移動'],
    );
    goBtn.addEventListener('click', props.onGoToDraw);

    const empty = el('div', { class: 'empty-card' }, [
      el('h2', {}, ['進行中の散歩はありません']),
      el('p', {}, [
        'まずは「抽選・編成」タブで条件を選び、縛りルールを抽選してスタートしてください。',
      ]),
      goBtn,
    ]);
    return {
      element: empty,
      sessionId: null,
      update: () => {},
      cleanup: () => {},
    };
  }

  let mapController: SanpoMapController | null = null;

  const timerValue = el('strong', { class: 'metric-value' }, [
    formatElapsed(currentSession.startedAt),
  ]);
  const difficultyValue = el('strong', { class: 'metric-value' }, ['']);
  const scoreValue = el('strong', { class: 'metric-value metric-value--score' }, ['']);

  const timerId = window.setInterval(() => {
    if (currentSession) {
      timerValue.textContent = formatElapsed(currentSession.startedAt);
    }
  }, 1000);

  const summaryBar = el('section', { class: 'card status-strip' }, [
    el('div', { class: 'status-strip__item' }, [
      el('span', { class: 'metric-label' }, ['経過時間']),
      timerValue,
    ]),
    el('div', { class: 'status-strip__item' }, [
      el('span', { class: 'metric-label' }, ['縛り / 難易度']),
      difficultyValue,
    ]),
    el('div', { class: 'status-strip__item' }, [
      el('span', { class: 'metric-label' }, ['現在スコア']),
      scoreValue,
    ]),
  ]);

  const rulesSection = el('section', { class: 'stack' });

  function renderDynamicContent(
    session: GeneratedSession,
    spots: FamiliarSpot[],
  ): void {
    const isSecret = session.config.revealMode === 'blind_secret';
    const isHint = session.config.revealMode === 'blind_hint';

    timerValue.textContent = formatElapsed(session.startedAt);
    difficultyValue.textContent = `${session.rules.length}件・${DIFFICULTY_LABELS[session.config.difficulty]}`;
    scoreValue.textContent = isSecret ? '終了時に開示' : `${session.totalScore}pt`;

    rulesSection.innerHTML = '';

    if (isSecret) {
      const secretCheckBtn = el(
        'button',
        { type: 'button', class: 'btn btn--secondary btn--full' },
        ['現在地をサイレント記録（自動判定用）'],
      );
      secretCheckBtn.addEventListener('click', async () => {
        secretCheckBtn.disabled = true;
        secretCheckBtn.textContent = '位置取得中...';
        try {
          const point = await requestOneShotPosition();
          props.onSecretLocationCheck(point);
          mapController?.setUserLocation(point, true);
          mapController?.appendTrackPoint(point);
          showToast('現在地を記録しました（判定結果は終了時に開示）', 'success');
        } catch (err) {
          showToast(
            err instanceof Error ? err.message : '現在地の取得に失敗しました',
            'error',
          );
        } finally {
          secretCheckBtn.disabled = false;
          secretCheckBtn.textContent = '現在地をサイレント記録（自動判定用）';
        }
      });

      rulesSection.append(
        el('article', { class: 'card secret-banner' }, [
          el('div', { class: 'rule-card__badges' }, [
            el('span', { class: 'badge badge--secret' }, [
              REVEAL_MODE_LABELS.blind_secret,
            ]),
            el('span', { class: 'badge badge--neutral' }, [
              `縛り数 ${session.rules.length} / ${DIFFICULTY_LABELS[session.config.difficulty]}`,
            ]),
          ]),
          el('h2', { class: 'secret-banner__title' }, [
            `？？？ × ${session.rules.length}`,
          ]),
          el('p', { class: 'rule-card__desc' }, [
            'すべての縛りルールは伏せられています。自由に街を歩き、気づいたことは下のメモに残しましょう。終了時にルールと自動採点結果を一括開示し、振り返り自己採点で最終スコアを確定します。',
          ]),
          secretCheckBtn,
        ]),
      );
      return;
    }

    for (const rule of session.rules) {
      const state = session.progress[rule.ruleId];
      const delta = state?.scoreDelta ?? 0;
      const deltaText = delta >= 0 ? `+${delta}pt` : `${delta}pt`;

      const badges = [
        el('span', { class: 'badge badge--category' }, [
          RULE_CATEGORY_LABELS[rule.category],
        ]),
        !isHint
          ? el(
              'span',
              {
                class: `badge ${delta > 0 ? 'badge--bonus' : delta < 0 ? 'badge--penalty' : 'badge--neutral'}`,
              },
              [deltaText],
            )
          : el('span', { class: 'badge badge--hint' }, ['ヒントモード']),
      ];

      const counterLine =
        rule.evaluator.kind === 'counter'
          ? el('p', { class: 'counter-status' }, [
              `現在カウント: ${state?.counterValue ?? 0}${rule.evaluator.unitLabel}`,
              !isHint && rule.evaluator.targetCount !== undefined
                ? ` / 目標 ${rule.evaluator.targetCount}${rule.evaluator.unitLabel}`
                : '',
              !isHint && rule.evaluator.maxAllowedCount !== undefined
                ? ` / 上限 ${rule.evaluator.maxAllowedCount}${rule.evaluator.unitLabel}`
                : '',
            ])
          : null;

      const lastDetail =
        !isHint && state?.lastCheckDetail
          ? el('p', { class: 'check-detail' }, [state.lastCheckDetail])
          : null;

      const actions = renderRuleActionButtons(
        rule,
        (state?.history.length ?? 0) > 0,
        isHint,
        (ev) => props.onRuleEvent(rule.ruleId, ev),
        async () => {
          if (spots.length === 0) {
            showToast('先に「馴染み場所」を1件以上登録してください', 'error');
            props.onOpenSpots();
            return;
          }
          try {
            const point = await requestOneShotPosition();
            mapController?.setUserLocation(point, true);
            mapController?.appendTrackPoint(point);
            props.onRuleEvent(rule.ruleId, {
              type: 'LOCATION_CHECK',
              timestamp: new Date().toISOString(),
              point,
              familiarSpots: spots,
            });
            showToast('現在地チェックを反映しました', 'success');
          } catch (err) {
            showToast(
              err instanceof Error ? err.message : '位置情報の取得に失敗しました',
              'error',
            );
          }
        },
      );

      rulesSection.append(
        el('article', { class: 'card rule-card' }, [
          el('div', { class: 'rule-card__badges' }, badges),
          el('h3', { class: 'rule-card__title' }, [
            isHint ? rule.hintTitle : rule.title,
          ]),
          !isHint
            ? el('p', { class: 'rule-card__desc' }, [rule.description])
            : el('p', { class: 'rule-card__desc' }, [
                'ヒントを頼りに判定を記録してください（詳細配点は終了時に開示）。',
              ]),
          counterLine,
          lastDetail,
          actions,
        ]),
      );
    }
  }

  // --- Map section (MapLibre GL JS + OpenFreeMap) ---
  const mapStatusEl = el('p', { class: 'helper-text map-status' }, [
    'OpenFreeMap 読み込み中（鉄道網・河川レイヤー強調 / 5〜10km圏目安）',
  ]);
  const mapCanvas = el('div', {
    class: 'map-canvas',
    role: 'region',
    tabindex: '0',
    'aria-label': '散歩エリア地図（鉄道網と河川を強調表示）',
  });

  const directionCheckbox = el('input', {
    id: 'toggle-direction-icons',
    type: 'checkbox',
    checked: props.showDirectionIcons,
  });
  directionCheckbox.addEventListener('change', () => {
    const visible = directionCheckbox.checked;
    mapController?.setDirectionIconsVisible(visible);
    props.onToggleDirectionIcons(visible);
  });

  const locateBtn = el(
    'button',
    { type: 'button', class: 'btn btn--secondary btn--sm' },
    ['現在地へ移動'],
  );
  locateBtn.addEventListener('click', async () => {
    locateBtn.disabled = true;
    locateBtn.textContent = '取得中...';
    try {
      const point = await requestOneShotPosition();
      mapController?.setUserLocation(point, true);
      showToast('現在地へ移動しました', 'success');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : '現在地の取得に失敗しました',
        'error',
      );
    } finally {
      locateBtn.disabled = false;
      locateBtn.textContent = '現在地へ移動';
    }
  });

  const mapCard = el('section', { class: 'card map-card' }, [
    el('div', { class: 'card__header' }, [
      el('h2', { class: 'card__title' }, ['エリアマップ（鉄道・河川）']),
      locateBtn,
    ]),
    el('div', { class: 'map-toolbar' }, [
      el('div', { class: 'map-legend' }, [
        el('span', { class: 'legend-item' }, [
          el('span', {
            class: 'legend-swatch legend-swatch--rail',
            'aria-hidden': 'true',
          }),
          '鉄道網',
        ]),
        el('span', { class: 'legend-item' }, [
          el('span', {
            class: 'legend-swatch legend-swatch--water',
            'aria-hidden': 'true',
          }),
          '河川・水辺',
        ]),
      ]),
      el('label', { class: 'toggle-control', for: 'toggle-direction-icons' }, [
        directionCheckbox,
        el('span', {}, ['進行方向アイコン']),
      ]),
    ]),
    mapCanvas,
    mapStatusEl,
  ]);

  // --- Memo & Finish ---
  const memoArea = el('textarea', {
    id: 'walk-memo-input',
    rows: 3,
    placeholder: '立ち寄ったお店、見つけた看板、気づいたことなどをメモ...',
  });
  memoArea.value = currentSession.memo;
  memoArea.addEventListener('input', () => {
    props.onMemoChange(memoArea.value);
  });

  const isBlindInitial = currentSession.config.revealMode !== 'open';
  const finishBtn = el(
    'button',
    { type: 'button', class: 'btn btn--accent btn--lg btn--full' },
    [
      isBlindInitial
        ? '散歩を終了してルールを開示する'
        : '散歩を終了して結果を確定する',
    ],
  );
  finishBtn.addEventListener('click', props.onFinishSession);

  const memoCard = el('section', { class: 'card' }, [
    el('div', { class: 'form-field' }, [
      el('label', { for: 'walk-memo-input', class: 'control-label' }, [
        '途中メモ（自動保存）',
      ]),
      memoArea,
    ]),
    finishBtn,
  ]);

  renderDynamicContent(currentSession, currentSpots);

  const root = el('div', { class: 'view-stack' }, [
    summaryBar,
    rulesSection,
    mapCard,
    memoCard,
  ]);

  window.requestAnimationFrame(() => {
    if (!mapCanvas.isConnected) return;
    try {
      mapController = createSanpoMapView({
        container: mapCanvas,
        initialSpots: currentSpots,
        showDirectionIcons: props.showDirectionIcons,
        onStatusChange: (msg) => {
          mapStatusEl.textContent = msg;
        },
      });
    } catch {
      mapStatusEl.textContent =
        'この環境では WebGL 地図を初期化できませんでした（ルール判定は引き続き利用できます）';
    }
  });

  return {
    element: root,
    sessionId: currentSession.id,
    update(nextSession: GeneratedSession, nextSpots: FamiliarSpot[]) {
      currentSession = nextSession;
      currentSpots = nextSpots;
      renderDynamicContent(nextSession, nextSpots);
      mapController?.setFamiliarSpots(nextSpots);
    },
    cleanup: () => {
      window.clearInterval(timerId);
      mapController?.destroy();
      mapController = null;
    },
  };
}
