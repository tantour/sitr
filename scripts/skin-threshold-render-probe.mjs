// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { transform } from 'esbuild';
import { readFile } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 200, height: 200 } });
  await page.route('http://127.0.0.1/skin-threshold-fixture', route => route.fulfill({ contentType: 'text/html',
    body: '<style>body{margin:0}img{width:100px;height:100px}</style><img id="photo">' }));
  await page.goto('http://127.0.0.1/skin-threshold-fixture');
  for (const [path, name, prefix] of [
    ['src/media/capture.ts', 'Capture', ''],
    ['src/rendering/overlay.ts', 'OverlayModule', ''],
    ['src/rendering/background.ts', 'Background', 'const decodeImageBlob = Capture.decodeImageBlob;\n'],
  ]) {
    const source = prefix + (await readFile(path, 'utf8')).replace(/^import .*;\r?$/gm, '');
    const compiled = await transform(source, { loader: 'ts', format: 'iife', globalName: name });
    await page.addScriptTag({ content: compiled.code });
  }
  const pixels = await page.evaluate(async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#e74b21"/></svg>';
    const image = document.getElementById('photo');
    image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    await image.decode();
    const rgba = new Uint8Array(100 * 100 * 4);
    const faceMask = new Uint8Array(100 * 100).fill(255);
    const blackMask = new Uint8Array(100 * 100);
    for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
      rgba[(y * 100 + x) * 4 + 3] = 255;
      if (x < 50) blackMask[y * 100 + x] = 255;
    }
    const result = { key: { mediaSessionId: 'fixture', epoch: 1, sequence: 1 }, width: 100, height: 100,
      capturedAtMs: Date.now(), analyzedAtMs: Date.now(), settingsRevision: 1, black: false, reason: 'skin-threshold',
      rgbaMask: rgba, blackMask, faceMask, tracks: [],
      effect: { kind: 'blur', intensity: 16, grayscale: false },
      faceEffect: { kind: 'blur', intensity: 16, grayscale: false } };
    const overlay = new OverlayModule.Overlay(image);
    overlay.set(result);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const overlayContext = overlay.canvas.getContext('2d');
    const pixel = (context, x) => Array.from(context.getImageData(x, 50, 1, 1).data);
    const baked = await Background.renderBackground(new Blob([svg], { type: 'image/svg+xml' }), result);
    const decoded = await Capture.decodeImageBlob(baked);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 100;
    const context = canvas.getContext('2d'); context.drawImage(decoded.source, 0, 0); decoded.close();
    const output = { overlayBlack: pixel(overlayContext, 30), overlayBlur: pixel(overlayContext, 70),
      backgroundBlack: pixel(context, 30), backgroundBlur: pixel(context, 70) };
    overlay.clear();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    output.clearedAlpha = pixel(overlayContext, 70)[3];
    overlay.dispose();
    return output;
  });
  assert.deepEqual(pixels.overlayBlack, [0, 0, 0, 255]);
  assert.deepEqual(pixels.backgroundBlack, [0, 0, 0, 255]);
  assert(pixels.overlayBlur[0] > 150, 'The other person must retain its chosen blur effect');
  assert(pixels.backgroundBlur[0] > 150, 'A background must retain its chosen blur outside forced coverage');
  assert.equal(pixels.clearedAlpha, 0, 'An old effect must disappear when the entire image is protected');
  console.log('PASS: threshold coverage stays fully black over body and face blur, in overlays and CSS backgrounds.');
} finally { await browser.close(); }
