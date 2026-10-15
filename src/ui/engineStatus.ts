// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import type { EngineStatus } from '../state/contracts';
import { number, t } from './localization';

export function initializeEngineStatus(retry: () => void): { refresh: () => Promise<void>; render: () => void } {
  const panel = document.getElementById('engineStatus')!;
  const title = document.getElementById('engineStatusTitle')!;
  const detail = document.getElementById('engineStatusDetail')!;
  const bar = document.getElementById('engineProgress') as HTMLProgressElement;
  const button = document.getElementById('retryPreparation') as HTMLButtonElement;
  let status: EngineStatus | undefined;
  let timer: number | undefined;
  let polling = false;
  let closed = false;
  const render = () => {
    const failed = status?.error === 'Engine unavailable after two restarts';
    const degraded = status?.ready && Object.keys(status.warmup?.failures ?? {}).length > 0;
    const unavailable = status?.ok === false;
    const state = failed ? 'error' : unavailable ? 'unavailable' : degraded ? 'limited' : status?.ready ? 'ready' : 'preparing';
    panel.dataset.state = state;
    const message = failed ? 'Preparation failed' : unavailable ? 'Cannot check readiness' : degraded ? 'Ready with limited features'
      : status?.ready ? 'Ready for images and videos' : 'Preparing protection…';
    // Avoid re-announcing the live status on every timer tick.
    if (title.textContent !== t(message)) title.textContent = t(message);
    const progress = status?.progress;
    detail.hidden = state === 'ready';
    detail.textContent = failed || degraded ? t('Some features are unavailable. Retry preparation.')
      : unavailable ? t('Reopen Sitr or retry preparation.')
      : progress ? t('{completed} of {total} steps · {seconds} s', {
        completed: number(progress.completed), total: number(progress.total), seconds: number(Math.floor(progress.elapsedMs / 1000)),
      }) : t('Starting up…');
    bar.hidden = state !== 'preparing';
    bar.setAttribute('aria-label', t('Preparation progress'));
    if (progress && progress.total > 0) { bar.max = progress.total; bar.value = progress.completed; }
    else bar.removeAttribute('value');
    button.hidden = !['error', 'limited', 'unavailable'].includes(state);
    button.textContent = t('Retry');
  };
  const refresh = async () => {
    if (polling || closed) return;
    if (timer !== undefined) clearTimeout(timer);
    polling = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'engine-status' }) as EngineStatus | undefined;
      status = response?.ok && typeof response.ready === 'boolean' ? response : { ok: false, ready: false };
    } catch { status = { ok: false, ready: false }; }
    finally {
      polling = false;
      if (!closed) { render(); timer = window.setTimeout(() => { void refresh(); }, status?.ready ? 2500 : 500); }
    }
  };
  button.onclick = () => { retry(); };
  window.addEventListener('pagehide', () => { closed = true; if (timer !== undefined) clearTimeout(timer); }, { once: true });
  render();
  return { refresh, render };
}
