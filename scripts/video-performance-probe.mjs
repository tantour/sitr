// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd(), video = await readFile('tests/fixtures/bus-long.mp4');
const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': request.url === '/video.mp4' ? 'video/mp4' : 'text/html' });
  response.end(request.url === '/video.mp4' ? video :
    '<!doctype html><video id="clip" width="640" height="480" autoplay muted loop playsinline src="/video.mp4"></video>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const profile = await mkdtemp(resolve(tmpdir(), 'sitr-video-performance-'));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const started = Date.now();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => {
    const video = document.getElementById('clip');
    return video.dataset.localMediaCensorSequence && !video.hasAttribute('data-local-media-censor-pending');
  }, null, { timeout: 60000 });
  const startupMs = Date.now() - started;
  const result = await page.evaluate(() => new Promise(resolve => {
    const video = document.getElementById('clip'), samples = [];
    const startSequence = Number(video.dataset.localMediaCensorSequence), startFrames = video.getVideoPlaybackQuality().totalVideoFrames;
    const timer = setInterval(() => {
      samples.push({ protected: video.hasAttribute('data-local-media-censor-pending'),
        timings: JSON.parse(video.dataset.localMediaCensorTimingsMs || '{}'),
        gender: JSON.parse(video.dataset.localMediaCensorGender || '{}'),
        sequence: Number(video.dataset.localMediaCensorSequence), age: Number(video.dataset.localMediaCensorLatencyMs) });
      if (samples.length < 100) return;
      clearInterval(timer);
      const latencies = samples.map(sample => sample.age).sort((a, b) => a - b);
      resolve({ analyzedFrames: samples.at(-1).sequence - startSequence,
        presentedFrames: video.getVideoPlaybackQuality().totalVideoFrames - startFrames,
        visibleSamples: samples.filter(sample => !sample.protected).length,
        p95ResultAgeMs: latencies[95],
        faceFilteringObserved: samples.some(sample => sample.gender.faceGenderAttempts > 0),
        genderErrors: samples.flatMap(sample => sample.gender.error ? [sample.gender.error] : []),
        lastTimings: samples.at(-1).timings });
    }, 100);
  }));
  assert.deepEqual(errors, []);
  assert.deepEqual(result.genderErrors, []);
  assert(result.analyzedFrames > 0 && result.presentedFrames > 0);
  assert(result.faceFilteringObserved, 'Default automatic face filtering must remain active');
  console.log(JSON.stringify({ startupMs, ...result }));
} finally { await browser?.close(); server.close(); await rm(profile, { recursive: true, force: true }); }
