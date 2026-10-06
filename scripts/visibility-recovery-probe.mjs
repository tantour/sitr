// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const photo = await readFile(resolve('tests/fixtures/bus.jpg'));
const server = createServer((request, response) => {
  if (request.url === '/photo.jpg') {
    response.writeHead(200, { 'content-type': 'image/jpeg' });
    response.end(photo);
  } else {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<img id="visible" width="640" height="420" src="/photo.jpg"><div style="height:2200px"></div><img id="below" width="640" height="420" src="/photo.jpg">');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const root = await mkdtemp(resolve(tmpdir(), 'visibility-recovery-'));
const extension = resolve(root, 'extension');
let browser;
try {
  await cp(resolve('dist'), extension, { recursive: true });
  const manifestPath = resolve(extension, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.content_scripts[0].js.unshift('silent-observer.js');
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(resolve(extension, 'silent-observer.js'), 'globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };');
  browser = await chromium.launchPersistentContext(resolve(root, 'profile'), { headless: true, channel: 'chromium',
    viewport: { width: 900, height: 700 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => !!document.querySelector('#visible')?.dataset.localMediaCensorSequence, undefined, { timeout: 45000 });
  const state = await page.evaluate(() => [...document.images].map(image => ({ id: image.id,
    status: image.dataset.localMediaCensorStatus, pending: image.hasAttribute('data-local-media-censor-pending'),
    sequence: image.dataset.localMediaCensorSequence })));
  console.log(state);
  if (state.find(image => image.id === 'visible')?.pending || state.find(image => image.id === 'below')?.sequence) {
    throw new Error('Visibility recovery failed or analyzed an off-screen image');
  }
} finally {
  await browser?.close();
  server.close();
  if (!resolve(root).startsWith(`${resolve(tmpdir())}${sep}`)) throw new Error('Unsafe test cleanup path');
  await rm(root, { recursive: true, force: true });
}
