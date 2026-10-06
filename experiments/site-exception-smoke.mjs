import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const image = await readFile(resolve(root, 'tests/fixtures/bus.jpg'));
const video = await readFile(resolve(root, 'tests/fixtures/bus.mp4'));
const server = createServer((request, response) => {
  if (request.url === '/bus.jpg') { response.writeHead(200, { 'content-type': 'image/jpeg' }); response.end(image); return; }
  if (request.url === '/bus.mp4') { response.writeHead(200, { 'content-type': 'video/mp4' }); response.end(video); return; }
  response.writeHead(200, { 'content-type': 'text/html' });
  if (request.url === '/player') response.end('<video id="clip" width="640" height="360" muted autoplay loop playsinline preload="auto" src="/bus.mp4"></video>');
  else response.end(`<img id="bus" width="640" height="420" src="/bus.jpg"><iframe id="player" width="700" height="420" src="http://127.0.0.1:${server.address().port}/player"></iframe>`);
});
await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
const profile = await mkdtemp(resolve(tmpdir(), 'site-exception-smoke-'));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    viewport: { width: 1280, height: 1000 },
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`] });
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
  const popup = await browser.newPage();
  await popup.goto(new URL('popup.html', worker.url()).href);
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'set-settings', patch: {
    automaticGender: false, filter: 'both', siteExceptions: ['localhost'],
  } }));
  const page = await browser.newPage();
  await page.goto(`http://localhost:${server.address().port}/`);
  const player = page.frameLocator('#player');
  await player.locator('#clip').evaluate(video => video.play());
  await page.waitForTimeout(1500);
  const state = async () => ({
    image: await page.locator('#bus').evaluate(node => ({ pending: node.hasAttribute('data-local-media-censor-pending'),
      overlays: document.querySelectorAll('canvas[data-local-media-censor-for="bus"]').length })),
    video: await player.locator('#clip').evaluate(node => ({ pending: node.hasAttribute('data-local-media-censor-pending'),
      overlays: document.querySelectorAll('canvas[data-local-media-censor-for="clip"]').length,
      status: node.dataset.localMediaCensorStatus })),
  });
  const waitForState = async predicate => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const current = await state();
      if (predicate(current)) return current;
      await page.waitForTimeout(250);
    }
    throw new Error(`Site exception state timed out: ${JSON.stringify(await state())}`);
  };
  const excepted = await waitForState(current => !current.image.pending && !current.video.pending &&
    current.image.overlays === 0 && current.video.overlays === 0);
  console.log('top-level exception', excepted);
  if (excepted.image.pending || excepted.video.pending || excepted.video.overlays)
    throw new Error('Top-level exception did not release image and iframe video');
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'set-settings', patch: { siteExceptions: [] } }));
  const active = await waitForState(current => !current.image.pending && !current.video.pending &&
    current.image.overlays > 0 && current.video.overlays > 0);
  console.log('exception removed', active);
  await popup.evaluate(port => chrome.runtime.sendMessage({ type: 'set-settings', patch: {
    siteExceptions: [`http://localhost:${port}/watch`],
  } }), server.address().port);
  const reapplied = await waitForState(current => !current.image.pending && !current.video.pending &&
    current.image.overlays === 0 && current.video.overlays === 0);
  console.log('exception reapplied', reapplied);
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'set-settings', patch: {
    siteExceptions: ['127.0.0.1'],
  } }));
  const iframeHostOnly = await waitForState(current => !current.image.pending && !current.video.pending &&
    current.image.overlays > 0 && current.video.overlays > 0);
  console.log('iframe host excepted on a different site', iframeHostOnly);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
