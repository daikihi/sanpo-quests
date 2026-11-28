import {
  DIFFICULTY_LABELS,
  DIFFICULTY_WEIGHTS,
  REVEAL_MODE_LABELS,
  RULE_CATEGORIES,
  RULE_CATEGORY_LABELS,
  WALK_MODE_LABELS,
  type Difficulty,
  type GeneratedSession,
  type RevealMode,
  type RuleCategory,
  type RuleCount,
  type SessionConfig,
  type WalkMode,
} from '../domain/types.ts';
import { el } from './dom.ts';

export interface DrawViewProps {
  config: SessionConfig;
  draftSession: GeneratedSession | null;
  familiarSpotCount: number;
  totalRuleCount: number;
  onConfigChange: (next: SessionConfig) => void;
  onDraw: () => void;
  onTogglePin: (index: number) => void;
  onRerollOne: (index: number) => void;
  onStartWalk: () => void;
  onOpenCatalog: () => void;
  onOpenSpots: () => void;
  onOpenImport: () => void;
}

const REVEAL_DESCRIPTIONS: Record<RevealMode, string> = {
  open: 'ルール名・詳細・配点をすべて見ながら歩きます。',
  blind_hint: '抽象ヒントだけを見て歩き、具体的な条件や配点は終了時に開示します。',
  blind_secret: 'ルールを「？？？」で完全非表示。縛り数と難易度だけで歩き、終了時に一括開示します。',
};

function renderSegmented<T extends string | number>(
  label: string,
  options: Array<{ value: T; title: string; sub?: string }>,
  selected: T,
  onSelect: (value: T) => void,
  groupClass = 'seg-group',
): HTMLElement {
  const buttons = options.map((opt) => {
    const isSelected = opt.value === selected;
    const btn = el(
      'button',
      {
        type: 'button',
        class: `seg-btn${isSelected ? ' seg-btn--active' : ''}`,
        'aria-pressed': String(isSelected),
      },
      [
        el('span', { class: 'seg-btn__title' }, [opt.title]),
        opt.sub ? el('span', { class: 'seg-btn__sub' }, [opt.sub]) : null,
      ],
    );
    btn.addEventListener('click', () => onSelect(opt.value));
    return btn;
  });

  return el('fieldset', { class: 'control-group' }, [
    el('legend', { class: 'control-label' }, [label]),
    el('div', { class: groupClass }, buttons),
  ]);
}

const RULE_COUNT_OPTIONS: Array<{ value: RuleCount; title: string; sub: string }> = [
  { value: 1, title: '1個', sub: 'ゆるめ' },
  { value: 2, title: '2個', sub: '定番' },
  { value: 3, title: '3個', sub: 'しっかり' },
  { value: 4, title: '4個', sub: '挑戦' },
  { value: 5, title: '5個', sub: '全カテゴリ' },
  { value: 6, title: '6個', sub: 'ハード' },
  { value: 7, title: '7個', sub: '超難関' },
  { value: 8, title: '8個', sub: '限界突破' },
];

export function renderDrawView(props: DrawViewProps): HTMLElement {
  const { config, draftSession, familiarSpotCount, totalRuleCount } = props;

  const settingsCard = el('section', { class: 'card' }, [
    el('div', { class: 'card__header' }, [
      el('h2', { class: 'card__title' }, ['散歩の条件をセット']),
      el('div', { class: 'toolbar' }, [
        (() => {
          const btn = el(
            'button',
            { type: 'button', class: 'btn btn--secondary btn--sm' },
            [`ルール一覧 (${totalRuleCount})`],
          );
          btn.addEventListener('click', props.onOpenCatalog);
          return btn;
        })(),
        (() => {
          const btn = el(
            'button',
            { type: 'button', class: 'btn btn--ghost btn--sm' },
            [`馴染み場所 (${familiarSpotCount})`],
          );
          btn.addEventListener('click', props.onOpenSpots);
          return btn;
        })(),
        (() => {
          const btn = el(
            'button',
            { type: 'button', class: 'btn btn--ghost btn--sm' },
            ['JSON読込'],
          );
          btn.addEventListener('click', props.onOpenImport);
          return btn;
        })(),
      ]),
    ]),

    renderSegmented<RuleCount>(
      '縛り数（1〜8個）',
      RULE_COUNT_OPTIONS,
      config.ruleCount,
      (ruleCount) => props.onConfigChange({ ...config, ruleCount }),
      'seg-group seg-group--count8',
    ),

    renderSegmented<Difficulty>(
      '難易度（加点 × / 減点 ×）',
      (['light', 'standard', 'hard'] as Difficulty[]).map((d) => ({
        value: d,
        title: DIFFICULTY_LABELS[d],
        sub: `+×${DIFFICULTY_WEIGHTS[d].bonus} / -×${DIFFICULTY_WEIGHTS[d].penalty}`,
      })),
      config.difficulty,
      (difficulty) => props.onConfigChange({ ...config, difficulty }),
    ),

    renderSegmented<RevealMode>(
      '公開モード',
      (['open', 'blind_hint', 'blind_secret'] as RevealMode[]).map((mode) => ({
        value: mode,
        title:
          mode === 'open'
            ? 'オープン'
            : mode === 'blind_hint'
              ? 'ヒントのみ'
              : 'シークレット',
      })),
      config.revealMode,
      (revealMode) => props.onConfigChange({ ...config, revealMode }),
    ),
    el('p', { class: 'helper-text' }, [REVEAL_DESCRIPTIONS[config.revealMode]]),

    renderSegmented<WalkMode>(
      '同行形態',
      (['solo', 'pair'] as WalkMode[]).map((mode) => ({
        value: mode,
        title: WALK_MODE_LABELS[mode],
      })),
      config.walkMode,
      (walkMode) => props.onConfigChange({ ...config, walkMode }),
    ),

    el('fieldset', { class: 'control-group' }, [
      el('legend', { class: 'control-label' }, [
        '除外カテゴリ（タップで抽選から除外）',
      ]),
      el(
        'div',
        { class: 'chip-group' },
        RULE_CATEGORIES.map((cat: RuleCategory) => {
          const excluded = config.excludedCategories.includes(cat);
          const chip = el(
            'button',
            {
              type: 'button',
              class: `chip${excluded ? ' chip--excluded' : ''}`,
              'aria-pressed': String(excluded),
            },
            [excluded ? `✕ ${RULE_CATEGORY_LABELS[cat]}` : RULE_CATEGORY_LABELS[cat]],
          );
          chip.addEventListener('click', () => {
            const nextExcluded = excluded
              ? config.excludedCategories.filter((c) => c !== cat)
              : [...config.excludedCategories, cat];
            props.onConfigChange({
              ...config,
              excludedCategories: nextExcluded,
            });
          });
          return chip;
        }),
      ),
    ]),

    (() => {
      const drawBtn = el(
        'button',
        { type: 'button', class: 'btn btn--primary btn--lg btn--full' },
        [
          draftSession
            ? '未固定の縛りを一括再抽選する'
            : 'この条件で縛りを抽選する',
        ],
      );
      drawBtn.addEventListener('click', props.onDraw);
      return drawBtn;
    })(),
  ]);

  const resultSection = el('section', { class: 'stack' });

  if (draftSession && draftSession.rules.length > 0) {
    const isSecret = config.revealMode === 'blind_secret';
    const isHint = config.revealMode === 'blind_hint';

    resultSection.append(
      el('div', { class: 'section-header' }, [
        el('h2', { class: 'section-title' }, [
          `抽選された縛り（${draftSession.rules.length}件 / ${REVEAL_MODE_LABELS[config.revealMode]}）`,
        ]),
        el('span', { class: 'badge badge--neutral' }, [
          DIFFICULTY_LABELS[config.difficulty],
        ]),
      ]),
    );

    const cardsContainer = el('div', { class: 'rule-grid' });

    draftSession.rules.forEach((rule, index) => {
      const pinBtn = el(
        'button',
        {
          type: 'button',
          class: `btn btn--sm ${rule.pinned ? 'btn--pinned' : 'btn--secondary'}`,
          'aria-pressed': String(rule.pinned),
        },
        [rule.pinned ? 'ピン留め中' : 'ピン留め'],
      );
      pinBtn.addEventListener('click', () => props.onTogglePin(index));

      const rerollBtn = el(
        'button',
        {
          type: 'button',
          class: 'btn btn--sm btn--ghost',
          disabled: rule.pinned,
        },
        ['リロール'],
      );
      rerollBtn.addEventListener('click', () => props.onRerollOne(index));

      const cardBody: Array<Node | null> = [];

      if (isSecret) {
        cardBody.push(
          el('div', { class: 'rule-card__badges' }, [
            el('span', { class: 'badge badge--secret' }, [
              `シークレット #${index + 1}`,
            ]),
            el('span', { class: 'badge badge--neutral' }, [
              DIFFICULTY_LABELS[config.difficulty],
            ]),
          ]),
          el('h3', { class: 'rule-card__title rule-card__title--secret' }, [
            '？？？',
          ]),
          el('p', { class: 'rule-card__desc' }, [
            'ルール内容と配点は散歩終了時に開示されます。気に入らなければリロールも可能です。',
          ]),
        );
      } else if (isHint) {
        cardBody.push(
          el('div', { class: 'rule-card__badges' }, [
            el('span', { class: 'badge badge--category' }, [
              RULE_CATEGORY_LABELS[rule.category],
            ]),
            el('span', { class: 'badge badge--hint' }, ['条件秘匿']),
          ]),
          el('h3', { class: 'rule-card__title' }, [rule.hintTitle]),
          el('p', { class: 'rule-card__desc' }, [
            '具体的な達成/違反条件と配点は終了時に開示されます。',
          ]),
        );
      } else {
        cardBody.push(
          el('div', { class: 'rule-card__badges' }, [
            el('span', { class: 'badge badge--category' }, [
              RULE_CATEGORY_LABELS[rule.category],
            ]),
            rule.unitBonus > 0
              ? el('span', { class: 'badge badge--bonus' }, [
                  `+${rule.unitBonus}pt`,
                ])
              : null,
            rule.unitPenalty < 0
              ? el('span', { class: 'badge badge--penalty' }, [
                  `${rule.unitPenalty}pt`,
                ])
              : null,
          ]),
          el('h3', { class: 'rule-card__title' }, [rule.title]),
          el('p', { class: 'rule-card__desc' }, [rule.description]),
        );
      }

      cardsContainer.append(
        el(
          'article',
          {
            class: `card rule-card${rule.pinned ? ' rule-card--pinned' : ''}`,
          },
          [
            ...cardBody,
            el('div', { class: 'rule-card__actions' }, [pinBtn, rerollBtn]),
          ],
        ),
      );
    });

    resultSection.append(cardsContainer);

    const startBtn = el(
      'button',
      { type: 'button', class: 'btn btn--accent btn--lg btn--full' },
      ['この縛りで散歩をスタート'],
    );
    startBtn.addEventListener('click', props.onStartWalk);
    resultSection.append(startBtn);
  } else {
    resultSection.append(
      el('div', { class: 'empty-card' }, [
        el('p', {}, [
          '上のボタンから縛りルールを抽選すると、ここに候補が表示されます。',
        ]),
        el('p', { class: 'helper-text' }, [
          '気に入った枠はピン留めして残りの枠だけリロールできます。',
        ]),
      ]),
    );
  }

  return el('div', { class: 'view-stack' }, [settingsCard, resultSection]);
}
