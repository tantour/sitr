// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const photo = await readFile(resolve('tests/fixtures/bus.jpg'));
let square;
let mismatchVisits = 0;
const imageServer = createServer((request, response) => {
  if (request.url.includes('mismatch') && ++mismatchVisits > 1) {
    response.writeHead(200, { 'content-type': 'image/png', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    response.end(square); return;
  }
  response.writeHead(200, { 'content-type': 'image/jpeg', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
  response.end(photo);
});
await new Promise(done => imageServer.listen(0, '127.0.0.1', done));
const source = `http://127.0.0.1:${imageServer.address().port}/photo.jpg`;
const pageServer = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end(`<!doctype html><img id="density" width="220" srcset="${source}?density 2x">
    <img id="width" width="220" src="${source}" sizes="337px" srcset="${source}?width 810w">
    <picture><source sizes="333px" srcset="${source}?picture 810w"><img id="picture" width="220" src="${source}"></picture>
    <img id="mismatch" width="220" src="${source}?mismatch">`);
});
await new Promise(done => pageServer.listen(0, '127.0.0.1', done));
const profile = await mkdtemp(resolve(tmpdir(), 'responsive-image-probe-'));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    viewport: { width: 1200, height: 900 }, args: [`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`] });
  const page = await browser.newPage();
  square = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  await page.goto(`http://127.0.0.1:${pageServer.address().port}/`);
  await page.waitForFunction(() => [...document.images].every(image => image.dataset.localMediaCensorSequence ||
    image.dataset.localMediaCensorStatus?.startsWith('Fetched image differs')), undefined, { timeout: 45000 }).catch(error => {
      console.log(error.message);
    });
  const states = await page.evaluate(() => [...document.images].map(image => ({ id: image.id,
    natural: [image.naturalWidth, image.naturalHeight], status: image.dataset.localMediaCensorStatus,
    pending: image.hasAttribute('data-local-media-censor-pending'), sequence: image.dataset.localMediaCensorSequence })));
  console.log(states);
  if (states.filter(image => image.id !== 'mismatch').some(image => image.pending || !image.sequence)) throw new Error('Responsive image rejected before analysis');
  const mismatch = states.find(image => image.id === 'mismatch');
  if (!mismatch.pending || mismatch.sequence || mismatch.status !== 'Fetched image differs in aspect ratio') {
    throw new Error('An image with incompatible proportions was accepted');
  }
} finally {
  await browser?.close();
  pageServer.close(); imageServer.close();
  if (!resolve(profile).startsWith(`${resolve(tmpdir())}${sep}`)) throw new Error('Unsafe cleanup path');
  await rm(profile, { recursive: true, force: true });
}
