export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | boolean | number | undefined>,
  children?: Array<Node | string | null | undefined>,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === false) continue;
      if (value === true) {
        node.setAttribute(key, '');
      } else {
        node.setAttribute(key, String(value));
      }
    }
  }
  if (children) {
    for (const child of children) {
      if (child === null || child === undefined) continue;
      node.append(
        typeof child === 'string' ? document.createTextNode(child) : child,
      );
    }
  }
  return node;
}

export function attachDialogLightDismiss(dialog: HTMLDialogElement): void {
  dialog.setAttribute('closedby', 'any');

  // Fallback for browsers without closedby attribute support (e.g. Safari)
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const insideContent =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (insideContent) return;
      dialog.close();
    });
  }
}

export function requestOneShotPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject(new Error('このブラウザでは位置情報（Geolocation API）が利用できません。'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: Number(position.coords.latitude.toFixed(6)),
          lng: Number(position.coords.longitude.toFixed(6)),
        });
      },
      (err) => {
        const message =
          err.code === err.PERMISSION_DENIED
            ? '位置情報の利用が許可されていません。ブラウザの設定を確認してください。'
            : err.code === err.TIMEOUT
              ? '現在地の取得がタイムアウトしました。屋外や電波の良い場所で再試行してください。'
              : '現在地を取得できませんでした。';
        reject(new Error(message));
      },
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 15_000,
      },
    );
  });
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

export function downloadTextFile(
  filename: string,
  content: string,
  mimeType = 'application/json;charset=utf-8',
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

let toastTimer: number | undefined;

export function showToast(message: string, variant: 'info' | 'success' | 'error' = 'info'): void {
  let toast = document.querySelector<HTMLDivElement>('#sq-toast');
  if (!toast) {
    toast = el('div', {
      id: 'sq-toast',
      class: 'toast',
      role: 'status',
      'aria-live': 'polite',
    });
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.className = `toast toast--${variant} toast--visible`;

  if (toastTimer !== undefined) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toast?.classList.remove('toast--visible');
  }, 2800);
}
