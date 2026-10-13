// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

// A local fixture at the Meet origin, with genuine loopback WebRTC streams.
// No Google account, camera, microphone, or meeting is accessed.
const photo = await readFile('tests/fixtures/bus.jpg');
const profile = await mkdtemp(resolve(tmpdir(), 'sitr-meet-'));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    viewport: { width: 1200, height: 900 },
    args: [`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`,
      '--allow-loopback-in-peer-connection', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  await worker.evaluate(async () => {
    let settings;
    for (let attempt = 0; attempt < 100; attempt++) {
      settings = (await chrome.storage.local.get('settings')).settings;
      if (settings?.schemaVersion) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!settings?.schemaVersion) throw new Error('Settings did not initialize');
    await chrome.storage.local.set({ settings: { ...settings, enabled: true, images: false, videos: true,
      automaticGender: false, filter: 'both', videoDetector: 'fast-box', videoPlayback: 'smooth',
      onnxThreads: 1, siteExceptions: [], revision: 100 } });
  });
  const page = await browser.newPage(), errors = [];
  page.on('console', message => { if (message.text().startsWith('Meet fixture:')) console.log(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://meet.google.com/**', route => route.fulfill({ contentType: 'text/html', body:
    '<!doctype html><style>body{margin:20px}section{position:relative;display:inline-block;margin:8px}video{display:block;width:360px;height:240px;object-fit:contain}</style><body></body>' }));
  await page.goto('https://meet.google.com/sitr-test');
  console.log('Meet fixture: extension initialized');
  await page.evaluate(async photo => {
    const image = new Image(); image.src = photo; await image.decode();
    const sender = new RTCPeerConnection(), receiver = new RTCPeerConnection();
    window.peers = [sender, receiver]; window.tiles = {}; window.sources = [];
    const streamTiles = new Map();
    receiver.ontrack = event => {
      const video = streamTiles.get(event.streams[0].id);
      video.srcObject = event.streams[0]; void video.play();
    };
    for (const id of ['camera-1', 'camera-2', 'camera-3', 'presentation']) {
      const tile = document.createElement('section');
      const label = document.createElement('div'); label.textContent = id;
      const video = document.createElement('video'); video.id = id; video.muted = true; video.autoplay = true; video.playsInline = true;
      tile.append(label, video); document.body.append(tile); window.tiles[id] = video;
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext('2d');
      const draw = () => {
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 640, 480);
        ctx.drawImage(image, 0, 0, 640, 480);
        ctx.fillStyle = '#fff'; ctx.fillRect(Math.floor(Date.now() / 100) % 30, 0, 20, 10);
        if (id === 'presentation') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 640, 32); ctx.fillStyle = '#000'; ctx.font = '20px sans-serif'; ctx.fillText('Shared slides with people', 10, 24); }
      };
      draw(); const timer = setInterval(draw, 100);
      const stream = canvas.captureStream(10);
      window.sources.push({ stream, timer, canvas, draw });
      streamTiles.set(stream.id, video);
      sender.addTrack(stream.getVideoTracks()[0], stream);
    }
    const gather = peer => peer.iceGatheringState === 'complete' ? Promise.resolve() : new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Loopback ICE gathering timed out')), 15000);
      const listener = () => { if (peer.iceGatheringState === 'complete') { peer.removeEventListener('icegatheringstatechange', listener); resolve(); } };
      peer.addEventListener('icegatheringstatechange', listener);
      peer.addEventListener('icegatheringstatechange', () => { if (peer.iceGatheringState === 'complete') clearTimeout(timer); });
    });
    console.log('Meet fixture: negotiating streams');
    await sender.setLocalDescription(await sender.createOffer()); await gather(sender);
    await receiver.setRemoteDescription(sender.localDescription);
    await receiver.setLocalDescription(await receiver.createAnswer()); await gather(receiver);
    await sender.setRemoteDescription(receiver.localDescription);
    console.log('Meet fixture: streams negotiated');
  }, `data:image/jpeg;base64,${photo.toString('base64')}`);
  await page.waitForFunction(() => window.peers.every(peer => peer.connectionState === 'connected'), null, { timeout: 15000 })
    .catch(async error => {
      console.log(await page.evaluate(() => window.peers.map(peer => ({ state: peer.connectionState,
        ice: peer.iceConnectionState, candidates: peer.localDescription?.sdp.split('\r\n').filter(line => line.startsWith('a=candidate:')) }))));
      throw error;
    });

  const allAnalyzed = () => Object.values(window.tiles).every(video => {
    const mask = video.nextElementSibling;
    return video.dataset.localMediaCensorSequence && !video.hasAttribute('data-local-media-censor-pending') &&
      mask?.matches('canvas[data-local-media-censor-overlay]') &&
      mask.getContext('2d').getImageData(0, 0, mask.width, mask.height).data.some((value, index) => index % 4 === 3 && value > 0);
  });
  await page.waitForFunction(allAnalyzed, null, { timeout: 90000 }).catch(async error => {
    console.log(await page.evaluate(() => Object.values(window.tiles).map(video => ({ id: video.id, ready: video.readyState, data: { ...video.dataset } }))));
    throw error;
  });
  assert(await page.evaluate(() => window.peers.every(peer => peer.connectionState === 'connected')));
  assert(await page.evaluate(() => Object.values(window.tiles).every(video => video.srcObject && !video.currentSrc && !video.hasAttribute('crossorigin'))));
  const presentationMask = await page.evaluate(() => {
    const video = window.tiles.presentation, mask = video.nextElementSibling;
    const a = video.getBoundingClientRect(), b = mask.getBoundingClientRect();
    const pixels = mask.getContext('2d').getImageData(0, 0, mask.width, mask.height).data;
    const covered = pixels.filter((value, i) => i % 4 === 3 && value > 0).length;
    return { fraction: covered / (mask.width * mask.height),
      aligned: Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1 };
  });
  assert(presentationMask.aligned, 'Presentation overlay is misplaced');
  assert(presentationMask.fraction > 0.01 && presentationMask.fraction < 0.75, 'Presentation should cover people while retaining surrounding content');

  const before = await page.evaluate(() => Object.values(window.tiles).map(video => Number(video.dataset.localMediaCensorCaptureSequence)));
  await page.waitForFunction(before => Object.values(window.tiles).every((video, i) => Number(video.dataset.localMediaCensorCaptureSequence) > before[i] + 1), before, { timeout: 30000 });

  // A paused, already analyzed tile must not starve the other three streams.
  await page.evaluate(() => window.tiles['camera-1'].pause());
  const playing = await page.evaluate(() => Object.values(window.tiles).slice(1).map(video => Number(video.dataset.localMediaCensorCaptureSequence)));
  await page.waitForFunction(before => Object.values(window.tiles).slice(1).every((video, i) => Number(video.dataset.localMediaCensorCaptureSequence) > before[i] + 1), playing, { timeout: 30000 });

  // Reuse a tile without changing src attributes; the watchdog must retire it.
  await page.evaluate(() => {
    const video = window.tiles['camera-1'];
    video.dataset.localMediaCensorResetReason = 'test-sentinel';
    video.srcObject = new MediaStream([window.tiles['camera-2'].srcObject.getVideoTracks()[0].clone()]);
  });
  await page.waitForFunction(() => window.tiles['camera-1'].dataset.localMediaCensorResetReason === 'source-change');
  await page.evaluate(() => window.tiles['camera-1'].play());
  await page.waitForFunction(allAnalyzed, null, { timeout: 30000 });

  // Track changes within the same stream also reset temporary masks/labels.
  await page.evaluate(() => {
    const video = window.tiles['camera-1'], stream = video.srcObject;
    video.dataset.localMediaCensorResetReason = 'test-sentinel';
    stream.removeTrack(stream.getVideoTracks()[0]);
    stream.addTrack(window.tiles['camera-3'].srcObject.getVideoTracks()[0].clone());
  });
  await page.waitForFunction(() => window.tiles['camera-1'].dataset.localMediaCensorResetReason === 'source-change');
  await page.waitForFunction(allAnalyzed, null, { timeout: 30000 });

  // Ended streams must not keep an old revealed frame.
  await page.evaluate(() => window.tiles['camera-1'].srcObject.getVideoTracks().forEach(track => track.stop()));
  await page.waitForFunction(() => window.tiles['camera-1'].hasAttribute('data-local-media-censor-pending') &&
    window.tiles['camera-1'].dataset.localMediaCensorStatus === 'stream-ended');

  // Hidden tiles and a completed tile leave the rotating work set.
  await page.evaluate(() => { window.tiles['camera-2'].parentElement.style.display = 'none'; });
  const visible = await page.evaluate(() => ['camera-3', 'presentation'].map(id => Number(window.tiles[id].dataset.localMediaCensorCaptureSequence)));
  await page.waitForFunction(before => ['camera-3', 'presentation'].every((id, i) => Number(window.tiles[id].dataset.localMediaCensorCaptureSequence) > before[i] + 1), visible, { timeout: 30000 });
  await page.evaluate(() => { window.tiles['camera-2'].parentElement.style.display = ''; });
  await page.waitForFunction(() => !window.tiles['camera-2'].hasAttribute('data-local-media-censor-pending'), null, { timeout: 30000 });

  // Static presentation frames still receive fresh analyses without callbacks.
  await page.evaluate(() => { const source = window.sources[3]; clearInterval(source.timer); });
  const presentation = await page.evaluate(() => Number(window.tiles.presentation.dataset.localMediaCensorCaptureSequence));
  await page.waitForFunction(before => Number(window.tiles.presentation.dataset.localMediaCensorCaptureSequence) > before + 1, presentation, { timeout: 30000 });

  await worker.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, siteExceptions: ['meet.google.com'], revision: settings.revision + 1 } });
  });
  await page.waitForFunction(() => Object.values(window.tiles).every(video => !video.hasAttribute('data-local-media-censor-pending') &&
    !video.nextElementSibling?.matches('canvas[data-local-media-censor-overlay]')));
  assert(await page.evaluate(() => window.peers.every(peer => peer.connectionState === 'connected')));
  assert.deepEqual(errors, []);
  console.log('PASS: four WebRTC Meet tiles, shared screen, fair refresh, paused/hidden tiles, stream/track replacement, ended/static streams, and site pause.');
} finally {
  await browser?.close();
  assert(profile.startsWith(resolve(tmpdir()) + sep));
  await rm(profile, { recursive: true, force: true });
}
