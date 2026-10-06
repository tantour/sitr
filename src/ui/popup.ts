// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { normalizeSettings, normalizeSiteException, resolveYoloSize, siteIsExcepted, type Settings } from '../config/settings';
import { mediaSummary, number, percent, t } from './localization';
import { initializeUiPreferences } from './preferences';

const fields = ['enabled', 'images', 'videos', 'videoPlayback', 'videoDetector', 'filter', 'bodySkin', 'hair', 'imageCoverage', 'imageDetectionGate', 'imageWholeBodyEffect', 'imageRegionFaceEffect', 'imageWholeBodyFaceEffect', 'videoEffect', 'imageEffectGrayscale', 'imageFaceEffectGrayscale', 'videoEffectGrayscale', 'automaticGender', 'imageGenderModel', 'videoGenderModel', 'faceAssociation', 'faceAssociationMode', 'debugOverlay', 'imageUnknown', 'videoUnknown', 'performance', 'onnxThreads'] as const;
const skinToggleFields = ['imageSkinThresholdEnabled', 'imageSkinThresholdIncludeFace', 'imageGroupSkinThresholdEnabled'] as const;
const skinNumberFields = ['imageSkinThresholdPercent', 'imageGroupSkinThresholdPercent', 'imageGroupSkinPeopleLimit'] as const;
const thresholdFields = ['yoloConfidence', 'faceDetectionConfidence', 'minFaceSizePx', 'genderConfidence', 'smallFaceCutoffPx', 'smallFaceConfidence', 'faceCoverage', 'faceMargin', 'centerMaskConfidence'] as const;
const expansionFields = ['imageExpansion', 'videoExpansion'] as const;
const effectIntensityFields = ['imageEffectIntensity', 'videoEffectIntensity', 'imageFaceEffectIntensity'] as const;
const resolutionSteps = {
  yoloImageSize: ['auto', 256, 320, 416],
  yoloVideoSize: ['auto', 256, 320, 416],
  yunetSize: [256, 320, 416],
  faceCaptureSize: [320, 416, 512, 640],
} as const;
type PageStatus = { version: string; media: number; analyzed: number; detected: number };
const settingsView = location.hash.startsWith('#settings');
let settings: Settings;
let currentHost: string | undefined;
let activeTabId: number | undefined;
let pageSummary = 'Checking this page…';
let pageData: PageStatus | undefined;
let siteHostLabel = 'Checking website…';
let currentSaveMessage = 'Loading settings…';
let currentSaveState = 'saved';
const outputUpdaters = new Map<string, () => void>();
let pendingSaves = 0;
let saveFailed = false;
let websiteDraft: string | undefined;
const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const select = (id: string) => document.getElementById(id) as HTMLSelectElement;
const element = (id: string) => document.getElementById(id)!;

function saveStatus(message: string, state = 'saved'): void {
  currentSaveMessage = message;
  currentSaveState = state;
  element('saveStatus').textContent = t(message);
  element('saveStatus').dataset.state = state;
}

function showSettingsSection(): void {
  const requested = location.hash.split('/')[1] || 'coverage';
  const section = ['coverage', 'detection', 'performance', 'diagnostics', 'websites'].includes(requested) ? requested : 'coverage';
  document.querySelectorAll<HTMLElement>('[data-settings-panel]').forEach(panel => {
    panel.hidden = panel.dataset.settingsPanel !== section;
  });
  document.querySelectorAll<HTMLButtonElement>('[data-section]').forEach(button => {
    if (button.dataset.section === section) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  element('mainContent').scrollTop = 0;
}

function initializeNavigation(): void {
  if (settingsView) {
    document.body.dataset.view = 'settings';
    (element('skinThresholdSettings') as HTMLDetailsElement).open = true;
    for (const id of ['imagePanel', 'videoPanel']) {
      const panel = element(id);
      panel.hidden = false;
      panel.removeAttribute('role');
      panel.removeAttribute('aria-labelledby');
      panel.removeAttribute('tabindex');
    }
    document.querySelectorAll<HTMLButtonElement>('[data-section]').forEach(button => {
      button.onclick = () => { location.hash = `settings/${button.dataset.section}`; };
    });
    window.addEventListener('hashchange', showSettingsSection);
    showSettingsSection();
    return;
  }
  const tabs = [element('imagesTab'), element('videosTab')];
  const activate = (index: number, focus = false) => {
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      element(i === 0 ? 'imagePanel' : 'videoPanel').hidden = i !== index;
    });
    if (focus) tabs[index].focus();
  };
  tabs.forEach((tab, index) => {
    tab.onclick = () => activate(index);
    tab.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      activate(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index, true);
    };
  });
}

function updateMaskControls(): void {
  const coverage = select('imageCoverage').value;
  const whole = coverage !== 'regions';
  element('imageRegionControls').hidden = whole;
  element('imageWholeBodyControls').hidden = !whole;
  element('imageWholeBodyFaceControl').hidden = coverage !== 'whole-body';
  element('imageFaceOpeningHelp').hidden = coverage !== 'whole-body';
  const faceEffect = select(whole ? 'imageWholeBodyFaceEffect' : 'imageRegionFaceEffect').value;
  element('imageFaceEffectOptions').hidden = coverage === 'whole-body-face' || faceEffect === 'show' || faceEffect === 'black';
  element('imageEffectOptions').hidden = select('imageWholeBodyEffect').value === 'black';
  element('videoEffectOptions').hidden = select('videoEffect').value === 'black';
  const fastVideo = select('videoDetector').value === 'fast-box';
  element('yoloVideoSizeControl').hidden = fastVideo;
  element('faceAssociationModeControl').hidden = fastVideo;
  element('videoCoverageHelp').textContent = t(fastVideo
    ? 'Video covers selected people with expanded boxes, including faces. Fast motion can still outrun a box.'
    : "Video covers selected people's full silhouettes, including faces. Fast motion can still outrun a mask.");
  element('imagesDisabled').hidden = input('images').checked;
  element('videosDisabled').hidden = input('videos').checked;
  element('imageSkinThresholdControls').hidden = !input('imageSkinThresholdEnabled').checked;
  element('imageGroupSkinThresholdControls').hidden = !input('imageGroupSkinThresholdEnabled').checked;
}

function updateProtectionState(): void {
  const enabled = input('enabled').checked;
  const skipped = !settingsView && !!currentHost && siteIsExcepted(currentHost, settings.siteExceptions);
  const noPeople = select('filter').value === 'off';
  const noMedia = !input('images').checked && !input('videos').checked;
  const paused = !enabled || skipped || noPeople || noMedia;
  document.body.dataset.protection = paused ? 'paused' : 'on';
  element('protectionTitle').textContent = t(!enabled ? 'Protection is paused' : skipped ? 'Paused on this site'
    : noPeople ? 'No people selected' : noMedia ? 'No media selected' : 'Protection is on');
  element('protectionState').textContent = t(!enabled ? 'Turn on to resume across websites.' : skipped ? 'Enabled on other websites.'
    : noPeople ? 'Choose who to cover below.' : noMedia ? 'Turn on Images or Videos below.' : 'Your choices apply across websites.');
  if (settingsView) return;
  const button = element('toggleSite') as HTMLButtonElement;
  const inherited = skipped && !settings.siteExceptions.includes(currentHost!);
  const full = !skipped && settings.siteExceptions.length >= 100;
  button.disabled = !currentHost || inherited || full || pendingSaves > 0;
  button.textContent = t(skipped ? 'Resume on this site' : 'Pause on this site');
  element('manageSites').hidden = !inherited && !full;
  element('manageSites').textContent = t(full ? 'Site limit reached. Manage websites' : 'Manage site exceptions');
  element('pageStatus').textContent = inherited ? t('Paused by a parent-domain exception. Manage websites to change it.')
    : skipped ? t('Protection is paused on this site.') : !enabled ? t('Protection is paused across websites.')
    : pageData ? mediaSummary(pageData.media, pageData.analyzed, pageData.detected) : t(pageSummary);
}

async function renderPageStatus(): Promise<void> {
  if (settingsView) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id;
    if (tab?.url && /^https?:\/\//i.test(tab.url)) currentHost = normalizeSiteException(tab.url);
    siteHostLabel = currentHost || 'Browser page';
    element('siteHost').textContent = t(siteHostLabel);
    element('siteHost').title = currentHost || '';
    if (activeTabId === undefined || !currentHost) {
      pageSummary = 'Open a website to use Sitr here.';
    } else {
      try {
        const page = await chrome.tabs.sendMessage(activeTabId, { type: 'get-local-status' }, { frameId: 0 }) as PageStatus;
        pageData = page.version === chrome.runtime.getManifest().version && page.media > 0 ? page : undefined;
        pageSummary = page.version !== chrome.runtime.getManifest().version ? 'Refresh this tab to use the latest Sitr version.'
          : 'No visible media on this page yet.';
      } catch { pageSummary = 'Refresh this tab to connect Sitr.'; }
    }
  } catch {
    siteHostLabel = 'Website unavailable';
    element('siteHost').textContent = t(siteHostLabel);
    pageSummary = 'Reopen Sitr on a regular website.';
  }
  updateProtectionState();
}

async function persist(patch: Partial<Settings>, control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement): Promise<boolean> {
  pendingSaves++;
  control.disabled = true;
  saveStatus('Saving…', 'saving');
  updateProtectionState();
  try {
    const response = await chrome.runtime.sendMessage({ type: 'set-settings', patch }) as Settings & { error?: string };
    if (!response || response.error || !Number.isFinite(response.revision)) throw new Error(response?.error || 'No settings response');
    settings = normalizeSettings(response);
    return true;
  } catch {
    saveFailed = true;
    saveStatus('Could not save. Try the change again.', 'error');
    return false;
  } finally {
    pendingSaves--;
    control.disabled = false;
    updateProtectionState();
    if (pendingSaves === 0 && saveFailed) {
      // Restore all persisted values after concurrent writes settle.
      await render().catch(() => {});
      saveStatus('Could not save. Try the change again.', 'error');
    } else if (pendingSaves === 0) saveStatus(websiteDraft === undefined ? 'Saved automatically' : 'Unsaved websites. Save to apply.');
    if (pendingSaves === 0) saveFailed = false;
  }
}

async function render(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: 'get-settings' }) as Settings & { error?: string };
  if (!response || response.error || !Number.isFinite(response.revision)) throw new Error('Settings unavailable');
  settings = normalizeSettings(response);
  element('version').textContent = t('Version {version}', { version: chrome.runtime.getManifest().version });
  for (const field of [...fields, ...skinToggleFields]) {
    const control = element(field) as HTMLInputElement | HTMLSelectElement;
    if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = Boolean(settings[field]);
    else control.value = String(settings[field]);
    control.onchange = async () => {
      const raw = control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked : control.value;
      const value = field === 'onnxThreads' && raw !== 'auto' ? Number(raw) : raw;
      updateMaskControls();
      updateProtectionState();
      const saved = await persist({ [field]: value } as Partial<Settings>, control);
      if (saved && field === 'performance') await render();
    };
  }
  for (const field of skinNumberFields) {
    const control = input(field);
    control.value = String(settings[field]);
    control.oninput = () => { control.removeAttribute('aria-invalid'); };
    control.onchange = async () => {
      if (!control.checkValidity()) {
        control.setAttribute('aria-invalid', 'true'); control.reportValidity();
        saveStatus('Enter a value within the shown limits.', 'error'); return;
      }
      if (await persist({ [field]: Number(control.value) }, control)) control.value = String(settings[field]);
    };
  }
  for (const field of Object.keys(resolutionSteps) as Array<keyof typeof resolutionSteps>) {
    const control = input(field);
    const steps = resolutionSteps[field] as readonly (number | 'auto')[];
    control.value = String(steps.indexOf(settings[field]));
    const updateOutput = () => {
      const selected = steps[Number(control.value)];
      const effective = selected === 'auto' ? resolveYoloSize(settings, field === 'yoloVideoSize' ? 'video' : 'image') : selected;
      const size = `${number(effective)} × ${number(effective)}`;
      element(`${field}Value`).textContent = selected === 'auto' ? t('Auto · {size}', { size }) : size;
    };
    updateOutput();
    outputUpdaters.set(field, updateOutput);
    control.oninput = updateOutput;
    control.onchange = async () => { await persist({ [field]: steps[Number(control.value)] } as Partial<Settings>, control); };
  }
  for (const field of [...expansionFields, ...effectIntensityFields, ...thresholdFields]) {
    const control = input(field);
    control.value = String(settings[field]);
    const pixels = [...expansionFields, ...effectIntensityFields, 'minFaceSizePx', 'smallFaceCutoffPx'].includes(field);
    const updateOutput = () => { element(`${field}Value`).textContent = pixels ? t('{value} px', { value: number(Number(control.value)) }) : percent(Number(control.value)); };
    updateOutput();
    outputUpdaters.set(field, updateOutput);
    control.oninput = updateOutput;
    control.onchange = async () => { await persist({ [field]: Number(control.value) } as Partial<Settings>, control); };
  }
  const exceptions = element('siteExceptions') as HTMLTextAreaElement;
  const savedExceptions = settings.siteExceptions.join(',\n');
  exceptions.value = websiteDraft ?? savedExceptions;
  const saveExceptions = async () => {
    if (exceptions.disabled) return;
    if (exceptions.value === settings.siteExceptions.join(',\n')) { saveStatus('Websites saved'); return; }
    const entries = exceptions.value.split(/[\s,]+/).filter(Boolean);
    if (entries.some(entry => !normalizeSiteException(entry))) {
      saveStatus('Use valid website domains or URLs.', 'error');
      exceptions.setAttribute('aria-invalid', 'true');
      exceptions.focus();
      return;
    }
    if (new Set(entries.map(normalizeSiteException)).size > 100) {
      saveStatus('Keep the list to 100 websites or fewer.', 'error');
      return;
    }
    exceptions.removeAttribute('aria-invalid');
    const button = element('saveSites') as HTMLButtonElement;
    button.disabled = true;
    try {
      if (await persist({ siteExceptions: entries }, exceptions)) {
        websiteDraft = undefined;
        exceptions.value = settings.siteExceptions.join(',\n');
        saveStatus('Websites saved');
      }
    } finally {
      button.disabled = false;
    }
  };
  exceptions.oninput = () => {
    websiteDraft = exceptions.value === settings.siteExceptions.join(',\n') ? undefined : exceptions.value;
    exceptions.removeAttribute('aria-invalid');
    saveStatus(websiteDraft === undefined ? 'Saved automatically' : 'Unsaved websites. Save to apply.', websiteDraft === undefined ? 'saved' : 'draft');
  };
  element('saveSites').onclick = saveExceptions;
  updateMaskControls();
  updateProtectionState();
}

async function openSettings(section = 'coverage'): Promise<void> {
  try { await chrome.tabs.create({ url: chrome.runtime.getURL(`popup.html#settings/${section}`), openerTabId: activeTabId }); }
  catch { saveStatus('Could not open settings. Reopen Sitr and try again.', 'error'); }
}
element('openSettings').onclick = () => { void openSettings(); };
element('manageSites').onclick = () => { void openSettings('websites'); };
element('toggleSite').onclick = async () => {
  if (!currentHost) return;
  const skipped = siteIsExcepted(currentHost, settings.siteExceptions);
  const siteExceptions = skipped ? settings.siteExceptions.filter(site => site !== currentHost) : [...settings.siteExceptions, currentHost];
  await persist({ siteExceptions }, element('toggleSite') as HTMLButtonElement);
};

async function websiteTab(): Promise<chrome.tabs.Tab> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.url && /^https?:\/\//i.test(active.url)) return active;
  const current = await chrome.tabs.getCurrent();
  if (current?.openerTabId !== undefined) {
    const opener = await chrome.tabs.get(current.openerTabId);
    if (opener.url && /^https?:\/\//i.test(opener.url)) return opener;
  }
  throw new Error('No originating website');
}

async function pageAction(type: 'start-label' | 'retry-media'): Promise<void> {
  try {
    const tab = await websiteTab();
    if (tab?.id === undefined) throw new Error('No website');
    await chrome.tabs.sendMessage(tab.id, { type });
    if (settingsView) await chrome.tabs.update(tab.id, { active: true });
    else window.close();
  } catch { saveStatus('Open a regular website and try again.', 'error'); }
}
element('labelPerson').onclick = () => { void pageAction('start-label'); };
element('retryEngine').onclick = async () => {
  const button = element('retryEngine') as HTMLButtonElement;
  button.disabled = true;
  saveStatus('Restarting engine…', 'saving');
  try {
    const ensured = await chrome.runtime.sendMessage({ type: 'ensure-offscreen' });
    if (ensured?.ok === false) throw new Error(ensured.error);
    const retried = await chrome.runtime.sendMessage({ type: 'retry-engine' });
    if (retried?.ok === false) throw new Error(retried.error);
    try {
      const tab = await websiteTab();
      if (tab.id !== undefined) await chrome.tabs.sendMessage(tab.id, { type: 'retry-media' });
    } catch { /* The engine can restart even when the originating website has closed. */ }
    saveStatus('Engine restarted');
  } catch { saveStatus('Could not restart the engine. Try again.', 'error'); }
  finally { button.disabled = false; }
};

initializeNavigation();
initializeUiPreferences(() => {
  document.title = t(settingsView ? 'Sitr settings' : 'Sitr');
  element('appTitle').textContent = t(settingsView ? 'Sitr settings' : 'Sitr');
  element('appSubtitle').textContent = t(settingsView ? 'Changes apply across websites' : 'Private media protection');
  element('version').textContent = t('Version {version}', { version: chrome.runtime.getManifest().version });
  element('siteHost').textContent = t(siteHostLabel);
  saveStatus(currentSaveMessage, currentSaveState);
  outputUpdaters.forEach(update => update());
  if (settings) { updateMaskControls(); updateProtectionState(); }
}, message => saveStatus(message, 'error'), () => {
  if (currentSaveMessage === 'Could not save display settings. Try again.' || currentSaveMessage === 'Could not load display settings. Try again.') {
    saveStatus(websiteDraft === undefined ? 'Saved automatically' : 'Unsaved websites. Save to apply.');
  }
});
const preferenceControls = document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select:not(#uiTheme):not(#uiLanguage),textarea');
preferenceControls.forEach(control => { control.disabled = true; });
async function initialize(): Promise<void> {
  try {
    await render();
    preferenceControls.forEach(control => { control.disabled = false; });
    document.body.classList.remove('loading');
    element('retrySettings').hidden = true;
    saveStatus('Saved automatically');
    await renderPageStatus();
  } catch {
    saveStatus('Could not load settings.', 'error');
    element('retrySettings').hidden = false;
  }
}
element('retrySettings').onclick = () => { void initialize(); };
void initialize();
