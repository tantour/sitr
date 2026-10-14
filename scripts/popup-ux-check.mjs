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
const version = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8')).version;
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
async function open({ patch = {}, hash = '', viewport = { width: 440, height: 600 }, host = 'https://example.com/gallery', status = 'ready', failLoad = false, preferences = { theme: 'system', language: 'en' }, colorScheme = 'light', locale = 'en-US' } = {}) {
  const page = await browser.newPage({ viewport, colorScheme, locale });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ settings, origin, host, status, failLoad, preferences, version }) => {
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
        getManifest: () => ({ version }),
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
          return { version: status === 'old' ? '0.3.0' : version, media: 12, analyzed: 10, detected: 4 };
        },
      },
    };
  }, { settings: { ...DEFAULT_SETTINGS, ...patch }, origin, host, status, failLoad, preferences, version });
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
  await noOverflow(popup, true);
  assert.equal(await popup.locator('#filter,#bodySkin,#hair,#imageRegionFaceEffect').count(), 0, 'No global gender/skin/hair/face selectors');
  assert.equal(await popup.locator('[data-person-area=body]').isVisible(),true);
  assert.equal(await popup.locator('[data-person-area=upper-arms]').isVisible(),false);
  assert.equal(await popup.locator('#imageBodyRegionMode').isVisible(),false);
  await popup.locator('#malePolicyTab').click();
  await popup.locator('#showAllAreas').click();
  await popup.waitForFunction(() => window.mock.settings.personPolicies.male.hair === 'show');
  await popup.locator('#personAreaSelect').selectOption('hair'); await popup.locator('[data-person-action=hide]').click();
  await popup.waitForFunction(() => window.mock.settings.personPolicies.male.hair === 'hide');
  await popup.locator('#personAreaSelect').selectOption('face'); await popup.locator('[data-person-action=blur]').click();
  await popup.waitForFunction(() => window.mock.settings.personPolicies.male.face === 'blur');
  assert.equal(await popup.locator('#imageFaceEffectOptions').isVisible(),true);
  await popup.locator('#imageFaceEffectIntensity').fill('38'); await popup.locator('#imageFaceEffectIntensity').dispatchEvent('change');
  await popup.waitForFunction(() => window.mock.settings.personPolicies.male.faceStrength === 38);
  await popup.locator('#femalePolicyTab').click(); await popup.locator('#personAreaSelect').selectOption('face');
  await popup.locator('[data-person-action=checkerboard]').click();
  await popup.waitForFunction(() => window.mock.settings.personPolicies.female.face === 'checkerboard');
  assert.equal(await popup.locator('#imageFaceEffectIntensity').inputValue(),'24');
  await popup.locator('#malePolicyTab').click();
  assert.equal(await popup.locator('#imageFaceEffectIntensity').inputValue(),'38');
  await popup.screenshot({path:resolve(review,'person-editor-face.png'),animations:'disabled'});
  await popup.locator('#hideAllAreas').click(); await popup.locator('#showAllAreas').click();
  await popup.waitForFunction(() => window.mock.settings.personPolicies.male.skin.torso === 'show');
  assert.deepEqual(await popup.evaluate(() => { const p=window.mock.settings.personPolicies.male;return [p.hair,p.face,p.skin.thighs]; }),['hide','blur','show']);
  await popup.locator('#personAreaSelect').selectOption('body');
  await popup.locator('#personEditor').scrollIntoViewIfNeeded();
  await popup.screenshot({path:resolve(review,'person-editor-off.png'),animations:'disabled'});
  await popup.locator('#bodyPixEnabled').check();
  await popup.waitForFunction(() => window.mock.settings.imageBodyRegionMode === 'faster');
  assert.equal(await popup.locator('[data-person-area=body]').isVisible(),false);
  assert.equal(await popup.locator('[data-person-area=upper-arms]').isVisible(),true);
  await popup.locator('#showAllAreas').click();
  await popup.locator('[data-person-area=thighs] path').first().click();
  await popup.locator('[data-person-action=hide]').click();
  await popup.waitForFunction(() => window.mock.settings.personPolicies.male.skin.thighs === 'hide');
  assert.equal(await popup.evaluate(() => window.mock.settings.imageBodyRegionMode), 'faster');
  assert.deepEqual(await popup.evaluate(() => {
    const p = window.mock.settings.personPolicies.male; return [p.hair, p.face, p.skin.neck, p.skin.torso, p.otherSkin];
  }), ['show','show','show','show','show']);
  await popup.evaluate(() => document.querySelector('main').scrollTop = 0);
  await popup.screenshot({ path: resolve(review,'person-editor-controls.png'), animations:'disabled' });
  await popup.locator('#personEditor').scrollIntoViewIfNeeded();
  await popup.screenshot({ path: resolve(review,'person-editor-popup.png'), animations:'disabled' });
  await popup.locator('[data-person-area=face]').focus();
  await popup.keyboard.press('Enter');
  await popup.locator('[data-person-action=blur]').click();
  await popup.waitForFunction(() => window.mock.settings.personPolicies.male.face === 'blur');
  await popup.locator('#femalePolicyTab').click();
  await popup.locator('#personAreaSelect').selectOption('face');
  await popup.locator('[data-person-action=black]').click();
  await popup.waitForFunction(() => window.mock.settings.personPolicies.female.face === 'black');
  await popup.locator('#malePolicyTab').focus(); await popup.keyboard.press('ArrowLeft');
  assert.equal(await popup.locator('#femalePolicyTab').getAttribute('aria-selected'), 'true');
  await popup.locator('#malePolicyTab').click();
  assert.equal(await popup.locator('[data-person-action=blur]').getAttribute('aria-pressed'),'true');
  await popup.locator('#bodyPixEnabled').uncheck();
  await popup.waitForFunction(() => window.mock.settings.imageBodyRegionMode === 'off');
  assert.equal(await popup.locator('[data-person-area=body]').isVisible(),true);
  assert.equal(await popup.locator('[data-person-area=forearms]').isVisible(),false);
  assert.equal(await popup.evaluate(() => window.mock.settings.personPolicies.male.face),'blur');
  await popup.locator('#bodyPixEnabled').check();
  await popup.waitForFunction(() => window.mock.settings.imageBodyRegionMode === 'faster');
  await popup.locator('#personAreaSelect').selectOption('face');
  await popup.evaluate(() => { window.mock.failNext = true; });
  await popup.locator('[data-person-action=black]').click();
  await popup.locator('#saveStatus').filter({ hasText:'Could not save' }).waitFor();
  assert.equal(await popup.locator('[data-person-action=blur]').getAttribute('aria-pressed'),'true');
  await popup.locator('#videosTab').click();
  await popup.locator('#videoPolicy-male').selectOption('blur');
  await popup.waitForFunction(() => window.mock.settings.personPolicies.male.video === 'blur');
  await popup.locator('#videoEffectOptions > summary').click();
  await popup.locator('#videoEffectIntensity').fill('40'); await popup.locator('#videoEffectIntensity').dispatchEvent('change');
  await saved(popup,'videoEffectIntensity',40);
  await popup.evaluate(() => document.querySelector('main').scrollTop = 0);
  await popup.screenshot({path:resolve(review,'person-editor-video.png'),animations:'disabled'});
  await popup.locator('#toggleSite').click(); await saved(popup,'siteExceptions',['example.com']);
  await popup.locator('#toggleSite').click(); await saved(popup,'siteExceptions',[]);
  await popup.locator('#openSettings').click();
  assert.match(await popup.evaluate(() => window.mock.created.at(-1).url), /#settings\/coverage$/);
  const failed = await open({ failLoad:true });
  assert.equal(await failed.locator('#showAllAreas').isDisabled(),true);
  await failed.evaluate(() => { window.mock.failLoad = false; }); await failed.locator('#retrySettings').click();
  await failed.locator('#saveStatus').filter({ hasText:'Saved automatically' }).waitFor();
  assert.equal(await failed.locator('#showAllAreas').isDisabled(),false);

  const desktop = await open({ hash:'#settings/coverage',viewport:{width:1180,height:1080} });
  assert.equal(await desktop.locator('#version').textContent(),`Version ${version}`);
  await desktop.locator('#bodyPixEnabled').check();
  await desktop.waitForFunction(() => window.mock.settings.imageBodyRegionMode === 'faster');
  await desktop.locator('#malePolicyTab').click(); await desktop.locator('#showAllAreas').click();
  await desktop.locator('#personAreaSelect').selectOption('thighs'); await desktop.locator('[data-person-action=hide]').click();
  await desktop.waitForFunction(() => window.mock.settings.personPolicies.male.skin.thighs === 'hide');
  await noOverflow(desktop,true); await desktop.screenshot({path:resolve(review,'person-editor-desktop.png'),animations:'disabled'});
  const arabic = await open({hash:'#settings/coverage',preferences:{language:'ar',theme:'dark'},viewport:{width:400,height:850}});
  await arabic.locator('#bodyPixEnabled').check();
  await arabic.waitForFunction(() => window.mock.settings.imageBodyRegionMode === 'faster');
  await arabic.locator('#malePolicyTab').click(); await arabic.locator('#showAllAreas').click();
  await arabic.locator('#personAreaSelect').selectOption('thighs'); await arabic.locator('[data-person-action=hide]').click();
  await arabic.waitForFunction(() => window.mock.settings.personPolicies.male.skin.thighs === 'hide');
  await arabic.evaluate(() => { const main = document.querySelector('main'); main.scrollTop += document.querySelector('#personEditor').getBoundingClientRect().top - main.getBoundingClientRect().top - 12; });
  await noOverflow(arabic,true); await arabic.screenshot({path:resolve(review,'person-editor-ar-narrow.png'),animations:'disabled'});
  for (const [language,theme,file] of [['en','dark','person-editor-en-dark.png'],['ar','light','person-editor-ar-light.png']]) {
    const variant=await open({preferences:{language,theme}});
    await variant.locator('#bodyPixEnabled').check();
    await variant.waitForFunction(() => window.mock.settings.imageBodyRegionMode === 'faster');
    await variant.locator('#malePolicyTab').click(); await variant.locator('#showAllAreas').click();
    await variant.locator('#personAreaSelect').selectOption('thighs'); await variant.locator('[data-person-action=hide]').click();
    await variant.evaluate(() => document.querySelector('main').scrollTop = 0);
    await noOverflow(variant,true); await variant.screenshot({path:resolve(review,file),animations:'disabled'});
  }
  assert.equal(await arabic.locator('html').getAttribute('dir'),'rtl');
  const untranslated = await arabic.evaluate(() => {
    const walker = document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT), remaining=[];
    for(let node=walker.nextNode();node;node=walker.nextNode()) { const text=node.textContent.trim();
      if(/^[a-z][a-z\s.,()/·×–—-]+$/i.test(text) && !['English','BodyPix'].includes(text)) remaining.push(text); }
    return remaining;
  });
  assert.deepEqual(untranslated,[],'All Arabic controls translated');
  await arabic.locator('#uiLanguage').selectOption('en');
  await arabic.waitForFunction(() => document.documentElement.lang === 'en' && !document.querySelector('#uiLanguage').disabled);
  assert.equal(await arabic.locator('#personAreaTitle').textContent(),'Thighs');
  const revision = await arabic.evaluate(() => window.mock.settings.revision);
  await arabic.locator('#uiTheme').selectOption('light');
  await arabic.waitForFunction(() => !document.querySelector('#uiTheme').disabled);
  assert.equal(await arabic.evaluate(() => window.mock.settings.revision),revision);
  await desktop.locator('[data-section=websites]').click();
  await desktop.locator('#siteExceptions').fill('example.org'); await desktop.locator('#saveSites').click(); await saved(desktop,'siteExceptions',['example.org']);
  await desktop.locator('[data-section=coverage]').click();
  assert.equal(await desktop.locator('#skinThresholdSettings').count(),0);
  assert.equal(await desktop.locator('#imageCoverage option[value="whole-body-face"]').count(),0);
  assert.equal(await desktop.locator('.image-settings-bar #imageCoverage').count(),1);
  await desktop.locator('#imageCoverage').selectOption('whole-body'); await saved(desktop,'imageCoverage','whole-body');
  await desktop.locator('#personAreaSelect').selectOption('face'); await desktop.locator('[data-person-action=blur]').click();
  await desktop.waitForFunction(() => window.mock.settings.personPolicies.male.face === 'blur');
  assert.equal(await desktop.locator('#imageFaceEffectOptions').isVisible(),true);
  await desktop.locator('#imageFaceEffectIntensity').fill('38'); await desktop.locator('#imageFaceEffectIntensity').dispatchEvent('change');
  await desktop.waitForFunction(() => window.mock.settings.personPolicies.male.faceStrength === 38);
  assert.equal(await desktop.evaluate(() => window.mock.settings.imageCoverage),'whole-body','Face choices preserve cover mode');
  await desktop.locator('[data-person-action=show]').click();
  await desktop.waitForFunction(() => window.mock.settings.personPolicies.male.face === 'show');
  assert.equal(await desktop.locator('#imageFaceEffectOptions').isVisible(),false);
  assert.deepEqual(errors,[],'No browser script errors');
  console.log('PASS: gender tabs, keyboard diagram, male thighs only, independent faces, save recovery, model selection, video policies, website exceptions, English/Arabic layouts.');

  const cacheRoot=resolve(root,'.cache'), profile=await mkdtemp(resolve(cacheRoot,'popup-ux-profile-'));
  let extension;
  try {
    extension=await chromium.launchPersistentContext(profile,{headless:true,channel:'chromium',args:[`--disable-extensions-except=${resolve(root,'dist')}`,`--load-extension=${resolve(root,'dist')}`]});
    const worker=extension.serviceWorkers()[0] ?? await extension.waitForEvent('serviceworker');
    const ui=await extension.newPage(); await ui.goto(new URL('popup.html#settings/coverage',worker.url()).href);
    await ui.locator('#saveStatus').filter({hasText:'Saved automatically'}).waitFor();
    await ui.locator('#bodyPixEnabled').check();
    await ui.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings.imageBodyRegionMode === 'faster');
    await ui.locator('#malePolicyTab').click(); await ui.locator('#showAllAreas').click();
    await ui.locator('#personAreaSelect').selectOption('thighs'); await ui.locator('[data-person-action=hide]').click();
    await ui.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings.personPolicies.male.skin.thighs === 'hide');
    await ui.locator('#personAreaSelect').selectOption('face'); await ui.locator('[data-person-action=blur]').click();
    await ui.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings.personPolicies.male.face === 'blur');
    await ui.reload(); await ui.locator('#saveStatus').filter({hasText:'Saved automatically'}).waitFor();
    await ui.locator('#malePolicyTab').click();
    await ui.locator('#personAreaSelect').selectOption('face');
    assert.equal(await ui.locator('[data-person-action=blur]').getAttribute('aria-pressed'),'true');
    assert.deepEqual(await ui.evaluate(async () => { const p=(await chrome.storage.local.get('settings')).settings.personPolicies.male; return [p.skin.thighs,p.skin.neck,p.hair,p.face]; }),['hide','show','show','blur']);
    console.log('PASS: real extension policy migration and persistence across reload.');
  } finally { await extension?.close(); if(!profile.startsWith(cacheRoot+sep)||!profile.split(sep).at(-1).startsWith('popup-ux-profile-')) throw Error('Unsafe profile cleanup'); await rm(profile,{recursive:true,force:true}); }
} finally { await browser.close(); await new Promise(done => server.close(done)); }
