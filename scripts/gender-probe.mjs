// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { chromium } from 'playwright';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const bus = (await readFile(resolve(root, 'tests/fixtures/bus.jpg'))).toString('base64');
const womanProfile = (await readFile(resolve(root, 'tests/fixtures/woman-profile.jpg'))).toString('base64');
const manProfile = (await readFile(resolve(root, 'tests/fixtures/man-profile.jpg'))).toString('base64');
const profile = await mkdtemp(resolve(tmpdir(), 'gender-probe-'));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`] });
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
  const page = await browser.newPage();
  await page.goto(new URL('popup.html', worker.url()).href);
  const results = await page.evaluate(async ({ bus, womanProfile, manProfile }) => {
    const { AppearanceGenderClassifier } = await import(chrome.runtime.getURL('person-runtime.js'));
    const classifier = new AppearanceGenderClassifier();
    await classifier.initialize();
    const classify = async (base64, boxes) => {
      const bytes = Uint8Array.from(atob(base64), letter => letter.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
      const canvas = new OffscreenCanvas(512, 512);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const scale = Math.min(512 / bitmap.width, 512 / bitmap.height);
      const offsetX = (512 - bitmap.width * scale) / 2;
      const offsetY = (512 - bitmap.height * scale) / 2;
      context.drawImage(bitmap, offsetX, offsetY, bitmap.width * scale, bitmap.height * scale);
      const rgba = new Uint8Array(context.getImageData(0, 0, 512, 512).data);
      const mapped = boxes.map(box => ({ x: (offsetX + box.x * scale) / 512, y: (offsetY + box.y * scale) / 512,
        width: box.width * scale / 512, height: box.height * scale / 512 }));
      bitmap.close();
      const started = performance.now();
      const estimates = await classifier.classify(rgba, 512, mapped);
      return { estimates, elapsedMs: Math.round(performance.now() - started) };
    };
    const males = await classify(bus, [{ x: 96, y: 403, width: 70, height: 80 }, { x: 265, y: 412, width: 48, height: 58 }]);
    const sideFemale = await classify(womanProfile, [{ x: 280, y: 160, width: 410, height: 490 }]);
    const sideMale = await classify(manProfile, [{ x: 325, y: 20, width: 390, height: 445 }]);
    await classifier.dispose();
    return { males, sideFemale, sideMale };
  }, { bus, womanProfile, manProfile });
  console.log(results);
  if (results.males.estimates.some(result => result?.label !== 'male') ||
      results.sideFemale.estimates[0]?.label !== 'female' || results.sideMale.estimates[0]?.label !== 'male') {
    throw new Error('Gender model label mapping failed reference portraits');
  }
} finally {
  await browser?.close();
  await rm(profile, { recursive: true, force: true });
}
