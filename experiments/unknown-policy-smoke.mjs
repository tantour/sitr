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
  response.end('<img id="bus" width="640" height="420" src="/bus.jpg"><video id="clip" width="640" height="360" muted loop playsinline preload="auto" src="/bus.mp4"></video>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(resolve(tmpdir(), 'unknown-policy-smoke-'));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`] });
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
  const popup = await browser.newPage();
  await popup.goto(new URL('popup.html', worker.url()).href);
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'set-settings', patch: {
    automaticGender: false, filter: 'both', imageCoverage: 'whole-body', videoPlayback: 'smooth',
  } }));
  await popup.locator('#imageUnknown').selectOption('selected');
  await popup.locator('#videoUnknown').selectOption('allow');
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('#clip').evaluate(video => video.play());
  const counts = async () => page.evaluate(() => {
    const count = id => {
      const canvas = document.querySelector(`canvas[data-local-media-censor-for="${id}"]`);
      if (!canvas || !canvas.width || !canvas.height) return null;
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let covered = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]) covered++;
      return covered;
    };
    return { image: count('bus'), video: count('clip') };
  });
  await page.waitForFunction(() => {
    const image = document.querySelector('#bus'), video = document.querySelector('#clip');
    return image?.dataset.localMediaCensorGender && video?.dataset.localMediaCensorGender &&
      !image.hasAttribute('data-local-media-censor-pending') && !video.hasAttribute('data-local-media-censor-pending');
  }, null, { timeout: 60_000 });
  let state = await counts();
  if (!(state.image > 0 && state.video === 0)) throw new Error(`Image censor/video show failed: ${JSON.stringify(state)}`);
  console.log('image censor, video show', state);
  await popup.locator('#imageUnknown').selectOption('allow');
  await popup.locator('#videoUnknown').selectOption('selected');
  await page.waitForFunction(() => {
    const count = id => {
      const canvas = document.querySelector(`canvas[data-local-media-censor-for="${id}"]`);
      if (!canvas?.width || !canvas?.height) return null;
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let covered = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]) covered++;
      return covered;
    };
    return count('bus') === 0 && count('clip') > 0;
  }, null, { timeout: 60_000 });
  state = await counts();
  console.log('image show, video censor', state);
  const saved = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'get-settings' }));
  if (saved.imageUnknown !== 'allow' || saved.videoUnknown !== 'selected') throw new Error('Separate choices did not persist');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
