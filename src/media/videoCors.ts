// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
function sourceKey(video: HTMLVideoElement): string {
  return JSON.stringify([video.getAttribute('src'), Array.from(video.querySelectorAll('source')).map(source => [source.src, source.type])]);
}

export function videoNeedsCors(video: HTMLVideoElement): boolean {
  const url = video.currentSrc || video.src || video.querySelector('source')?.src;
  return Boolean(url && /^https?:\/\//i.test(url) && video.crossOrigin === null && new URL(url).origin !== location.origin);
}

function loaded(video: HTMLVideoElement, event: 'loadedmetadata' | 'loadeddata', signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const clean = () => {
      video.removeEventListener(event, ready);
      video.removeEventListener('error', error);
      signal.removeEventListener('abort', error);
      clearTimeout(timer);
    };
    const ready = () => { clean(); resolve(); };
    const error = () => { clean(); reject(new Error('Video CORS reload unavailable')); };
    const timer = setTimeout(error, 8000);
    video.addEventListener(event, ready, { once: true });
    video.addEventListener('error', error, { once: true });
    signal.addEventListener('abort', error, { once: true });
    if (signal.aborted) error();
  });
}

/** Retry only a verified CORS-enabled HTTP source; blob/MSE players are untouched. */
export async function recoverVideoCors(video: HTMLVideoElement, signal: AbortSignal,
  allowed: () => boolean): Promise<boolean> {
  const url = video.currentSrc || video.src || video.querySelector('source')?.src;
  if (!url || !/^https?:\/\//i.test(url) || video.crossOrigin !== null ||
      new URL(url).origin === location.origin) return false;
  const key = sourceKey(video);
  try {
    // Confirm the CDN accepts the page's origin before changing its player.
    // Cancel the body immediately, even if the server ignores the Range header.
    const response = await fetch(url, { mode: 'cors', credentials: 'omit', headers: { Range: 'bytes=0-0' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
    void response.body?.cancel().catch(() => {});
    if (!response.ok || !allowed() || signal.aborted || sourceKey(video) !== key) return false;
  } catch { return false; }

  const time = video.currentTime, paused = video.paused, rate = video.playbackRate;
  const resume = () => {
    if (signal.aborted || !video.isConnected || sourceKey(video) !== key) return;
    video.playbackRate = rate;
    if (paused) video.pause();
    else void video.play().catch(() => {});
  };
  try {
    video.crossOrigin = 'anonymous';
    const metadata = loaded(video, 'loadedmetadata', signal);
    video.load();
    await metadata;
    if (signal.aborted || !allowed() || sourceKey(video) !== key) throw new Error('Video source changed');
    // loadeddata must be registered before seeking, including a paused poster frame.
    const data = video.readyState >= 2 ? Promise.resolve() : loaded(video, 'loadeddata', signal);
    if (time > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(time, Math.max(0, video.duration - 0.01));
    await data;
    resume();
    return true;
  } catch {
    if (video.crossOrigin === 'anonymous') {
      video.removeAttribute('crossorigin');
      if (sourceKey(video) === key && !signal.aborted && video.isConnected) {
        const restore = () => {
          if (sourceKey(video) !== key) return;
          if (time > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(time, Math.max(0, video.duration - 0.01));
          resume();
        };
        const metadata = loaded(video, 'loadedmetadata', signal);
        video.load();
        void metadata.then(restore).catch(() => {});
      }
    }
    return false;
  }
}
