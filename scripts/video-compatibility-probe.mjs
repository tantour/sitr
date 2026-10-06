// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const clip = await readFile('tests/fixtures/bus-long.mp4');
const requests = [];
const mediaServer = createServer((request, response) => {
  requests.push({ url: request.url, origin: request.headers.origin });
  const cors = request.url.startsWith('/cors');
  const headers = { 'content-type': 'video/mp4', 'accept-ranges': 'bytes',
    ...(cors ? { 'access-control-allow-origin': '*' } : {}) };
  const range = request.headers.range?.match(/bytes=(\d+)-(\d*)/);
  if (range) {
    const start = Number(range[1]), end = Math.min(Number(range[2] || clip.length - 1), clip.length - 1);
    response.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${clip.length}`,
      'content-length': end - start + 1 });
    response.end(clip.subarray(start, end + 1));
  } else { response.writeHead(200, headers); response.end(clip); }
});
await new Promise(done => mediaServer.listen(0, '127.0.0.1', done));
const mediaUrl = `http://127.0.0.1:${mediaServer.address().port}`;
const pageServer = createServer((request, response) => {
  response.writeHead(200, { 'content-type': request.url.startsWith('/clip') ? 'video/mp4' : 'text/html' });
  response.end(request.url.startsWith('/clip') ? clip : '<!doctype html><body><div id="late"></div></body>');
});
await new Promise(done => pageServer.listen(0, '127.0.0.1', done));
const profile = await mkdtemp(resolve(tmpdir(), 'sitr-video-compatibility-'));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    viewport: { width: 1200, height: 900 },
    args: [`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`] });
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  await worker.evaluate(async () => {
    // Wait for onInstalled's initial settings write before applying fixture settings.
    let settings;
    for (let attempt = 0; attempt < 100; attempt++) {
      settings = (await chrome.storage.local.get('settings')).settings;
      if (settings?.schemaVersion) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!settings?.schemaVersion) throw new Error('Extension settings did not initialize');
    await chrome.storage.local.set({ settings: { ...settings, enabled: true, images: false, videos: true,
      automaticGender: false, filter: 'both', videoDetector: 'fast-box', onnxThreads: 1, revision: 100 } });
  });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${pageServer.address().port}/`);
  await page.evaluate(async mediaUrl => {
    window.testVideos = {};
    window.testHosts = {};
    const addVideo = (root, id, url) => {
      const style = document.createElement('style');
      style.textContent = ':host{display:inline-block} video{display:block;width:200px;height:150px}';
      root.append(style);
      const video = document.createElement('video');
      video.id = id; video.muted = true; video.preload = 'auto'; video.src = url;
      root.append(video); window.testVideos[id] = video;
      return video;
    };
    const open = document.createElement('test-player');
    addVideo(open.attachShadow({ mode: 'open' }), 'open', '/clip.mp4');
    document.body.append(open); window.testHosts.open = open;
    const closed = document.createElement('test-player');
    const outer = closed.attachShadow({ mode: 'closed' });
    const nested = document.createElement('test-player'); outer.append(nested);
    addVideo(nested.attachShadow({ mode: 'closed' }), 'closed', '/clip.mp4');
    document.body.append(closed); window.testHosts.closed = closed;
    // First load without crossorigin, at a nonzero paused position, like a CDN preview.
    const cors = document.createElement('video'); cors.id = 'cors'; cors.muted = true;
    cors.style.cssText = 'width:200px;height:150px'; cors.src = `${mediaUrl}/cors.mp4`;
    await new Promise(resolve => cors.addEventListener('loadeddata', resolve, { once: true }));
    cors.currentTime = 1.2;
    await new Promise(resolve => cors.addEventListener('seeked', resolve, { once: true }));
    window.testVideos.cors = cors; document.body.append(cors);
    const unreadable = document.createElement('video'); unreadable.id = 'unreadable'; unreadable.muted = true;
    unreadable.style.cssText = 'width:200px;height:150px'; unreadable.src = `${mediaUrl}/no-cors.mp4`;
    window.testVideos.unreadable = unreadable; document.body.append(unreadable);
    // This host was already present when the content script inspected the page.
    window.addLateVideo = () => addVideo(document.querySelector('#late').attachShadow({ mode: 'open' }), 'late', '/clip.mp4');
  }, mediaUrl);
  await page.evaluate(() => window.addLateVideo());
  await page.waitForFunction(() => ['open', 'closed', 'late', 'cors'].every(id => {
    const video = window.testVideos[id];
    return video.dataset.localMediaCensorSequence && !video.hasAttribute('data-local-media-censor-pending') &&
      video.nextElementSibling?.matches('canvas[data-local-media-censor-overlay]');
  }), null, { timeout: 60000 }).catch(async error => {
    console.log(await page.evaluate(() => Object.entries(window.testVideos).map(([id, video]) => ({
      id, data: { ...video.dataset }, ready: video.readyState, cors: video.crossOrigin,
      source: video.currentSrc, next: video.nextElementSibling?.outerHTML.slice(0, 200),
    }))));
    console.log({ errors });
    throw error;
  });
  const results = await page.evaluate(() => Object.entries(window.testVideos).map(([id, video]) => {
    const canvas = video.nextElementSibling;
    const a = video.getBoundingClientRect(), b = canvas?.getBoundingClientRect();
    const pixels = canvas instanceof HTMLCanvasElement ? canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data : [];
    return { id, protected: video.hasAttribute('data-local-media-censor-pending'), status: video.dataset.localMediaCensorStatus,
      access: video.dataset.localMediaCensorCaptureAccess, cors: video.crossOrigin, time: video.currentTime, paused: video.paused,
      analyzed: Boolean(video.dataset.localMediaCensorSequence),
      aligned: b && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.width - b.width) < 1,
      maskDrawn: Array.from(pixels).some((value, index) => index % 4 === 3 && value > 0),
      display: canvas && getComputedStyle(canvas).display };
  }));
  console.log(JSON.stringify({ results, errors }));
  assert.deepEqual(errors, []);
  for (const id of ['open', 'closed', 'late', 'cors']) {
    const result = results.find(item => item.id === id);
    assert(result.analyzed && !result.protected, `${id}: video was not analyzed`);
    assert(result.aligned && result.maskDrawn && result.display !== 'none', `${id}: mask missing or misplaced`);
  }
  const cors = results.find(item => item.id === 'cors');
  assert.equal(cors.cors, 'anonymous'); assert.equal(cors.access, 'cors');
  assert(cors.paused && Math.abs(cors.time - 1.2) < 0.1, 'CORS recovery lost paused playback position');
  const unsupported = results.find(item => item.id === 'unreadable');
  assert(unsupported.protected && !unsupported.analyzed, 'Unreadable video was exposed');
  assert.equal(unsupported.cors, null, 'Failed CORS preflight changed the player');
  assert(requests.some(request => request.url === '/cors.mp4' && request.origin), 'No CORS retry request');

  // Repeat recovery while playing, using a <source> child and nondefault speed.
  await page.evaluate(async mediaUrl => {
    const video = document.createElement('video'); video.muted = true; video.loop = true;
    video.style.cssText = 'width:200px;height:150px';
    const source = document.createElement('source'); source.src = `${mediaUrl}/cors-playing.mp4`;
    video.append(source); video.load();
    await new Promise(resolve => video.addEventListener('loadeddata', resolve, { once: true }));
    video.playbackRate = 1.25; await video.play();
    window.testVideos.playing = video; document.body.append(video);
  }, mediaUrl);
  await page.waitForFunction(() => {
    const video = window.testVideos.playing;
    return video.crossOrigin === 'anonymous' && !video.paused && video.dataset.localMediaCensorSequence &&
      !video.hasAttribute('data-local-media-censor-pending');
  }, null, { timeout: 30000 });
  assert.equal(await page.evaluate(() => window.testVideos.playing.playbackRate), 1.25);
  await page.evaluate(() => window.testVideos.playing.pause());

  // Source changes inside the closed root must retire the old result.
  await page.evaluate(() => { window.testVideos.closed.src = '/clip.mp4?replacement'; });
  await page.waitForFunction(() => {
    const video = window.testVideos.closed;
    return video.currentSrc.endsWith('?replacement') && !video.hasAttribute('data-local-media-censor-pending');
  }, null, { timeout: 30000 });
  await page.evaluate(() => { window.testHosts.closed.remove(); });
  await page.waitForFunction(() => !window.testVideos.closed.hasAttribute('data-local-media-censor-pending') &&
    !window.testVideos.closed.nextElementSibling?.matches('canvas[data-local-media-censor-overlay]'));
  await page.evaluate(() => { document.body.append(window.testHosts.closed); });
  await page.waitForFunction(() => window.testVideos.closed.nextElementSibling?.matches('canvas[data-local-media-censor-overlay]') &&
    !window.testVideos.closed.hasAttribute('data-local-media-censor-pending'), null, { timeout: 30000 });
  await worker.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, videos: false, revision: settings.revision + 1 } });
  });
  await page.waitForFunction(() => Object.values(window.testVideos).every(video =>
    !video.hasAttribute('data-local-media-censor-pending') && getComputedStyle(video).filter !== 'brightness(0)'));
  console.log('PASS: shadow players, delayed roots, masks, paused/playing CORS recovery, source replacement, removal/reinsertion, and disabling');
} finally {
  await browser?.close(); pageServer.close(); mediaServer.close();
  // mkdtemp creates this exact disposable profile under the OS temp directory.
  assert(profile.startsWith(resolve(tmpdir()) + '\\') || profile.startsWith(resolve(tmpdir()) + '/'));
  await rm(profile, { recursive: true, force: true });
}
