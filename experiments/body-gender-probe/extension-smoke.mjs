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
  response.end('<img id="bus" width="640" height="420" src="/bus.jpg"><video id="clip" width="640" height="360" autoplay muted loop playsinline preload="auto" src="/bus.mp4"></video>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(resolve(tmpdir(), 'body-gender-extension-'));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    viewport: { width: 1280, height: 1200 },
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`] });
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
  const popupUrl = new URL('popup.html', worker.url()).href;
  const popup = await browser.newPage();
  await popup.goto(popupUrl);
  const imageCoverage = process.env.BODY_PROOF === '1' ? 'regions' : 'whole-body';
  await popup.locator('#imageCoverage').selectOption(imageCoverage);
  await popup.locator('#videoDetector').selectOption('fast-box');
  await popup.waitForFunction(async expected => {
    const saved = await chrome.runtime.sendMessage({ type: 'get-settings' });
    return saved.imageCoverage === expected && saved.videoDetector === 'fast-box';
  }, imageCoverage);
  const page = await browser.newPage();
  page.on('console', message => { if (message.type() === 'error') console.error('page console:', message.text()); });
  page.on('pageerror', error => console.error('page error:', error.message));
  const combinations = [
    ['body-paddle', 'body-intel'],
    ['body-intel', 'body-paddle'],
    ['face-paddle', 'face-intel'],
    ['face-intel', 'face-paddle'],
  ];
  for (const [imageMode, videoMode] of (process.env.MODE_INDEX ? [combinations[Number(process.env.MODE_INDEX)]] : combinations)) {
    await popup.locator('#imageGenderModel').selectOption(imageMode);
    await popup.locator('#videoGenderModel').selectOption(videoMode);
    await popup.waitForFunction(async ({ imageMode, videoMode }) => {
      const saved = await chrome.runtime.sendMessage({ type: 'get-settings' });
      return saved.imageGenderModel === imageMode && saved.videoGenderModel === videoMode;
    }, { imageMode, videoMode });
    const saved = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'get-settings' }));
    if (saved.imageGenderModel !== imageMode || saved.videoGenderModel !== videoMode)
      throw new Error('Gender model settings did not persist');
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('#clip').evaluate(video => video.play());
    try { await page.waitForFunction(() => {
      const image = document.querySelector('#bus');
      const video = document.querySelector('#clip');
      const imageGender = JSON.parse(image?.getAttribute('data-local-media-censor-gender') || 'null');
      const videoGender = JSON.parse(video?.getAttribute('data-local-media-censor-gender') || 'null');
      return imageGender?.attempted > 0 && videoGender?.attempted > 0 &&
        !imageGender.error && !videoGender.error;
    }, null, { timeout: 60_000 }); }
    catch (error) {
      console.log('Timed-out state:', await page.evaluate(() => {
        const image = document.querySelector('#bus'), video = document.querySelector('#clip');
        return { image: { status: image?.dataset.localMediaCensorStatus, gender: image?.dataset.localMediaCensorGender,
          error: image?.dataset.localMediaCensorLastError }, video: { status: video?.dataset.localMediaCensorStatus,
          gender: video?.dataset.localMediaCensorGender, error: video?.dataset.localMediaCensorLastError,
          playing: !video?.paused } };
      }));
      throw error;
    }
    const state = await page.evaluate(() => {
      const read = element => ({ status: element.getAttribute('data-local-media-censor-status'),
        gender: JSON.parse(element.getAttribute('data-local-media-censor-gender') || 'null'),
        timings: JSON.parse(element.getAttribute('data-local-media-censor-timings-ms') || 'null') });
      return { image: read(document.querySelector('#bus')), video: read(document.querySelector('#clip')) };
    });
    console.log(imageMode, videoMode, JSON.stringify({
      image: { ...state.image.gender, backend: state.image.timings?.genderBackend, genderMs: state.image.timings?.gender },
      video: { ...state.video.gender, backend: state.video.timings?.genderBackend, genderMs: state.video.timings?.gender },
    }));
    for (const [mode, stateItem] of [[imageMode, state.image], [videoMode, state.video]]) {
      if (stateItem.gender?.model !== mode) throw new Error(`Wrong model selected: ${mode}`);
      if (mode.startsWith('body-') && (stateItem.gender.faceGenderAttempts !== 0 ||
          stateItem.gender.bodyGenderAttempts < 1)) throw new Error(`Body-only mode used face gender: ${mode}`);
    }
    if (process.env.BODY_PROOF === '1' && (state.image.gender.faces !== 0 || state.video.gender.faces !== 0 ||
        state.image.gender.accepted < 1)) throw new Error('Body-only modes depended on face detection');
    if (process.env.VIDEO_ACCEPT === '1') {
      await page.waitForFunction(() => {
        const video = document.querySelector('#clip');
        const gender = JSON.parse(video?.getAttribute('data-local-media-censor-gender') || 'null');
        return gender?.accepted > 0;
      }, null, { timeout: 30_000 });
      console.log('video automatic label accepted');
    }
    if (process.env.LIVE_SWITCH === '1' || process.env.LIVE_SWITCH === '2') {
      await popup.locator('#imageGenderModel').selectOption('face');
      await popup.locator('#videoGenderModel').selectOption('face');
      await page.waitForFunction(() => {
        const image = document.querySelector('#bus');
        const video = document.querySelector('#clip');
        const imageGender = JSON.parse(image?.getAttribute('data-local-media-censor-gender') || 'null');
        const videoGender = JSON.parse(video?.getAttribute('data-local-media-censor-gender') || 'null');
        return imageGender?.faces > 0 && imageGender?.attempted > 0 &&
          videoGender?.faces > 0 && videoGender?.attempted > 0;
      }, null, { timeout: 60_000 });
      console.log('live switch to face passed');
      if (process.env.LIVE_SWITCH === '2') {
        await popup.locator('#imageGenderModel').selectOption(imageMode);
        await popup.locator('#videoGenderModel').selectOption(videoMode);
        await page.waitForFunction(({ imageMode, videoMode }) => {
          const image = JSON.parse(document.querySelector('#bus')?.getAttribute('data-local-media-censor-gender') || 'null');
          const video = JSON.parse(document.querySelector('#clip')?.getAttribute('data-local-media-censor-gender') || 'null');
          return image?.model === imageMode && video?.model === videoMode &&
            image.faceGenderAttempts === 0 && video.faceGenderAttempts === 0 &&
            image.bodyGenderAttempts > 0 && video.bodyGenderAttempts > 0;
        }, { imageMode, videoMode }, { timeout: 60_000 });
        console.log('live switch back to body-only passed');
      }
    }
  }
} finally {
  await browser?.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
