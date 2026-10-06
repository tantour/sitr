// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const clip = await readFile(resolve(root, 'tests/fixtures/bus.mp4'));
const server = createServer((request, response) => {
  if (request.url === '/bus.mp4') { response.writeHead(200, { 'content-type': 'video/mp4' }); response.end(clip); return; }
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end('<video id="clip" muted autoplay loop playsinline width="640" height="360" src="/bus.mp4"></video>');
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const profile = await mkdtemp(resolve(tmpdir(), 'motion-probe-'));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`] });
  if (process.env.MOTION_COVERAGE === '1') {
    const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
    await worker.evaluate(async () => {
      const current = (await chrome.storage.local.get('settings')).settings || {};
      await chrome.storage.local.set({ settings: { ...current, filter: 'both', automaticGender: false,
        bodySkin: true, revision: (current.revision || 0) + 1 } });
    });
  }
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  if (process.env.MOTION_COVERAGE === '1') await page.waitForFunction(() =>
    document.querySelector('#clip')?.dataset.localMediaCensorSequence &&
    document.querySelector('canvas[data-local-media-censor-overlay]'), null, { timeout: 60000 });
  else await page.waitForTimeout(3000);
  const host = page.frames().find(frame => frame.url().endsWith('/motion.html'));
  console.log(JSON.stringify({ host: host ? await host.evaluate(() => ({ ...document.body.dataset })) : null,
    video: await page.locator('#clip').evaluate(video => ({ ...video.dataset })), errors }, null, 2));
  if (process.env.MOTION_COVERAGE === '1') {
    const coverage = await page.evaluate(() => {
      const canvas = document.querySelector('canvas[data-local-media-censor-overlay]');
      const pixels = canvas?.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
      if (!pixels) throw new Error('Video overlay unavailable');
      let covered = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) covered++;
      return { covered, total: pixels.length / 4 };
    });
    console.log(JSON.stringify({ coverage }));
    if (coverage.covered < coverage.total * 0.02) throw new Error('Selected video people were not shielded');
  }
} finally {
  await browser?.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
