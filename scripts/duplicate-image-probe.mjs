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
  response.setHeader('content-type', request.url.startsWith('/photo.jpg') ? 'image/jpeg' : 'text/html');
  response.end(request.url.startsWith('/photo.jpg') ? photo : '<!doctype html><style>img{vertical-align:top}</style>' +
    '<img id="first" width="180" src="/photo.jpg"><img id="second" width="120" src="/photo.jpg">');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'duplicate-image-'));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`] });
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
  await worker.evaluate(() => {
    globalThis.imageRequests = [];
    chrome.runtime.onMessage.addListener(message => {
      if (['analyze', 'reuse-image'].includes(message?.type)) globalThis.imageRequests.push({
        type: message.type, key: message.frame?.key ?? message.key });
    });
  });
  const page = await browser.newPage();
  await page.goto(origin);
  const ready = () => page.waitForFunction(() => [...document.images].every(image =>
    image.dataset.localMediaCensorSequence && !image.hasAttribute('data-local-media-censor-pending')),
  undefined, { timeout: 90000 }).catch(async error => {
    console.error('Duplicate fixture diagnostics:', await page.evaluate(() => [...document.images].map(image => ({
      id: image.id, size: [image.naturalWidth, image.naturalHeight], rect: image.getBoundingClientRect().toJSON(),
      status: image.dataset.localMediaCensorStatus, pending: image.hasAttribute('data-local-media-censor-pending'),
      sequence: image.dataset.localMediaCensorSequence, timings: image.dataset.localMediaCensorTimingsMs,
    }))));
    throw error;
  });
  const analysisCount = () => worker.evaluate(() => globalThis.imageRequests.filter(item => item.type === 'analyze').length);
  await ready();
  assert.equal(await analysisCount(), 1, 'Concurrent identical sources should submit one analysis');
  const reuse = await page.locator('img').evaluateAll(images => images.map(image => image.dataset.localMediaCensorImageReuse));
  assert.deepEqual(reuse.sort(), ['false', 'true']);

  // A later duplicate still reuses the canonical source after its original element disappears.
  await page.locator('#first').evaluate(image => image.remove());
  await page.evaluate(() => {
    const image = document.createElement('img'); image.id = 'third'; image.width = 180;
    image.src = '/photo.jpg'; document.body.append(image);
  });
  await ready();
  assert.equal(await analysisCount(), 1, 'Removing the first element must not retire the shared source');
  const timings = await page.locator('#third').evaluate(image => JSON.parse(image.dataset.localMediaCensorTimingsMs));
  for (const stage of ['personRun', 'semanticRun', 'faceRun', 'genderRun']) assert.equal(timings[stage], 0);

  const changeSource = source => page.locator('#third').evaluate((image, source) => new Promise(resolve => {
    image.addEventListener('load', () => resolve(), { once: true }); image.src = source;
  }), source);
  await changeSource('/photo.jpg?different-source');
  await ready();
  assert.equal(await analysisCount(), 2, 'A different URL must have its own source analysis');

  await changeSource('/photo.jpg');
  await ready();
  assert.equal(await analysisCount(), 2, 'Returning to an already analyzed source should reuse it');
  await worker.evaluate(async origin => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(origin));
    await chrome.tabs.sendMessage(tab.id, { type: 'retry-media' });
  }, origin);
  await ready();
  assert.equal(await analysisCount(), 3, 'Explicit Retry should create one shared analysis for both duplicates');
  console.log('PASS: concurrent and later duplicates share one analysis; source changes and explicit Retry are isolated.');
} finally {
  await browser?.close(); server.close();
  await rm(profile, { recursive: true, force: true });
}
