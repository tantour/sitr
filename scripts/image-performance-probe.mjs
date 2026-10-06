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
  response.end(request.url === '/photo.jpg' ? photo : '<!doctype html><img id="first" width="320" src="/photo.jpg">');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const profile = await mkdtemp(resolve(tmpdir(), 'image-performance-'));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const waitImage = id => page.waitForFunction(id => {
    const image = document.getElementById(id);
    return image?.dataset.localMediaCensorSequence && !image.hasAttribute('data-local-media-censor-pending');
  }, id, { timeout: 60000 });
  await waitImage('first');
  const initial = await page.locator('#first').evaluate(image => image.dataset.localMediaCensorTimingsMs);
  const worker = browser.serviceWorkers()[0];
  // This used to reset every image and discard inference cache entries because
  // the settings revision changed, even though only the video model changed.
  await worker.evaluate(async () => {
    const current = (await chrome.storage.local.get('settings')).settings;
    await chrome.storage.local.set({ settings: { ...current, videoGenderModel: 'body-paddle',
      filter: 'off', revision: current.revision + 1 } });
  });
  await page.waitForFunction(() => document.getElementById('first').dataset.localMediaCensorStatus === 'off');
  assert.equal(await page.locator('#first').evaluate(image => image.dataset.localMediaCensorTimingsMs), initial,
    'Video/render changes should not run image models again');
  await page.evaluate(() => {
    const image = document.createElement('img'); image.id = 'duplicate'; image.width = 320;
    image.src = '/photo.jpg'; document.body.append(image);
  });
  await waitImage('duplicate');
  const timings = await page.locator('#duplicate').evaluate(image => JSON.parse(image.dataset.localMediaCensorTimingsMs));
  assert.equal(timings.backend, 'cache');
  assert.equal(timings.personRun, 0);
  assert.equal(timings.semanticRun, 0);
  console.log(JSON.stringify({ settingsReused: true, duplicateTimings: timings }, null, 2));
} finally {
  await browser?.close(); server.close();
  await rm(profile, { recursive: true, force: true });
}
