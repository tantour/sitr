import { normalizeSettings, resolveYoloSize, type Settings } from '../config/settings';

const fields = ['enabled', 'images', 'videos', 'filter', 'bodySkin', 'hair', 'faceSkin', 'automaticGender', 'faceAssociation', 'faceAssociationMode', 'debugOverlay', 'unknown', 'performance', 'onnxThreads'] as const;
const thresholdFields = ['yoloConfidence', 'faceDetectionConfidence', 'minFaceSizePx', 'genderConfidence', 'smallFaceCutoffPx', 'smallFaceConfidence', 'faceCoverage', 'faceMargin', 'centerMaskConfidence'] as const;
const resolutionSteps = {
  yoloImageSize: ['auto', 256, 320, 416],
  yoloVideoSize: ['auto', 256, 320, 416],
  yunetSize: [256, 320, 416],
  faceCaptureSize: [320, 416, 512, 640],
} as const;
type PageStatus = { version: string; media: number; analyzed: number; detected: number; labelled: number; automatic: number; male: number; female: number; unlabelled: number };
async function renderPageStatus(): Promise<void> {
  const status = document.getElementById('pageStatus');
  if (!status) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) { status.textContent = 'No active website tab.'; return; }
  try {
    const page = await chrome.tabs.sendMessage(tab.id, { type: 'get-local-status' }, { frameId: 0 }) as PageStatus;
    if (page.version !== chrome.runtime.getManifest().version) {
      status.textContent = 'This tab is running an older build. Refresh the tab.';
      return;
    }
    status.textContent = `Visible media: ${page.media}; analyzed: ${page.analyzed}; detected people: ${page.detected}; male labels: ${page.male}; female labels: ${page.female}; unclassified: ${page.unlabelled}. ${page.automatic} labels are automatic.`;
  } catch {
    status.textContent = 'No content-script status. Refresh this tab after reloading the extension, or try a regular website.';
  }
}
async function render(): Promise<void> {
  const version = document.getElementById('version');
  if (version) version.textContent = `Version ${chrome.runtime.getManifest().version}`;
  const settings = normalizeSettings(await chrome.runtime.sendMessage({ type: 'get-settings' }));
  for (const field of fields) {
    const element = document.getElementById(field) as HTMLInputElement | HTMLSelectElement;
    if (!element) continue;
    if (element instanceof HTMLInputElement && element.type === 'checkbox') element.checked = Boolean(settings[field]);
    else element.value = String(settings[field]);
    element.onchange = async () => {
      const raw = element instanceof HTMLInputElement && element.type === 'checkbox' ? element.checked : element.value;
      const value = field === 'onnxThreads' && raw !== 'auto' ? Number(raw) : raw;
      await chrome.runtime.sendMessage({ type: 'set-settings', patch: { [field]: value } as Partial<Settings> });
      if (field === 'performance') await render();
    };
  }
  for (const field of Object.keys(resolutionSteps) as Array<keyof typeof resolutionSteps>) {
    const input = document.getElementById(field) as HTMLInputElement | null;
    const output = document.getElementById(`${field}Value`);
    if (!input || !output) continue;
    const steps = resolutionSteps[field] as readonly (number | 'auto')[];
    input.value = String(steps.indexOf(settings[field]));
    const updateOutput = () => {
      const selected = steps[Number(input.value)];
      const effective = selected === 'auto' ? resolveYoloSize(settings, field === 'yoloVideoSize' ? 'video' : 'image') : selected;
      output.textContent = `${selected === 'auto' ? 'Auto · ' : ''}${effective} × ${effective}`;
    };
    updateOutput();
    input.oninput = updateOutput;
    input.onchange = async () => {
      const selected = steps[Number(input.value)];
      await chrome.runtime.sendMessage({ type: 'set-settings', patch: { [field]: selected } as Partial<Settings> });
    };
  }
  for (const field of thresholdFields) {
    const input = document.getElementById(field) as HTMLInputElement | null;
    const output = document.getElementById(`${field}Value`);
    if (!input || !output) continue;
    input.value = String(settings[field]);
    const updateOutput = () => { output.textContent = field.endsWith('Px') ? `${input.value} px` : `${Math.round(Number(input.value) * 100)}%`; };
    updateOutput();
    input.oninput = updateOutput;
    input.onchange = async () => {
      await chrome.runtime.sendMessage({ type: 'set-settings', patch: { [field]: Number(input.value) } as Partial<Settings> });
    };
  }
  const exceptions = document.getElementById('siteExceptions') as HTMLInputElement | null;
  if (exceptions) {
    exceptions.value = settings.siteExceptions.join(', ');
    exceptions.onchange = async () => {
      const siteExceptions = exceptions.value.split(/[\s,]+/).filter(Boolean);
      await chrome.runtime.sendMessage({ type: 'set-settings', patch: { siteExceptions } as Partial<Settings> });
    };
  }
  await renderPageStatus();
}
void render();
document.getElementById('labelPerson')?.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined) {
    try { await chrome.tabs.sendMessage(tab.id, { type: 'start-label' }); }
    catch { /* Restricted pages cannot host content scripts. */ }
  }
  window.close();
});
document.getElementById('retryEngine')?.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'ensure-offscreen' });
  await chrome.runtime.sendMessage({ type: 'retry-engine' });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined) {
    try { await chrome.tabs.sendMessage(tab.id, { type: 'retry-media' }); }
    catch { /* Restricted pages cannot host content scripts. */ }
  }
  window.close();
});
