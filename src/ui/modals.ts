import {
  DIFFICULTY_LABELS,
  RULE_CATEGORIES,
  RULE_CATEGORY_LABELS,
  type Difficulty,
  type FamiliarSpot,
  type GeneratedSession,
  type RuleCategory,
  type RuleDefinition,
  type RuleEvaluatorConfig,
  type ScoringType,
  type WalkMode,
} from '../domain/types.ts';
import { resolveRule } from '../domain/generator.ts';
import { importSessionJson } from '../storage/localStore.ts';
import {
  attachDialogLightDismiss,
  el,
  requestOneShotPosition,
  showToast,
} from './dom.ts';

export interface SpotsModalHandlers {
  getSpots: () => FamiliarSpot[];
  onSaveSpot: (spot: FamiliarSpot) => void;
  onDeleteSpot: (spotId: string) => void;
}

export function openSpotsModal(handlers: SpotsModalHandlers): void {
  const existing = document.querySelector<HTMLDialogElement>('#sq-spots-dialog');
  existing?.remove();

  const dialog = el('dialog', {
    id: 'sq-spots-dialog',
    class: 'modal-dialog',
    'aria-labelledby': 'spots-dialog-title',
  });
  attachDialogLightDismiss(dialog);

  const listContainer = el('div', { class: 'spots-list' });

  const nameInput = el('input', {
    id: 'spot-name',
    type: 'text',
    placeholder: '例: 最寄り駅、自宅周辺、渋谷駅',
    required: true,
    autocomplete: 'off',
  });
  const latInput = el('input', {
    id: 'spot-lat',
    type: 'number',
    step: '0.000001',
    min: '-90',
    max: '90',
    placeholder: '35.681236',
    required: true,
  });
  const lngInput = el('input', {
    id: 'spot-lng',
    type: 'number',
    step: '0.000001',
    min: '-180',
    max: '180',
    placeholder: '139.767125',
    required: true,
  });
  const radiusInput = el('input', {
    id: 'spot-radius',
    type: 'number',
    step: '50',
    min: '50',
    max: '5000',
    value: '300',
    required: true,
  });

  const errorBanner = el('p', { class: 'form-error', hidden: true });

  function renderSpotList(): void {
    listContainer.innerHTML = '';
    const spots = handlers.getSpots();
    if (spots.length === 0) {
      listContainer.append(
        el('p', { class: 'muted-note' }, [
          'まだ登録されていません。「よく通る場所・最寄り駅に近づかない」等の距離判定ルールで使われます。',
        ]),
      );
      return;
    }

    for (const spot of spots) {
      const delBtn = el(
        'button',
        {
          type: 'button',
          class: 'btn btn--ghost-danger btn--sm',
          'aria-label': `${spot.name}を削除`,
        },
        ['削除'],
      );
      delBtn.addEventListener('click', () => {
        handlers.onDeleteSpot(spot.id);
        renderSpotList();
        showToast(`「${spot.name}」を削除しました`, 'info');
      });

      listContainer.append(
        el('div', { class: 'spot-row' }, [
          el('div', { class: 'spot-row__info' }, [
            el('strong', {}, [spot.name]),
            el('span', { class: 'spot-row__meta' }, [
              `緯度 ${spot.lat.toFixed(4)} / 経度 ${spot.lng.toFixed(4)} / 半径 ${spot.radiusMeters}m`,
            ]),
          ]),
          delBtn,
        ]),
      );
    }
  }

  const geoBtn = el(
    'button',
    { type: 'button', class: 'btn btn--secondary btn--sm' },
    ['現在地を自動入力'],
  );
  geoBtn.addEventListener('click', async () => {
    geoBtn.disabled = true;
    geoBtn.textContent = '取得中...';
    errorBanner.hidden = true;
    try {
      const pos = await requestOneShotPosition();
      latInput.value = String(pos.lat);
      lngInput.value = String(pos.lng);
      showToast('現在地の座標を入力しました', 'success');
    } catch (err) {
      errorBanner.textContent =
        err instanceof Error ? err.message : '現在地の取得に失敗しました。';
      errorBanner.hidden = false;
    } finally {
      geoBtn.disabled = false;
      geoBtn.textContent = '現在地を自動入力';
    }
  });

  const form = el('form', { class: 'modal-form' }, [
    el('div', { class: 'form-field' }, [
      el('label', { for: 'spot-name' }, ['スポット名']),
      nameInput,
    ]),
    el('div', { class: 'form-grid-2' }, [
      el('div', { class: 'form-field' }, [
        el('label', { for: 'spot-lat' }, ['緯度 (lat)']),
        latInput,
      ]),
      el('div', { class: 'form-field' }, [
        el('label', { for: 'spot-lng' }, ['経度 (lng)']),
        lngInput,
      ]),
    ]),
    el('div', { class: 'form-row-inline' }, [
      el('div', { class: 'form-field form-field--grow' }, [
        el('label', { for: 'spot-radius' }, ['判定半径 (m)']),
        radiusInput,
      ]),
      geoBtn,
    ]),
    errorBanner,
    el('button', { type: 'submit', class: 'btn btn--primary btn--full' }, [
      'スポットを登録',
    ]),
  ]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    errorBanner.hidden = true;
    const name = nameInput.value.trim();
    const lat = Number(latInput.value);
    const lng = Number(lngInput.value);
    const radiusMeters = Number(radiusInput.value);

    if (
      !name ||
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90 ||
      !Number.isFinite(lng) ||
      lng < -180 ||
      lng > 180 ||
      !Number.isFinite(radiusMeters) ||
      radiusMeters < 50
    ) {
      errorBanner.textContent =
        '名称・有効な緯度経度・半径(50m以上)を入力してください。';
      errorBanner.hidden = false;
      return;
    }

    handlers.onSaveSpot({
      id: `spot-${Date.now().toString(36)}`,
      name,
      lat,
      lng,
      radiusMeters,
      createdAt: new Date().toISOString(),
    });
    nameInput.value = '';
    latInput.value = '';
    lngInput.value = '';
    radiusInput.value = '300';
    renderSpotList();
    showToast(`「${name}」を登録しました`, 'success');
  });

  const closeBtn = el(
    'button',
    { type: 'button', class: 'btn btn--icon', 'aria-label': 'モーダルを閉じる' },
    ['✕'],
  );
  closeBtn.addEventListener('click', () => dialog.close());

  dialog.append(
    el('div', { class: 'modal-dialog__inner' }, [
      el('div', { class: 'modal-dialog__header' }, [
        el('h2', { id: 'spots-dialog-title' }, ['よく通る場所の管理']),
        closeBtn,
      ]),
      el('div', { class: 'modal-dialog__body' }, [
        form,
        el('hr', { class: 'divider' }),
        el('h3', { class: 'section-subtitle' }, ['登録済みスポット']),
        listContainer,
      ]),
      el('div', { class: 'modal-dialog__footer' }, [
        (() => {
          const footerClose = el(
            'button',
            { type: 'button', class: 'btn btn--secondary' },
            ['閉じる'],
          );
          footerClose.addEventListener('click', () => dialog.close());
          return footerClose;
        })(),
      ]),
    ]),
  );

  dialog.addEventListener('close', () => dialog.remove());

  renderSpotList();
  document.body.append(dialog);
  dialog.showModal();
}

export function openImportModal(
  onImported: (session: GeneratedSession) => void,
): void {
  const existing = document.querySelector<HTMLDialogElement>(
    '#sq-import-dialog',
  );
  existing?.remove();

  const dialog = el('dialog', {
    id: 'sq-import-dialog',
    class: 'modal-dialog',
    'aria-labelledby': 'import-dialog-title',
  });
  attachDialogLightDismiss(dialog);

  const textarea = el('textarea', {
    id: 'import-json-input',
    rows: 7,
    placeholder: 'エクスポートした Sanpo Quests の JSON を貼り付けてください...',
  });
  const fileInput = el('input', {
    id: 'import-json-file',
    type: 'file',
    accept: '.json,application/json',
  });
  const errorBanner = el('p', { class: 'form-error', hidden: true });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      textarea.value = await file.text();
      errorBanner.hidden = true;
    } catch {
      errorBanner.textContent = 'ファイルの読み込みに失敗しました。';
      errorBanner.hidden = false;
    }
  });

  const submitBtn = el(
    'button',
    { type: 'button', class: 'btn btn--primary btn--full' },
    ['JSON を読み込む'],
  );
  submitBtn.addEventListener('click', () => {
    errorBanner.hidden = true;
    const result = importSessionJson(textarea.value.trim());
    if (!result.ok) {
      errorBanner.textContent = result.error;
      errorBanner.hidden = false;
      return;
    }
    onImported(result.session);
    dialog.close();
    showToast('セッション JSON を読み込みました', 'success');
  });

  const closeBtn = el(
    'button',
    { type: 'button', class: 'btn btn--icon', 'aria-label': 'モーダルを閉じる' },
    ['✕'],
  );
  closeBtn.addEventListener('click', () => dialog.close());

  dialog.append(
    el('div', { class: 'modal-dialog__inner' }, [
      el('div', { class: 'modal-dialog__header' }, [
        el('h2', { id: 'import-dialog-title' }, ['セッション JSON のインポート']),
        closeBtn,
      ]),
      el('div', { class: 'modal-dialog__body' }, [
        el('div', { class: 'form-field' }, [
          el('label', { for: 'import-json-file' }, ['ファイルから選択 (.json)']),
          fileInput,
        ]),
        el('div', { class: 'form-field' }, [
          el('label', { for: 'import-json-input' }, ['または JSON を直接貼り付け']),
          textarea,
        ]),
        errorBanner,
        submitBtn,
      ]),
    ]),
  );

  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

export interface RuleCatalogModalHandlers {
  getDefaultRules: () => RuleDefinition[];
  getCustomRules: () => RuleDefinition[];
  currentDifficulty: Difficulty;
  onAddCustomRule: (rule: RuleDefinition) => void;
  onDeleteCustomRule: (ruleId: string) => void;
}

const EVALUATOR_KIND_LABELS: Record<RuleEvaluatorConfig['kind'], string> = {
  manual: '手動判定',
  counter: 'カウント',
  location_check: '現在地判定',
  session_rule: '完走/時間',
};

export function openRuleCatalogModal(handlers: RuleCatalogModalHandlers): void {
  const existing = document.querySelector<HTMLDialogElement>(
    '#sq-catalog-dialog',
  );
  existing?.remove();

  const dialog = el('dialog', {
    id: 'sq-catalog-dialog',
    class: 'modal-dialog modal-dialog--wide',
    'aria-labelledby': 'catalog-dialog-title',
  });
  attachDialogLightDismiss(dialog);

  let selectedFilter: 'all' | 'custom' | RuleCategory = 'all';

  const filterBar = el('div', { class: 'chip-group' });
  const listContainer = el('div', { class: 'catalog-list' });
  const countHeading = el('h3', { class: 'section-subtitle' }, ['']);

  // --- Add Custom Rule Form ---
  const titleInput = el('input', {
    id: 'custom-rule-title',
    type: 'text',
    placeholder: '例: 商店街でコロッケを買って食べる',
    required: true,
    autocomplete: 'off',
  });
  const hintInput = el('input', {
    id: 'custom-rule-hint',
    type: 'text',
    placeholder: '任意（ブラインドモード用の抽象ヒント）',
    autocomplete: 'off',
  });
  const descInput = el('textarea', {
    id: 'custom-rule-desc',
    rows: 2,
    placeholder: '任意（詳しい達成条件や違反条件のメモ）',
  });

  const categorySelect = el(
    'select',
    { id: 'custom-rule-category' },
    RULE_CATEGORIES.map((cat) =>
      el('option', { value: cat }, [RULE_CATEGORY_LABELS[cat]]),
    ),
  );

  const kindSelect = el('select', { id: 'custom-rule-kind' }, [
    el('option', { value: 'manual' }, ['手動タップ（達成 / 違反）']),
    el('option', { value: 'counter' }, ['回数カウント（目標到達 / 上限超過）']),
  ]);

  const modeSelect = el('select', { id: 'custom-rule-mode' }, [
    el('option', { value: 'both' }, ['ソロ・ペア共通']),
    el('option', { value: 'pair' }, ['ペア専用']),
  ]);

  const bonusInput = el('input', {
    id: 'custom-rule-bonus',
    type: 'number',
    min: '0',
    max: '200',
    step: '5',
    value: '25',
  });
  const penaltyInput = el('input', {
    id: 'custom-rule-penalty',
    type: 'number',
    min: '0',
    max: '200',
    step: '5',
    value: '0',
  });

  const unitInput = el('input', {
    id: 'custom-rule-unit',
    type: 'text',
    value: '回',
    placeholder: '回 / 箇所 / 軒',
  });
  const targetInput = el('input', {
    id: 'custom-rule-target',
    type: 'number',
    min: '1',
    max: '50',
    placeholder: '任意（到達で加点）',
  });
  const maxAllowedInput = el('input', {
    id: 'custom-rule-max',
    type: 'number',
    min: '0',
    max: '50',
    placeholder: '任意（超過で減点）',
  });

  const counterFields = el('div', { class: 'form-grid-3', hidden: true }, [
    el('div', { class: 'form-field' }, [
      el('label', { for: 'custom-rule-unit' }, ['単位']),
      unitInput,
    ]),
    el('div', { class: 'form-field' }, [
      el('label', { for: 'custom-rule-target' }, ['目標回数']),
      targetInput,
    ]),
    el('div', { class: 'form-field' }, [
      el('label', { for: 'custom-rule-max' }, ['上限回数']),
      maxAllowedInput,
    ]),
  ]);

  kindSelect.addEventListener('change', () => {
    counterFields.hidden = kindSelect.value !== 'counter';
  });

  const formError = el('p', { class: 'form-error', hidden: true });

  const addDetails = el('details', { class: 'add-rule-details' }, [
    el('summary', { class: 'add-rule-summary' }, ['＋ オリジナル縛りルールを追加']),
  ]);

  const addForm = el('form', { class: 'modal-form add-rule-form' }, [
    el('div', { class: 'form-field' }, [
      el('label', { for: 'custom-rule-title' }, ['ルール名（必須）']),
      titleInput,
    ]),
    el('div', { class: 'form-field' }, [
      el('label', { for: 'custom-rule-hint' }, ['ヒント名（任意）']),
      hintInput,
    ]),
    el('div', { class: 'form-field' }, [
      el('label', { for: 'custom-rule-desc' }, ['説明（任意）']),
      descInput,
    ]),
    el('div', { class: 'form-grid-2' }, [
      el('div', { class: 'form-field' }, [
        el('label', { for: 'custom-rule-category' }, ['カテゴリ']),
        categorySelect,
      ]),
      el('div', { class: 'form-field' }, [
        el('label', { for: 'custom-rule-mode' }, ['同行形態']),
        modeSelect,
      ]),
    ]),
    el('div', { class: 'form-field' }, [
      el('label', { for: 'custom-rule-kind' }, ['判定方式']),
      kindSelect,
    ]),
    el('div', { class: 'form-grid-2' }, [
      el('div', { class: 'form-field' }, [
        el('label', { for: 'custom-rule-bonus' }, ['基礎加点 (pt)']),
        bonusInput,
      ]),
      el('div', { class: 'form-field' }, [
        el('label', { for: 'custom-rule-penalty' }, ['基礎減点 (pt)']),
        penaltyInput,
      ]),
    ]),
    counterFields,
    formError,
    el('button', { type: 'submit', class: 'btn btn--primary btn--full' }, [
      'この縛りルールをカタログに追加',
    ]),
  ]);

  addForm.addEventListener('submit', (event) => {
    event.preventDefault();
    formError.hidden = true;

    const title = titleInput.value.trim();
    const baseBonus = Math.max(0, Math.round(Number(bonusInput.value) || 0));
    const basePenalty = Math.max(0, Math.round(Number(penaltyInput.value) || 0));

    if (!title) {
      formError.textContent = 'ルール名を入力してください。';
      formError.hidden = false;
      return;
    }
    if (baseBonus === 0 && basePenalty === 0) {
      formError.textContent = '基礎加点または基礎減点のどちらかに 1 以上を設定してください。';
      formError.hidden = false;
      return;
    }

    const scoringType: ScoringType =
      baseBonus > 0 && basePenalty > 0
        ? 'hybrid'
        : baseBonus > 0
          ? 'bonus'
          : 'penalty';

    const kind = kindSelect.value as 'manual' | 'counter';
    let evaluator: RuleEvaluatorConfig;
    if (kind === 'counter') {
      const unitLabel = unitInput.value.trim() || '回';
      const targetVal = targetInput.value.trim()
        ? Number(targetInput.value)
        : undefined;
      const maxVal = maxAllowedInput.value.trim()
        ? Number(maxAllowedInput.value)
        : undefined;
      if (targetVal === undefined && maxVal === undefined) {
        formError.textContent =
          'カウント方式では「目標回数」または「上限回数」のどちらかを入力してください。';
        formError.hidden = false;
        return;
      }
      evaluator = {
        kind: 'counter',
        unitLabel,
        actionLabel: `カウント (+1${unitLabel})`,
        targetCount: targetVal,
        maxAllowedCount: maxVal,
        maxBonusApplications: targetVal !== undefined ? 1 : undefined,
      };
    } else {
      evaluator = {
        kind: 'manual',
        bonusLabel: '達成した',
        penaltyLabel: '違反してしまった',
        maxBonusApplications: baseBonus > 0 ? 3 : undefined,
        maxPenaltyApplications: basePenalty > 0 ? 5 : undefined,
      };
    }

    const supportedModes: WalkMode[] =
      modeSelect.value === 'pair' ? ['pair'] : ['solo', 'pair'];

    const newRule: RuleDefinition = {
      id: `custom-${Date.now().toString(36)}`,
      title,
      hintTitle: hintInput.value.trim() || title,
      description: descInput.value.trim() || title,
      category: categorySelect.value as RuleCategory,
      familiarity: 'any',
      scoringType,
      baseBonus,
      basePenalty,
      minDifficulty: 'light',
      supportedModes,
      excludes: [],
      evaluator,
      tags: ['custom'],
      handoffHint: 'custom-rule',
    };

    handlers.onAddCustomRule(newRule);
    titleInput.value = '';
    hintInput.value = '';
    descInput.value = '';
    bonusInput.value = '25';
    penaltyInput.value = '0';
    targetInput.value = '';
    maxAllowedInput.value = '';
    addDetails.open = false;
    selectedFilter = 'all';
    renderCatalog();
    showToast(`オリジナル縛り「${newRule.title}」を追加しました`, 'success');
  });

  addDetails.append(addForm);

  function renderCatalog(): void {
    const customRules = handlers.getCustomRules();
    const defaultRules = handlers.getDefaultRules();
    const customIds = new Set(customRules.map((r) => r.id));
    const all = [...customRules, ...defaultRules];

    const filterOptions: Array<{
      key: 'all' | 'custom' | RuleCategory;
      label: string;
    }> = [
      { key: 'all', label: `すべて (${all.length})` },
      { key: 'custom', label: `カスタム (${customRules.length})` },
      ...RULE_CATEGORIES.map((cat) => ({
        key: cat,
        label: RULE_CATEGORY_LABELS[cat],
      })),
    ];

    filterBar.innerHTML = '';
    for (const opt of filterOptions) {
      const active = selectedFilter === opt.key;
      const chip = el(
        'button',
        {
          type: 'button',
          class: `chip${active ? ' chip--active' : ''}`,
          'aria-pressed': String(active),
        },
        [opt.label],
      );
      chip.addEventListener('click', () => {
        selectedFilter = opt.key;
        renderCatalog();
      });
      filterBar.append(chip);
    }

    const filtered = all.filter((rule) => {
      if (selectedFilter === 'all') return true;
      if (selectedFilter === 'custom') return customIds.has(rule.id);
      return rule.category === selectedFilter;
    });

    countHeading.textContent = `表示中: ${filtered.length}件（配点は現在の難易度「${DIFFICULTY_LABELS[handlers.currentDifficulty]}」基準）`;
    listContainer.innerHTML = '';

    if (filtered.length === 0) {
      listContainer.append(
        el('p', { class: 'muted-note' }, [
          selectedFilter === 'custom'
            ? 'まだオリジナル縛りは追加されていません。上の「＋ オリジナル縛りルールを追加」から登録できます。'
            : '該当するルールがありません。',
        ]),
      );
      return;
    }

    for (const def of filtered) {
      const isCustom = customIds.has(def.id);
      const resolved = resolveRule(def, handlers.currentDifficulty);

      const delBtn = isCustom
        ? (() => {
            const btn = el(
              'button',
              {
                type: 'button',
                class: 'btn btn--ghost-danger btn--sm',
                'aria-label': `${resolved.title}を削除`,
              },
              ['削除'],
            );
            btn.addEventListener('click', () => {
              handlers.onDeleteCustomRule(def.id);
              renderCatalog();
              showToast(`「${resolved.title}」を削除しました`, 'info');
            });
            return btn;
          })()
        : null;

      listContainer.append(
        el('article', { class: 'catalog-item' }, [
          el('div', { class: 'catalog-item__top' }, [
            el('div', { class: 'rule-card__badges' }, [
              el('span', { class: 'badge badge--category' }, [
                RULE_CATEGORY_LABELS[resolved.category],
              ]),
              isCustom
                ? el('span', { class: 'badge badge--secret' }, ['カスタム'])
                : null,
              el('span', { class: 'badge badge--neutral' }, [
                EVALUATOR_KIND_LABELS[resolved.evaluator.kind],
              ]),
              resolved.unitBonus > 0
                ? el('span', { class: 'badge badge--bonus' }, [
                    `+${resolved.unitBonus}pt`,
                  ])
                : null,
              resolved.unitPenalty < 0
                ? el('span', { class: 'badge badge--penalty' }, [
                    `${resolved.unitPenalty}pt`,
                  ])
                : null,
              def.supportedModes.length === 1 && def.supportedModes[0] === 'pair'
                ? el('span', { class: 'badge badge--hint' }, ['ペア専用'])
                : null,
            ]),
            delBtn,
          ]),
          el('strong', { class: 'catalog-item__title' }, [resolved.title]),
          el('p', { class: 'catalog-item__desc' }, [resolved.description]),
        ]),
      );
    }
  }

  const closeBtn = el(
    'button',
    { type: 'button', class: 'btn btn--icon', 'aria-label': 'モーダルを閉じる' },
    ['✕'],
  );
  closeBtn.addEventListener('click', () => dialog.close());

  dialog.append(
    el('div', { class: 'modal-dialog__inner' }, [
      el('div', { class: 'modal-dialog__header' }, [
        el('h2', { id: 'catalog-dialog-title' }, ['縛りルール一覧 & 追加']),
        closeBtn,
      ]),
      el('div', { class: 'modal-dialog__body' }, [
        addDetails,
        el('hr', { class: 'divider' }),
        filterBar,
        countHeading,
        listContainer,
      ]),
      el('div', { class: 'modal-dialog__footer' }, [
        (() => {
          const footerClose = el(
            'button',
            { type: 'button', class: 'btn btn--secondary' },
            ['閉じる'],
          );
          footerClose.addEventListener('click', () => dialog.close());
          return footerClose;
        })(),
      ]),
    ]),
  );

  dialog.addEventListener('close', () => dialog.remove());
  renderCatalog();
  document.body.append(dialog);
  dialog.showModal();
}
