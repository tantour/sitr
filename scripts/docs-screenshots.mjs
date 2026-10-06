// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root } from './models.mjs';
if (!process.argv.includes('--reuse-ui')) {
  const check = spawnSync(process.execPath, ['scripts/popup-ux-check.mjs'], { cwd: root, stdio: 'inherit' });
  assert.equal(check.status, 0, 'UI checks must pass before publishing screenshots');
}
await mkdir(resolve(root, 'docs/images'), { recursive: true });
for (const name of ['popup.png', 'popup-en-dark.png', 'popup-ar-light.png', 'settings-desktop.png'])
  await cp(resolve(root, '.impeccable/review', name), resolve(root, 'docs/images', name));
const photo = await readFile(resolve(root, 'tests/fixtures/bus.jpg'));
const server = createServer((request, response) => {
  if (request.url === '/bus.jpg') { response.writeHead(200, { 'content-type': 'image/jpeg' }); response.end(photo); return; }
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Sitr coverage example</title><body style="margin:0;padding:28px;background:#eef3ee;font:16px system-ui;color:#243b2d"><h1 style="font-size:24px;margin:0 0 8px">Local whole-person coverage</h1><p style="margin:0 0 22px">Everyone selected · black silhouettes including faces</p><img id="example" src="/bus.jpg" width="480" height="640" style="display:block"><p style="font-size:12px;margin-bottom:0">Local Ultralytics bus fixture · illustration of rendering, not an accuracy benchmark.</p></body></html>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const profile = await mkdtemp(resolve(tmpdir(), 'sitr-docs-'));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    viewport: { width: 850, height: 800 }, args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`] });
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
  const page = await browser.newPage();
  await page.goto(new URL('popup.html', worker.url()).href);
  await page.waitForFunction(() => !document.body.classList.contains('loading'));
  await page.evaluate(async () => {
    const result = await chrome.runtime.sendMessage({ type: 'set-settings', patch: {
      filter: 'both', imageCoverage: 'whole-body-face', imageWholeBodyEffect: 'black', automaticGender: false } });
    if (result.error) throw new Error(result.error);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => {
    const image = document.querySelector('#example');
    const canvas = document.querySelector('canvas[data-local-media-censor-for="example"]');
    if (image.hasAttribute('data-local-media-censor-pending') || !canvas) return false;
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i]) return true;
    return false;
  }, null, { timeout: 90000 });
  await page.screenshot({ path: resolve(root, 'docs/images/coverage-example.png'), animations: 'disabled' });
  console.log('Saved README screenshots.');
} finally {
  await browser?.close();
  server.close();
  assert(profile.startsWith(resolve(tmpdir())));
  await rm(profile, { recursive: true, force: true });
}
