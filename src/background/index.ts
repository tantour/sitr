import { DEFAULT_SETTINGS, normalizeSettings, resolveOnnxThreads, type Settings } from '../config/settings';

let creating: Promise<void> | undefined;
async function ensureOffscreen(): Promise<void> {
  if (!creating) creating = (async () => {
    const existing = await chrome.offscreen.hasDocument();
    if (!existing) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: [chrome.offscreen.Reason.WORKERS], justification: 'Run local image and video analysis in a dedicated worker' });
  })().finally(() => { creating = undefined; });
  await creating;
}
async function current(): Promise<Settings> {
  const value = (await chrome.storage.local.get('settings')).settings;
  return normalizeSettings(value);
}
chrome.runtime.onInstalled.addListener(() => {
  void current().then(s => chrome.storage.local.set({ settings: s }));
});
chrome.runtime.onMessage.addListener((message: { type?: string; patch?: Partial<Settings> }, _sender, reply) => {
  if (message?.type === 'get-settings') { void current().then(reply); return true; }
  if (message?.type === 'set-settings') {
    void current().then(async old => {
      const next = normalizeSettings({ ...old, ...message.patch, revision: old.revision + 1 });
      if (next.onnxThreads !== old.onnxThreads) {
        await ensureOffscreen();
        await chrome.runtime.sendMessage({ type: 'retry-engine', threads: resolveOnnxThreads(next.onnxThreads, navigator.hardwareConcurrency) });
      }
      await chrome.storage.local.set({ settings: next });
      reply(next);
    });
    return true;
  }
  if (message?.type === 'ensure-offscreen') {
    void ensureOffscreen().then(() => reply({ ok: true })).catch(error => reply({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === 'fetch-image') {
    const url = (message as { url?: string }).url;
    if (!url || !/^https?:\/\//i.test(url)) { reply({ ok: false, error: 'Unsupported URL' }); return false; }
    void fetch(url, { credentials: 'include', cache: 'default' }).then(async response => {
      if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
      const blob = await response.blob();
      if (!blob.type.startsWith('image/') || blob.size > 20_000_000) throw new Error('Unsupported image response');
      reply({ ok: true, blob });
    }).catch(error => reply({ ok: false, error: String(error) }));
    return true;
  }
  return false;
});
void chrome.storage.local.get('settings').then(value => {
  if (!value.settings) return chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
});
