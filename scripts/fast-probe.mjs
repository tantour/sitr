// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { chromium } from 'playwright';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const profile = await mkdtemp(resolve(tmpdir(), 'fast-person-probe-'));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`] });
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
  const page = await browser.newPage();
  await page.goto(new URL('popup.html', worker.url()).href);
  const result = await page.evaluate(async base64 => {
    const { FastPersonDetector } = await import(chrome.runtime.getURL('person-runtime.js'));
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))]));
    const canvas = new OffscreenCanvas(256, 256);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, 256, 256); bitmap.close();
    const bus = new Uint8Array(ctx.getImageData(0, 0, 256, 256).data);
    const blank = new Uint8Array(bus.length);
    const gpu = new FastPersonDetector('webgpu', 2), cpu = new FastPersonDetector('wasm', 2);
    await gpu.initialize(); await cpu.initialize();
    try {
      if (gpu.getBackend() !== 'webgpu-fast-box') throw new Error('Fast detector did not use WebGPU');
      const checks = [];
      for (const rgba of [bus, blank, bus]) {
        const actual = (await gpu.segment(rgba)).filter(item => item.score >= .25);
        const expected = (await cpu.segment(rgba)).filter(item => item.score >= .25);
        if (actual.length !== expected.length) throw new Error(`GPU/CPU person count mismatch ${actual.length}/${expected.length}`);
        for (let i = 0; i < actual.length; i++) for (const field of ['x', 'y', 'width', 'height']) {
          if (Math.abs(actual[i].box[field] - expected[i].box[field]) > .003)
            throw new Error(`GPU/CPU ${field} mismatch for person ${i}`);
        }
        checks.push({ persons: actual.length, gpuMs: gpu.getLastTimings(), cpuMs: cpu.getLastTimings() });
      }
      return { backend: gpu.getBackend(), checks };
    } finally { await gpu.dispose(); await cpu.dispose(); }
  }, (await readFile('tests/fixtures/bus.jpg')).toString('base64'));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser?.close(); await rm(profile, { recursive: true, force: true }); }
