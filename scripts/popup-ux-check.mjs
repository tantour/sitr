// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
// Run after npm run build. Exercises the shipped UI with deterministic browser API responses.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const config = ts.transpileModule(await readFile('src/config/settings.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { DEFAULT_SETTINGS } = await import(`data:text/javascript;base64,${Buffer.from(config).toString('base64')}`);
const review = resolve('.impeccable/review');
await mkdir(review, { recursive: true });
const server = createServer(async (request, response) => {
  const name = request.url.split('?')[0].slice(1) || 'popup.html';
  if (name === 'website') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Popup integration fixture</title><p>No media fixture</p>'); return; }
  if (!['popup.html', 'popup.css', 'popup.js', 'sitr_logo.jpg', 'icons/sitr-logo.png'].includes(name)) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : name.endsWith('.png') ? 'image/png' : 'image/jpeg');
  response.end(await readFile(resolve(root, 'dist', name)));
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const errors = [];
async function open({ patch = {}, hash = '', viewport = { width: 400, height: 590 }, host = 'https://example.com/gallery', status = 'ready', failLoad = false, preferences = { theme: 'system', language: 'en' }, colorScheme = 'light', locale = 'en-US' } = {}) {
  const page = await browser.newPage({ viewport, colorScheme, locale });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ settings, origin, host, status, failLoad, preferences }) => {
    const listeners = [];
    window.mock = { settings, preferences: JSON.parse(localStorage.getItem('mockUiPreferences') || 'null') || preferences, failPreferenceSave: false, failNext: false, failLoad, created: [], messages: [], activated: [] };
    window.chrome = {
      storage: {
        local: {
          get: async () => ({ uiPreferences: window.mock.preferences }),
          set: async values => {
            if (window.mock.failPreferenceSave) { window.mock.failPreferenceSave = false; throw new Error('Preference write failed'); }
            const oldValue = window.mock.preferences;
            window.mock.preferences = values.uiPreferences;
            localStorage.setItem('mockUiPreferences', JSON.stringify(values.uiPreferences));
            listeners.forEach(listener => listener({ uiPreferences: { oldValue, newValue: values.uiPreferences } }, 'local'));
          },
        },
        onChanged: { addListener: listener => listeners.push(listener) },
      },
      runtime: {
        getManifest: () => ({ version: '0.4.2' }),
        getURL: path => `${origin}/${path}`,
        sendMessage: async message => {
          window.mock.messages.push(message);
          if (message.type === 'get-settings') {
            if (window.mock.failLoad) throw new Error('Load failed');
            return window.mock.settings;
          }
          if (message.type === 'set-settings') {
            if (window.mock.failNext) { window.mock.failNext = false; return { error: 'Save failed' }; }
            const patch = { ...message.patch };
            if (patch.siteExceptions) patch.siteExceptions = [...new Set(patch.siteExceptions.map(site => new URL(/^https?:/.test(site) ? site : `https://${site}`).hostname.replace(/^www\./, '')))];
            window.mock.settings = { ...window.mock.settings, ...patch, revision: window.mock.settings.revision + 1 };
            return window.mock.settings;
          }
          return { ok: true };
        },
      },
      tabs: {
        query: async () => [{ id: 7, url: location.hash.startsWith('#settings') ? `${origin}/popup.html#settings` : host }],
        getCurrent: async () => ({ id: 8, openerTabId: 7 }),
        get: async () => ({ id: 7, url: host }),
        update: async (id, patch) => { window.mock.activated.push({ id, patch }); },
        create: async options => { window.mock.created.push(options); },
        sendMessage: async (id, message) => {
          window.mock.messages.push({ id, ...message });
          if (status === 'unavailable') throw new Error('No content script');
          return { version: status === 'old' ? '0.3.0' : '0.4.2', media: 12, analyzed: 10, detected: 4 };
        },
      },
    };
  }, { settings: { ...DEFAULT_SETTINGS, ...patch }, origin, host, status, failLoad, preferences });
  await page.goto(`${origin}/popup.html${hash}`);
  await page.waitForFunction(failed => failed ? !document.querySelector('#retrySettings').hidden : !document.body.classList.contains('loading'), failLoad);
  return page;
}
async function saved(page, field, value) {
  await page.waitForFunction(({ field, value }) => JSON.stringify(window.mock.settings[field]) === JSON.stringify(value), { field, value });
}
async function noOverflow(page, scrolling = false) {
  const dimensions = await page.evaluate(() => {
    const main = document.querySelector('main');
    return { width: document.documentElement.scrollWidth, viewport: innerWidth, bodyHeight: document.body.scrollHeight,
      viewportHeight: innerHeight, mainHeight: main.clientHeight, contentHeight: main.scrollHeight };
  });
  assert.ok(dimensions.width <= dimensions.viewport, `Horizontal overflow: ${JSON.stringify(dimensions)}`);
  assert.ok(dimensions.bodyHeight <= dimensions.viewportHeight, `Outer scrolling: ${JSON.stringify(dimensions)}`);
  if (!scrolling) assert.ok(dimensions.contentHeight <= dimensions.mainHeight + 1, `Popup requires scrolling: ${JSON.stringify(dimensions)}`);
  return dimensions;
}

try {
  const popup = await open();
  console.log('Default popup:', await noOverflow(popup));
  await popup.screenshot({ path: resolve(review, 'popup.png'), animations: 'disabled' });
  await popup.locator('#videosTab').click();
  assert.equal(await popup.locator('#imagePanel').isVisible(), false);
  await popup.locator('#videoEffect').selectOption('blur');
  await saved(popup, 'videoEffect', 'blur');
  await popup.locator('#videoEffectOptions summary').click();
  await popup.locator('#videoEffectIntensity').fill('40');
  await popup.locator('#videoEffectIntensity').dispatchEvent('change');
  await saved(popup, 'videoEffectIntensity', 40);
  await popup.locator('#videoEffectGrayscale').check();
  await saved(popup, 'videoEffectGrayscale', true);
  await popup.screenshot({ path: resolve(review, 'popup-video.png'), animations: 'disabled' });
  await popup.locator('#videosTab').focus();
  await popup.keyboard.press('ArrowLeft');
  assert.equal(await popup.locator('#imagesTab').getAttribute('aria-selected'), 'true');
  assert.equal(await popup.locator('#imagesTab').evaluate(node => node === document.activeElement), true);
  await popup.locator('#imageCoverage').selectOption('whole-body');
  await popup.locator('#imageWholeBodyEffect').selectOption('blur');
  await popup.locator('#imageWholeBodyFaceEffect').selectOption('checkerboard');
  await noOverflow(popup, true);
  await popup.screenshot({ path: resolve(review, 'popup-whole-body.png'), animations: 'disabled' });
  await popup.locator('#imageEffectOptions summary').click();
  await popup.locator('#imageFaceEffectOptions summary').click();
  await popup.locator('#videos').uncheck();
  const siteBox = await popup.locator('.page-card').boundingBox();
  const footerBox = await popup.locator('footer').boundingBox();
  assert.ok(siteBox.y + siteBox.height <= footerBox.y + 1, 'Current-site actions stay above the footer');
  await popup.screenshot({ path: resolve(review, 'popup-expanded.png'), animations: 'disabled' });
  await popup.locator('#videos').check();
  await popup.locator('#imageCoverage').selectOption('whole-body-face');
  assert.equal(await popup.locator('#imageWholeBodyFaceControl').isVisible(), false);
  assert.equal(await popup.locator('#imageFaceEffectOptions').isVisible(), false);
  await popup.locator('#imageCoverage').selectOption('regions');
  await popup.locator('#images').uncheck();
  assert.equal(await popup.locator('#imagesDisabled').isVisible(), true);
  await popup.locator('#images').check();
  await popup.locator('#toggleSite').click();
  await saved(popup, 'siteExceptions', ['example.com']);
  assert.equal(await popup.locator('#protectionTitle').textContent(), 'Paused on this site');
  await popup.locator('#toggleSite').click();
  await saved(popup, 'siteExceptions', []);
  await popup.locator('#filter').selectOption('off');
  assert.equal(await popup.locator('#protectionTitle').textContent(), 'No people selected');
  await popup.locator('#filter').selectOption('female');
  await popup.evaluate(() => { window.mock.failNext = true; });
  await popup.locator('#enabled').click();
  await popup.locator('#saveStatus').filter({ hasText: 'Could not save' }).waitFor();
  assert.equal(await popup.locator('#enabled').isChecked(), true, 'Failed writes restore the saved value');
  await popup.locator('#enabled').uncheck();
  await saved(popup, 'enabled', false);
  await popup.locator('#openSettings').click();
  assert.deepEqual(await popup.evaluate(() => window.mock.created.at(-1)), { url: `${origin}/popup.html#settings/coverage`, openerTabId: 7 });

  const desktop = await open({ hash: '#settings/coverage', viewport: { width: 1180, height: 850 } });
  await noOverflow(desktop, true);
  assert.equal(await desktop.locator('#imagePanel').isVisible(), true);
  assert.equal(await desktop.locator('#videoPanel').isVisible(), true);
  await desktop.screenshot({ path: resolve(review, 'settings-desktop.png'), animations: 'disabled' });
  assert.equal(await desktop.locator('#skinThresholdSettings').evaluate(node => node.open), true);
  assert.equal(await desktop.locator('#imageSkinThresholdControls').isVisible(), false);
  await desktop.locator('#imageSkinThresholdEnabled').check();
  await saved(desktop, 'imageSkinThresholdEnabled', true);
  await desktop.locator('#imageSkinThresholdPercent').fill('83');
  await desktop.locator('#imageSkinThresholdPercent').dispatchEvent('change');
  await saved(desktop, 'imageSkinThresholdPercent', 83);
  await desktop.locator('#imageSkinThresholdIncludeFace').check();
  await saved(desktop, 'imageSkinThresholdIncludeFace', true);
  await desktop.locator('#imageGroupSkinThresholdEnabled').check();
  await saved(desktop, 'imageGroupSkinThresholdEnabled', true);
  for (const [id, value] of [['imageGroupSkinThresholdPercent', 71], ['imageGroupSkinPeopleLimit', 4]]) {
    await desktop.locator(`#${id}`).fill(String(value));
    await desktop.locator(`#${id}`).dispatchEvent('change');
    await saved(desktop, id, value);
  }
  await desktop.locator('#imageSkinThresholdPercent').fill('101');
  await desktop.locator('#imageSkinThresholdPercent').dispatchEvent('change');
  assert.equal(await desktop.locator('#imageSkinThresholdPercent').getAttribute('aria-invalid'), 'true');
  assert.equal(await desktop.evaluate(() => window.mock.settings.imageSkinThresholdPercent), 83);
  await desktop.locator('#imageSkinThresholdPercent').fill('83');
  await desktop.locator('#imageSkinThresholdPercent').dispatchEvent('change');
  await saved(desktop, 'imageSkinThresholdPercent', 83);
  await desktop.locator('#skinThresholdSettings').scrollIntoViewIfNeeded();
  await noOverflow(desktop, true);
  await desktop.screenshot({ path: resolve(review, 'skin-thresholds-desktop.png'), animations: 'disabled' });
  await desktop.locator('[data-section=detection]').click();
  await desktop.locator('#imageGenderModel').selectOption('body-intel');
  await saved(desktop, 'imageGenderModel', 'body-intel');
  await desktop.locator('#imageDetectionGate').selectOption('person');
  await saved(desktop, 'imageDetectionGate', 'person');
  await desktop.locator('#videoDetector').selectOption('fast-box');
  assert.equal(await desktop.locator('#yoloVideoSizeControl').evaluate(node => node.hidden), true);
  await desktop.locator('[data-section=performance]').click();
  await desktop.locator('#performance').selectOption('quality');
  await desktop.locator('summary').filter({ hasText: 'Model resolution' }).click();
  assert.equal(await desktop.locator('#yoloImageSizeValue').textContent(), 'Auto · 416 × 416');
  await desktop.locator('#onnxThreads').selectOption('8');
  await saved(desktop, 'onnxThreads', 8);
  await desktop.locator('[data-section=diagnostics]').click();
  await desktop.locator('#debugOverlay').check();
  await saved(desktop, 'debugOverlay', true);
  await desktop.locator('summary').filter({ hasText: 'Advanced AI thresholds' }).click();
  await desktop.locator('#yoloConfidence').fill('0.25');
  await desktop.locator('#yoloConfidence').dispatchEvent('change');
  await saved(desktop, 'yoloConfidence', 0.25);
  await desktop.locator('#retryEngine').click();
  assert.ok(await desktop.evaluate(() => window.mock.messages.some(message => message.type === 'retry-media' && message.id === 7)));
  await desktop.locator('#labelPerson').click();
  assert.ok(await desktop.evaluate(() => window.mock.messages.some(message => message.type === 'start-label' && message.id === 7)));
  await desktop.locator('[data-section=websites]').click();
  await desktop.locator('#siteExceptions').fill('example.org,\nhttps://www.another.test/path');
  await desktop.locator('#siteExceptions').blur();
  assert.deepEqual(await desktop.evaluate(() => window.mock.settings.siteExceptions), [], 'Website drafts do not save on blur');
  await desktop.locator('[data-section=coverage]').click();
  await desktop.locator('[data-section=websites]').click();
  assert.match(await desktop.locator('#siteExceptions').inputValue(), /another.test/, 'Website drafts survive navigation');
  await desktop.locator('#saveSites').click();
  await saved(desktop, 'siteExceptions', ['example.org', 'another.test']);
  await desktop.locator('#siteExceptions').fill('not a domain!');
  await desktop.locator('#saveSites').click();
  await desktop.locator('#saveStatus').filter({ hasText: 'Use valid' }).waitFor();
  assert.deepEqual(await desktop.evaluate(() => window.mock.settings.siteExceptions), ['example.org', 'another.test']);

  const narrow = await open({ hash: '#settings/coverage', viewport: { width: 400, height: 850 } });
  await noOverflow(narrow, true);
  await narrow.screenshot({ path: resolve(review, 'settings-narrow.png'), animations: 'disabled' });
  await narrow.locator('#imageSkinThresholdEnabled').check();
  await narrow.locator('#imageGroupSkinThresholdEnabled').check();
  await narrow.locator('#skinThresholdSettings').scrollIntoViewIfNeeded();
  await noOverflow(narrow, true);
  await narrow.screenshot({ path: resolve(review, 'skin-thresholds-narrow.png'), animations: 'disabled' });
  const inherited = await open({ host: 'https://news.example.com', patch: { siteExceptions: ['example.com'] } });
  assert.equal(await inherited.locator('#toggleSite').isDisabled(), true);
  assert.equal(await inherited.locator('#manageSites').isVisible(), true);
  await inherited.screenshot({ path: resolve(review, 'popup-inherited.png'), animations: 'disabled' });
  const restricted = await open({ host: 'chrome://extensions/' });
  assert.equal(await restricted.locator('#toggleSite').isDisabled(), true);
  assert.match(await restricted.locator('#pageStatus').textContent(), /Open a website/);
  const old = await open({ status: 'old' });
  assert.match(await old.locator('#pageStatus').textContent(), /latest Sitr/);
  const failed = await open({ failLoad: true });
  assert.equal(await failed.locator('#enabled').isDisabled(), true);
  await failed.evaluate(() => { window.mock.failLoad = false; });
  await failed.locator('#retrySettings').click();
  await failed.locator('#saveStatus').filter({ hasText: 'Saved automatically' }).waitFor();
  assert.equal(await failed.locator('#enabled').isDisabled(), false);

  // Theme/language changes must preserve protection settings and website drafts.
  const localized = await open();
  const revision = await localized.evaluate(() => window.mock.settings.revision);
  await localized.locator('#uiTheme').selectOption('dark');
  await localized.locator('#uiLanguage').selectOption('ar');
  await localized.waitForFunction(() => document.documentElement.lang === 'ar' && !document.querySelector('#uiLanguage').disabled);
  assert.equal(await localized.locator('html').getAttribute('dir'), 'rtl');
  assert.equal(await localized.locator('#protectionTitle').textContent(), 'الحماية مفعّلة');
  assert.equal(await localized.locator('#filter').inputValue(), 'female');
  assert.equal(await localized.evaluate(() => window.mock.settings.revision), revision, 'Display changes do not touch analysis settings');
  assert.match(await localized.locator('#pageStatus').textContent(), /١٢/);
  await noOverflow(localized);
  await localized.screenshot({ path: resolve(review, 'popup-ar-dark.png'), animations: 'disabled' });
  await localized.reload();
  await localized.waitForFunction(() => !document.body.classList.contains('loading'));
  assert.equal(await localized.locator('html').getAttribute('lang'), 'ar');
  assert.equal(await localized.locator('#uiTheme').inputValue(), 'dark');
  await localized.evaluate(() => { window.mock.failPreferenceSave = true; });
  await localized.locator('#uiTheme').selectOption('light');
  await localized.locator('#saveStatus').filter({ hasText: 'تعذّر حفظ إعدادات المظهر' }).waitFor();
  assert.equal(await localized.locator('#uiTheme').inputValue(), 'dark', 'A failed display save restores the previous theme');
  await localized.locator('#uiTheme').selectOption('light');
  await localized.waitForFunction(() => document.querySelector('#saveStatus').dataset.state !== 'error');
  await localized.screenshot({ path: resolve(review, 'popup-ar-light.png'), animations: 'disabled' });
  await localized.locator('#uiLanguage').selectOption('en');
  assert.equal(await localized.locator('#imagesTab').textContent(), 'Images');
  assert.equal(await localized.locator('html').getAttribute('dir'), 'ltr');
  const system = await open({ colorScheme: 'dark' });
  assert.equal(await system.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'dark');
  await system.emulateMedia({ colorScheme: 'light' });
  assert.equal(await system.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'light');
  await system.locator('#uiTheme').selectOption('dark');
  assert.equal(await system.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'dark');
  await system.screenshot({ path: resolve(review, 'popup-en-dark.png'), animations: 'disabled' });
  const arabicDefault = await open({ preferences: null, locale: 'ar-SA' });
  assert.equal(await arabicDefault.locator('html').getAttribute('lang'), 'ar');
  const arabicSettings = await open({ hash: '#settings/coverage', preferences: { language: 'ar', theme: 'dark' }, viewport: { width: 1180, height: 850 } });
  await noOverflow(arabicSettings, true);
  await arabicSettings.screenshot({ path: resolve(review, 'settings-ar-dark.png'), animations: 'disabled' });
  await arabicSettings.locator('[data-section=performance]').click();
  await arabicSettings.locator('summary').filter({ hasText: 'دقة النماذج' }).click();
  assert.match(await arabicSettings.locator('#yoloImageSizeValue').textContent(), /تلقائي.*٣٢٠/);
  await arabicSettings.locator('[data-section=websites]').click();
  await arabicSettings.locator('#siteExceptions').fill('example.net');
  await arabicSettings.locator('#uiLanguage').selectOption('en');
  assert.equal(await arabicSettings.locator('#siteExceptions').inputValue(), 'example.net');
  assert.match(await arabicSettings.locator('#saveStatus').textContent(), /Unsaved websites/);
  await arabicSettings.locator('#uiLanguage').selectOption('ar');
  await arabicSettings.locator('#siteExceptions').fill('bad domain!');
  await arabicSettings.locator('#saveSites').click();
  assert.match(await arabicSettings.locator('#saveStatus').textContent(), /روابط مواقع صحيحة/);
  const arabicNarrow = await open({ hash: '#settings/coverage', preferences: { language: 'ar', theme: 'dark' }, viewport: { width: 400, height: 850 } });
  await noOverflow(arabicNarrow, true);
  await arabicNarrow.screenshot({ path: resolve(review, 'settings-ar-narrow.png'), animations: 'disabled' });
  await arabicNarrow.locator('#imageSkinThresholdEnabled').check();
  await arabicNarrow.locator('#imageGroupSkinThresholdEnabled').check();
  await arabicNarrow.locator('#skinThresholdSettings').scrollIntoViewIfNeeded();
  await noOverflow(arabicNarrow, true);
  await arabicNarrow.screenshot({ path: resolve(review, 'skin-thresholds-ar-narrow.png'), animations: 'disabled' });
  const untranslated = await arabicNarrow.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const remaining = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent.trim();
      if (/^[a-z][a-z\s.,()/·×–—-]+$/i.test(text) && text !== 'English') remaining.push(text);
    }
    return remaining;
  });
  assert.deepEqual(untranslated, [], 'All static Arabic UI copy, including hidden settings, is translated');
  const contrast = await arabicNarrow.evaluate(() => {
    const luminance = color => {
      const rgb = color.match(/[\d.]+/g).slice(0, 3).map(value => {
        const c = Number(value) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    return ['#appSubtitle', '.setting-hint', '#saveStatus', '#filter', '#uiTheme'].map(selector => {
      const node = document.querySelector(selector);
      const style = getComputedStyle(node);
      let parent = node;
      let background;
      do { background = getComputedStyle(parent).backgroundColor; parent = parent.parentElement; } while (background === 'rgba(0, 0, 0, 0)' && parent);
      const foreground = luminance(style.color);
      const ground = luminance(background);
      return { selector, ratio: (Math.max(foreground, ground) + 0.05) / (Math.min(foreground, ground) + 0.05) };
    });
  });
  contrast.forEach(({ selector, ratio }) => assert.ok(ratio >= 4.5, `Dark text contrast below 4.5: ${selector} = ${ratio}`));
  assert.deepEqual(errors, [], 'No browser script errors');
  console.log('PASS: popup layout, appearance tabs, effects, persistence, failures, website exceptions, full settings, responsive layout, and originating-page actions.');

  // Verify real Chrome APIs, host access, persistence, and settings-tab navigation without loading media models.
  const cacheRoot = resolve(root, '.cache');
  const profile = await mkdtemp(resolve(cacheRoot, 'popup-ux-profile-'));
  let extension;
  try {
    const dist = resolve(root, 'dist');
    extension = await chromium.launchPersistentContext(profile, {
      headless: true, channel: 'chromium', viewport: { width: 400, height: 590 },
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    });
    const worker = extension.serviceWorkers()[0] || await extension.waitForEvent('serviceworker');
    const website = await extension.newPage();
    await website.goto(`${origin}/website`);
    const ui = await extension.newPage();
    await website.bringToFront();
    await ui.goto(new URL('popup.html', worker.url()).href);
    await ui.locator('#saveStatus').filter({ hasText: 'Saved automatically' }).waitFor();
    await ui.locator('#siteHost').filter({ hasText: '127.0.0.1' }).waitFor();
    await ui.locator('#toggleSite').click();
    await ui.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings.siteExceptions.includes('127.0.0.1'));
    await ui.locator('#toggleSite').click();
    await ui.waitForFunction(async () => !(await chrome.storage.local.get('settings')).settings.siteExceptions.includes('127.0.0.1'));
    await ui.locator('#filter').selectOption('both');
    await ui.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings.filter === 'both');
    await ui.reload();
    await ui.locator('#saveStatus').filter({ hasText: 'Saved automatically' }).waitFor();
    assert.equal(await ui.locator('#filter').inputValue(), 'both');
    const opened = extension.waitForEvent('page');
    await ui.locator('#openSettings').click();
    const settingsPage = await opened;
    await settingsPage.waitForURL(/#settings\/coverage/);
    await settingsPage.locator('#saveStatus').filter({ hasText: 'Saved automatically' }).waitFor();
    await settingsPage.locator('#imageSkinThresholdEnabled').check();
    await settingsPage.locator('#imageSkinThresholdPercent').fill('85');
    await settingsPage.locator('#imageSkinThresholdPercent').dispatchEvent('change');
    await settingsPage.locator('#imageGroupSkinThresholdEnabled').check();
    await settingsPage.locator('#imageGroupSkinPeopleLimit').fill('4');
    await settingsPage.locator('#imageGroupSkinPeopleLimit').dispatchEvent('change');
    await settingsPage.waitForFunction(async () => {
      const value = (await chrome.storage.local.get('settings')).settings;
      return value.imageSkinThresholdEnabled && value.imageSkinThresholdPercent === 85 &&
        value.imageGroupSkinThresholdEnabled && value.imageGroupSkinPeopleLimit === 4;
    });
    await settingsPage.reload();
    await settingsPage.locator('#saveStatus').filter({ hasText: 'Saved automatically' }).waitFor();
    assert.equal(await settingsPage.locator('#imageSkinThresholdPercent').inputValue(), '85');
    assert.equal(await settingsPage.locator('#imageGroupSkinPeopleLimit').inputValue(), '4');
    await settingsPage.locator('[data-section=websites]').click();
    await settingsPage.locator('#siteExceptions').fill('https://www.example.org/path, example.org, example.net');
    await settingsPage.locator('#saveSites').click();
    await settingsPage.waitForFunction(async () => JSON.stringify((await chrome.storage.local.get('settings')).settings.siteExceptions) === '["example.org","example.net"]');
    const beforeDisplay = await settingsPage.evaluate(async () => (await chrome.storage.local.get('settings')).settings.revision);
    await settingsPage.locator('#uiTheme').selectOption('dark');
    await settingsPage.locator('#uiLanguage').selectOption('ar');
    await settingsPage.waitForFunction(async () => (await chrome.storage.local.get('uiPreferences')).uiPreferences.language === 'ar');
    await ui.waitForFunction(() => document.documentElement.lang === 'ar');
    assert.equal(await ui.locator('#uiTheme').inputValue(), 'dark', 'Real display preferences sync across open views');
    assert.equal(await settingsPage.evaluate(async () => (await chrome.storage.local.get('settings')).settings.revision), beforeDisplay);
    console.log('PASS: loaded unpacked extension, real site pause/resume, settings persisted across reload, full-page settings opened, domain normalization.');
  } finally {
    await extension?.close();
    if (!profile.startsWith(cacheRoot + sep) || !profile.split(sep).at(-1).startsWith('popup-ux-profile-')) throw new Error('Unsafe profile cleanup path');
    await rm(profile, { recursive: true, force: true });
  }
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
