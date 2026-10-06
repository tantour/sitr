// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const photo = await readFile(resolve('tests/fixtures/bus.jpg'));
const requests = new Map();
const imageServer = createServer((request, response) => {
  if (request.url?.startsWith('/photo')) {
    const visits = (requests.get(request.url) ?? 0) + 1;
    requests.set(request.url, visits);
    if (request.url.includes('hang') && visits > 1) return;
    response.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store',
      ...(request.url.includes('cors') ? { 'access-control-allow-origin': '*' } : {}) });
    response.end(photo);
  } else { response.writeHead(404); response.end(); }
});
await new Promise(done => imageServer.listen(0, '127.0.0.1', done));
const pageServer = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end(`<!doctype html><img id="hang1" width="320" height="210" src="http://127.0.0.1:${imageServer.address().port}/photo-hang1.jpg"><img id="hang2" width="320" height="210" src="http://127.0.0.1:${imageServer.address().port}/photo-hang2.jpg"><img id="cors" width="320" height="210" src="http://127.0.0.1:${imageServer.address().port}/photo-cors.jpg"><img id="cross" width="320" height="210" src="http://127.0.0.1:${imageServer.address().port}/photo.jpg">`);
});
await new Promise(done => pageServer.listen(0, '127.0.0.1', done));
const profile = await mkdtemp(resolve(tmpdir(), 'cross-origin-probe-'));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${pageServer.address().port}/`);
  await page.waitForFunction(() => !!document.querySelector('#cross')?.dataset.localMediaCensorSequence &&
    !!document.querySelector('#cors')?.dataset.localMediaCensorSequence,
    undefined, { timeout: 45000 });
  const results = await page.evaluate(() => [...document.images].map(image => ({ id: image.id, status: image.dataset.localMediaCensorStatus,
    pending: image.hasAttribute('data-local-media-censor-pending'), naturalWidth: image.naturalWidth,
    sequence: image.dataset.localMediaCensorSequence, acquire: image.dataset.localMediaCensorAcquireMs })));
  console.log(results);
  if (results.find(image => image.id === 'cross')?.pending || results.find(image => image.id === 'cors')?.pending) {
    throw new Error('Responsive cross-origin images remained blocked behind stalled fetches');
  }
} finally {
  await browser?.close();
  pageServer.close(); imageServer.close();
  await rm(profile, { recursive: true, force: true });
}
