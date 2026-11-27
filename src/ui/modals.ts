import type { FamiliarSpot, GeneratedSession } from '../domain/types.ts';
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
