// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const photo = await readFile(resolve('tests/fixtures/bus.jpg'));
const server = createServer((request, response) => {
  response.setHeader('content-type', request.url === '/photo.jpg' ? 'image/jpeg' : 'text/html');
  response.end(request.url === '/photo.jpg' ? photo :
    '<!doctype html><img id="first" width="240" src="/photo.jpg"><img id="second" width="240" src="/photo.jpg">');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'image-navigation-'));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`] });
  const page = await browser.newPage();
  await page.goto(origin);
  const ready = () => page.waitForFunction(() => [...document.images].every(image =>
    image.dataset.localMediaCensorSequence && !image.hasAttribute('data-local-media-censor-pending')),
  undefined, { timeout: 60000 });
  await ready();
  await page.evaluate(() => {
    window.resets = [];
    new MutationObserver(records => {
      for (const record of records) window.resets.push(record.target.id);
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-local-media-censor-pending'] });
  });
  const before = await page.locator('img').evaluateAll(images => images.map(image => image.dataset.localMediaCensorTimingsMs));
  // Simulate opening and closing a history-backed preview, including back/forward.
  await page.evaluate(async () => {
    history.pushState({ preview: true }, '', '?preview=1');
    const back = new Promise(resolve => window.addEventListener('popstate', resolve, { once: true }));
    history.back(); await back;
    const forward = new Promise(resolve => window.addEventListener('popstate', resolve, { once: true }));
    history.forward(); await forward;
    const hash = new Promise(resolve => window.addEventListener('hashchange', resolve, { once: true }));
    location.hash = 'closed'; await hash;
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  assert.deepEqual(await page.evaluate(() => window.resets), [], 'Unchanged grid images must not reset on navigation');
  assert.deepEqual(await page.locator('img').evaluateAll(images => images.map(image => image.dataset.localMediaCensorTimingsMs)), before);

  // A real source replacement must still be protected and analyzed.
  await page.locator('#first').evaluate(image => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
    image.src = canvas.toDataURL('image/png');
  });
  await page.waitForFunction(() => window.resets.includes('first'));
  await ready();
  assert(!(await page.evaluate(() => window.resets)).includes('second'), 'Changing one source must not reset its neighbor');

  await page.evaluate(() => { window.resets = []; });
  const worker = browser.serviceWorkers()[0];
  await worker.evaluate(async origin => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(origin));
    await chrome.tabs.sendMessage(tab.id, { type: 'retry-media' });
  }, origin);
  await page.waitForFunction(() => window.resets.includes('first') && window.resets.includes('second'));
  await ready();
  console.log('PASS: history/sidebar transitions preserve images; source replacement and explicit Retry still reanalyze.');
} finally {
  await browser?.close(); server.close();
  await rm(profile, { recursive: true, force: true });
}
