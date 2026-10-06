// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { transform } from 'esbuild';
import { readFile } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 128, height: 128 } });
  await page.route('http://127.0.0.1/overlay-reuse-fixture', route => route.fulfill({ contentType: 'text/html',
    body: '<style>body{margin:0}img{width:64px;height:64px}</style><img id="photo">' }));
  await page.goto('http://127.0.0.1/overlay-reuse-fixture');
  const source = (await readFile('src/rendering/overlay.ts', 'utf8')).replace(/^import .*;\r?$/gm, '');
  await page.addScriptTag({ content: (await transform(source, { loader: 'ts', format: 'iife', globalName: 'OverlayModule' })).code });
  const result = await page.evaluate(async () => {
    const image = document.getElementById('photo');
    image.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="red"/></svg>');
    await image.decode();
    const overlay = new OverlayModule.Overlay(image);
    const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const frame = (side, trackMasks, extras = {}) => ({ width: side, height: side, rgbaMask: new Uint8Array(side * side * 4),
      trackMasks, tracks: [], black: false, key: { mediaSessionId: 'fixture', epoch: 1, sequence: 1 }, ...extras });
    const alpha = new Uint8Array(8 * 8).fill(255);
    overlay.set(frame(8, [{ id: 'a', alpha }, { id: 'b', alpha }]));
    const first = overlay.trackCanvases.get('a');
    const firstImage = overlay.layerImages.get(first);
    await paint();
    const covered = overlay.canvas.getContext('2d').getImageData(32, 32, 1, 1).data[3];
    overlay.set(frame(8, [{ id: 'a', alpha: new Uint8Array(64) }]));
    await paint();
    const cleared = overlay.canvas.getContext('2d').getImageData(32, 32, 1, 1).data[3];
    const reused = first === overlay.trackCanvases.get('a') && firstImage === overlay.layerImages.get(first);
    const removed = !overlay.trackCanvases.has('b');
    overlay.set(frame(12, [{ id: 'a', alpha: new Uint8Array(144).fill(255) }]));
    await paint();
    const resized = first === overlay.trackCanvases.get('a') && first.width === 12 && overlay.layerImages.get(first).width === 12;
    const backed = new Uint8Array(8 * 8 * 4 + 32);
    const rgba = backed.subarray(16, backed.length - 16);
    for (let p = 0; p < 64; p++) rgba[p * 4 + 3] = 137;
    overlay.set(frame(8, undefined, { rgbaMask: rgba }));
    await paint();
    const viewAlpha = overlay.canvas.getContext('2d').getImageData(32, 32, 1, 1).data[3];
    overlay.clear();
    await paint();
    const finalAlpha = overlay.canvas.getContext('2d').getImageData(32, 32, 1, 1).data[3];
    overlay.dispose();
    return { covered, cleared, reused, removed, resized, viewAlpha, finalAlpha };
  });
  assert.deepEqual(result, { covered: 255, cleared: 0, reused: true, removed: true, resized: true, viewAlpha: 137, finalAlpha: 0 });
  console.log('PASS: overlay buffers are reused, resized and cleared without stale pixels or retired tracks.');
} finally { await browser.close(); }
