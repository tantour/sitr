// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { chromium } from 'playwright';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const profile = await mkdtemp(resolve(tmpdir(), 'yolo-probe-'));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`] });
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
  const page = await browser.newPage();
  if (process.env.YOLO_DISABLE_GPU === '1') await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { value: undefined });
  });
  page.on('console', msg => console.log(msg.text()));
  await page.goto(new URL('popup.html', worker.url()).href);
  const result = await page.evaluate(async ({ base64, backend, threads, count, size, verify }) => {
    const adapter = await navigator.gpu?.requestAdapter();
    console.log(JSON.stringify({ adapter: adapter && { vendor: adapter.info.vendor, architecture: adapter.info.architecture,
      device: adapter.info.device, description: adapter.info.description }, isolated: crossOriginIsolated }));
    const { YoloPersonSegmenter } = await import(chrome.runtime.getURL('person-runtime.js'));
    const model = new YoloPersonSegmenter(size, backend, threads);
    await model.initialize();
    console.log('YOLO initialized: ' + model.getBackend());
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))]));
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, size, size); bitmap.close();
    const rgba = new Uint8Array(ctx.getImageData(0, 0, size, size).data);
    const timings = [];
    let detections;
    for (let i = 0; i < count + 2; i++) {
      detections = await model.segment(rgba);
      if (i >= 2) timings.push(model.getLastTimings());
    }
    if (verify) {
      if (model.getBackend() !== 'webgpu') throw new Error('GPU verification fell back to WASM');
      const reference = new YoloPersonSegmenter(size, 'wasm', threads);
      await reference.initialize();
      try {
        // Changing inputs catches accidentally replaying stale captured buffers.
        for (const frame of [rgba, new Uint8Array(rgba.length), rgba]) {
          const expected = await reference.segment(frame);
          const actual = await model.segment(frame);
          if (actual.length !== expected.length) throw new Error('GPU/CPU detection count mismatch');
          for (let i = 0; i < actual.length; i++) {
            for (const key of ['x', 'y', 'width', 'height']) if (Math.abs(actual[i].box[key] - expected[i].box[key]) > 0.001) throw new Error('GPU/CPU box mismatch');
            if (Math.abs(actual[i].score - expected[i].score) > 0.001) throw new Error('GPU/CPU score mismatch');
            for (let p = 0; p < actual[i].mask.length; p++) if (Math.abs(actual[i].mask[p] - expected[i].mask[p]) > 0.01) throw new Error('GPU/CPU mask mismatch');
          }
        }
      } finally { await reference.dispose(); }
    }
    await model.dispose();
    return { backend: model.getBackend(), size, threads, verified: verify, timings, detections: detections.map(d => ({ box: d.box, score: d.score,
      maskSum: d.mask.reduce((a, b) => a + b, 0) })) };
  }, { base64: (await readFile('tests/fixtures/bus.jpg')).toString('base64'), backend: process.env.YOLO_BACKEND || 'wasm',
    threads: Number(process.env.YOLO_THREADS || 2), count: Number(process.env.YOLO_COUNT || 10), size: Number(process.env.YOLO_SIZE || 320), verify: process.env.YOLO_VERIFY === '1' });
  console.log(JSON.stringify(result));
  if (process.env.YOLO_DISABLE_GPU === '1' && result.backend !== 'wasm') throw new Error('Expected CPU fallback with WebGPU disabled');
} finally { await browser?.close(); await rm(profile, { recursive: true, force: true }); }
