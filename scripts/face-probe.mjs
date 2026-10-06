// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { chromium } from 'playwright';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const side = Number(process.env.FACE_PROBE_SIZE ?? 640);
const files = Object.fromEntries(await Promise.all(['bus', 'woman-profile', 'man-profile'].map(async name =>
  [name, (await readFile(resolve(root, `tests/fixtures/${name}.jpg`))).toString('base64')])));
const profile = await mkdtemp(resolve(tmpdir(), 'face-probe-'));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`] });
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
  const page = await browser.newPage();
  await page.goto(new URL('popup.html', worker.url()).href);
  const results = await page.evaluate(async ({ files, side, ownershipProbe }) => {
    const { OptionalFaceDetector, AppearanceGenderClassifier, YoloPersonSegmenter } = await import(chrome.runtime.getURL('person-runtime.js'));
    const detector = new OptionalFaceDetector();
    const classifier = new AppearanceGenderClassifier();
    await detector.initialize();
    await classifier.initialize();
    const person = ownershipProbe ? new YoloPersonSegmenter(320) : null;
    if (person) await person.initialize();
    const results = {};
    for (const [name, base64] of Object.entries(files)) {
      const bytes = Uint8Array.from(atob(base64), letter => letter.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
      const canvas = new OffscreenCanvas(side, side);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const scale = Math.min(side / bitmap.width, side / bitmap.height);
      context.drawImage(bitmap, 0, 0, bitmap.width * scale, bitmap.height * scale);
      bitmap.close();
      const rgba = new Uint8Array(context.getImageData(0, 0, side, side).data);
      const started = performance.now();
      const faces = await detector.detect(rgba, side);
      const detectMs = performance.now() - started;
      const estimates = await classifier.classify(rgba, side, faces.filter(face => face.score >= 0.55).map(face => face.box));
      const ownership = [];
      if (person && name === 'woman-profile') {
        const small = new OffscreenCanvas(320, 320);
        small.getContext('2d').drawImage(canvas, 0, 0, 320, 320);
        const people = await person.segment(new Uint8Array(small.getContext('2d').getImageData(0, 0, 320, 320).data), 0.1);
        for (const face of faces.filter(face => face.score >= 0.55)) for (const track of people) {
          const { x, y, width, height } = face.box;
          let covered = 0, area = 0;
          for (let py = Math.max(0, Math.floor((y + height * 0.25) * 320)); py < Math.min(320, Math.ceil((y + height * 0.75) * 320)); py++)
            for (let px = Math.max(0, Math.floor((x + width * 0.25) * 320)); px < Math.min(320, Math.ceil((x + width * 0.75) * 320)); px++) {
              area++; if (track.mask[py * 320 + px] >= 0.65) covered++;
            }
          const nx = Math.floor(face.nose.x * 320), ny = Math.floor(face.nose.y * 320);
          ownership.push({ coverage: covered / area, noseMask: track.mask[ny * 320 + nx], personBox: track.box });
        }
      }
      results[name] = { detectMs: Math.round(detectMs), faces: faces.filter(face => face.score >= 0.55), estimates, ownership };
    }
    await classifier.dispose();
    await detector.dispose();
    await person?.dispose();
    return results;
  }, { files, side, ownershipProbe: process.env.FACE_PROBE_OWNERSHIP === '1' });
  console.log(JSON.stringify(results, null, 2));
  for (const name of ['woman-profile', 'man-profile']) {
    if (!results[name].faces.length) throw new Error(`YuNet missed ${name}`);
  }
  if (results.bus.faces.length < 2) throw new Error('YuNet missed the two clear bus faces');
} finally {
  await browser?.close();
  await rm(profile, { recursive: true, force: true });
}
