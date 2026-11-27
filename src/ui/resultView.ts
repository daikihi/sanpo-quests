import {
  DIFFICULTY_LABELS,
  REVEAL_MODE_LABELS,
  RULE_CATEGORY_LABELS,
  WALK_MODE_LABELS,
  type GeneratedSession,
  type RuleEventPayload,
} from '../domain/types.ts';
import { summarizeScoreBreakdown } from '../domain/scorer.ts';
import {
  exportSessionJson,
  formatWalkMemoText,
} from '../storage/localStore.ts';
import { copyToClipboard, downloadTextFile, el, showToast } from './dom.ts';

export interface ResultViewProps {
  selectedSession: GeneratedSession | null;
  history: GeneratedSession[];
  onSelectSession: (sessionId: string) => void;
  onDeleteHistory: (sessionId: string) => void;
  onRetroactiveRuleEvent: (
    sessionId: string,
    ruleId: string,
    event: RuleEventPayload,
  ) => void;
  onStartNewWalk: () => void;
}

function formatDateShort(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function renderResultView(props: ResultViewProps): HTMLElement {
  const { selectedSession, history } = props;
  const stack = el('div', { class: 'view-stack' });

  if (!selectedSession) {
    const newBtn = el(
      'button',
      { type: 'button', class: 'btn btn--primary btn--lg' },
      ['新しい散歩を抽選する'],
    );
    newBtn.addEventListener('click', props.onStartNewWalk);

    stack.append(
      el('div', { class: 'empty-card' }, [
        el('h2', {}, ['まだ完了した散歩記録がありません']),
        el('p', {}, [
          '散歩を終了すると、ここに最終スコア・シークレット開示結果・連携 JSON 出力が表示されます。',
        ]),
        newBtn,
      ]),
    );
    return stack;
  }

  const breakdown = summarizeScoreBreakdown(
    selectedSession.baseScore,
    selectedSession.rules,
    selectedSession.progress,
  );

  const wasBlind = selectedSession.config.revealMode !== 'open';

  // --- Score Summary Card ---
  const scoreCard = el('section', { class: 'card score-hero' }, [
    wasBlind
      ? el('div', { class: 'reveal-callout' }, [
          `🔓 ${REVEAL_MODE_LABELS[selectedSession.config.revealMode]}を開示しました！下のルールを確認して自己採点を微調整できます。`,
        ])
      : null,
    el('div', { class: 'score-hero__meta' }, [
      el('span', { class: 'badge badge--neutral' }, [
        formatDateShort(
          selectedSession.completedAt ?? selectedSession.createdAt,
        ),
      ]),
      el('span', { class: 'badge badge--category' }, [
        `${DIFFICULTY_LABELS[selectedSession.config.difficulty]} / ${WALK_MODE_LABELS[selectedSession.config.walkMode]}`,
      ]),
    ]),
    el('div', { class: 'score-hero__main' }, [
      el('span', { class: 'metric-label' }, ['最終スコア']),
      el('strong', { class: 'score-hero__value' }, [
        `${breakdown.totalScore}pt`,
      ]),
    ]),
    el('div', { class: 'score-breakdown' }, [
      el('div', { class: 'score-breakdown__item' }, [
        el('span', {}, ['基礎点']),
        el('strong', {}, [`${breakdown.baseScore}pt`]),
      ]),
      el('div', { class: 'score-breakdown__item score-breakdown__item--bonus' }, [
        el('span', {}, ['加点合計']),
        el('strong', {}, [`+${breakdown.totalBonus}pt`]),
      ]),
      el('div', { class: 'score-breakdown__item score-breakdown__item--penalty' }, [
        el('span', {}, ['減点合計']),
        el('strong', {}, [`${breakdown.totalPenalty}pt`]),
      ]),
    ]),
  ]);

  stack.append(scoreCard);

  // --- Disclosed rules + retroactive self-scoring ---
  const rulesSection = el('section', { class: 'stack' }, [
    el('div', { class: 'section-header' }, [
      el('h2', { class: 'section-title' }, ['開示ルール & 振り返り採点']),
    ]),
  ]);

  for (const rule of selectedSession.rules) {
    const state = selectedSession.progress[rule.ruleId];
    const delta = state?.scoreDelta ?? 0;
    const deltaText = delta >= 0 ? `+${delta}pt` : `${delta}pt`;

    const adjustBar = el('div', { class: 'eval-actions' });
    if (rule.evaluator.kind === 'manual') {
      if (rule.unitBonus > 0) {
        const bBtn = el(
          'button',
          { type: 'button', class: 'btn btn--bonus btn--sm' },
          [`＋達成 (+${rule.unitBonus}pt)`],
        );
        bBtn.addEventListener('click', () =>
          props.onRetroactiveRuleEvent(selectedSession.id, rule.ruleId, {
            type: 'MARK_BONUS',
            timestamp: new Date().toISOString(),
          }),
        );
        adjustBar.append(bBtn);
      }
      if (rule.unitPenalty < 0) {
        const pBtn = el(
          'button',
          { type: 'button', class: 'btn btn--penalty btn--sm' },
          [`−違反 (${rule.unitPenalty}pt)`],
        );
        pBtn.addEventListener('click', () =>
          props.onRetroactiveRuleEvent(selectedSession.id, rule.ruleId, {
            type: 'MARK_PENALTY',
            timestamp: new Date().toISOString(),
          }),
        );
        adjustBar.append(pBtn);
      }
    } else if (rule.evaluator.kind === 'counter') {
      const cBtn = el(
        'button',
        { type: 'button', class: 'btn btn--secondary btn--sm' },
        [`+1 ${rule.evaluator.unitLabel}記録`],
      );
      cBtn.addEventListener('click', () =>
        props.onRetroactiveRuleEvent(selectedSession.id, rule.ruleId, {
          type: 'INCREMENT_COUNTER',
          timestamp: new Date().toISOString(),
        }),
      );
      adjustBar.append(cBtn);
    }

    if ((state?.history.length ?? 0) > 0) {
      const undoBtn = el(
        'button',
        { type: 'button', class: 'btn btn--ghost btn--sm' },
        ['Undo'],
      );
      undoBtn.addEventListener('click', () =>
        props.onRetroactiveRuleEvent(selectedSession.id, rule.ruleId, {
          type: 'UNDO_LAST',
        }),
      );
      adjustBar.append(undoBtn);
    }

    rulesSection.append(
      el('article', { class: 'card rule-card' }, [
        el('div', { class: 'rule-card__badges' }, [
          el('span', { class: 'badge badge--category' }, [
            RULE_CATEGORY_LABELS[rule.category],
          ]),
          el(
            'span',
            {
              class: `badge ${delta > 0 ? 'badge--bonus' : delta < 0 ? 'badge--penalty' : 'badge--neutral'}`,
            },
            [deltaText],
          ),
        ]),
        el('h3', { class: 'rule-card__title' }, [rule.title]),
        el('p', { class: 'rule-card__desc' }, [rule.description]),
        state?.lastCheckDetail
          ? el('p', { class: 'check-detail' }, [state.lastCheckDetail])
          : null,
        adjustBar.childElementCount > 0 ? adjustBar : null,
      ]),
    );
  }
  stack.append(rulesSection);

  // --- Export & Handoff ---
  const memoText = formatWalkMemoText(selectedSession);
  const jsonText = exportSessionJson(selectedSession);

  const copyMemoBtn = el(
    'button',
    { type: 'button', class: 'btn btn--primary' },
    ['散歩メモをコピー'],
  );
  copyMemoBtn.addEventListener('click', async () => {
    const ok = await copyToClipboard(memoText);
    showToast(
      ok ? '散歩メモをクリップボードにコピーしました' : 'コピーに失敗しました',
      ok ? 'success' : 'error',
    );
  });

  const copyJsonBtn = el(
    'button',
    { type: 'button', class: 'btn btn--secondary' },
    ['連携JSONをコピー'],
  );
  copyJsonBtn.addEventListener('click', async () => {
    const ok = await copyToClipboard(jsonText);
    showToast(
      ok ? '連携用 JSON をコピーしました' : 'コピーに失敗しました',
      ok ? 'success' : 'error',
    );
  });

  const downloadJsonBtn = el(
    'button',
    { type: 'button', class: 'btn btn--secondary' },
    ['.json を保存'],
  );
  downloadJsonBtn.addEventListener('click', () => {
    const stamp = (selectedSession.completedAt ?? selectedSession.createdAt)
      .slice(0, 16)
      .replace(/[-:T]/g, '');
    downloadTextFile(`sanpo-quests-${stamp}.json`, jsonText);
    showToast('JSON ファイルをダウンロードしました', 'success');
  });

  const exportCard = el('section', { class: 'card' }, [
    el('h2', { class: 'card__title' }, ['メモ出力 & 連携 JSON']),
    el('div', { class: 'export-actions' }, [
      copyMemoBtn,
      copyJsonBtn,
      downloadJsonBtn,
    ]),
    el('details', { class: 'preview-details' }, [
      el('summary', {}, ['散歩メモのプレビューを表示']),
      el('pre', { class: 'code-preview' }, [memoText]),
    ]),
  ]);
  stack.append(exportCard);

  // --- History List ---
  if (history.length > 0) {
    const list = el('div', { class: 'history-list' });
    for (const item of history) {
      const isActive = item.id === selectedSession.id;
      const selectBtn = el(
        'button',
        {
          type: 'button',
          class: `history-row${isActive ? ' history-row--active' : ''}`,
        },
        [
          el('div', { class: 'history-row__info' }, [
            el('strong', {}, [
              `${formatDateShort(item.completedAt ?? item.createdAt)} · ${item.totalScore}pt`,
            ]),
            el('span', { class: 'history-row__meta' }, [
              `${DIFFICULTY_LABELS[item.config.difficulty]} / ${REVEAL_MODE_LABELS[item.config.revealMode]} / 縛り${item.rules.length}件`,
            ]),
          ]),
        ],
      );
      selectBtn.addEventListener('click', () => props.onSelectSession(item.id));

      const deleteBtn = el(
        'button',
        {
          type: 'button',
          class: 'btn btn--ghost-danger btn--sm',
          'aria-label': '履歴を削除',
        },
        ['削除'],
      );
      deleteBtn.addEventListener('click', () => {
        props.onDeleteHistory(item.id);
        showToast('履歴を削除しました', 'info');
      });

      list.append(el('div', { class: 'history-item' }, [selectBtn, deleteBtn]));
    }

    stack.append(
      el('section', { class: 'card' }, [
        el('div', { class: 'card__header' }, [
          el('h2', { class: 'card__title' }, [`過去の散歩履歴 (${history.length})`]),
          (() => {
            const btn = el(
              'button',
              { type: 'button', class: 'btn btn--ghost btn--sm' },
              ['新しい散歩へ'],
            );
            btn.addEventListener('click', props.onStartNewWalk);
            return btn;
          })(),
        ]),
        list,
      ]),
    );
  }

  return stack;
}
