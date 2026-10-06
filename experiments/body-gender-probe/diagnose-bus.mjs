import { chromium } from 'playwright';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const bus = (await readFile(resolve(root, 'tests/fixtures/bus.jpg'))).toString('base64');
const profile = await mkdtemp(resolve(tmpdir(), 'body-bus-probe-'));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`] });
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
  const page = await browser.newPage();
  await page.goto(new URL('popup.html', worker.url()).href);
  const result = await page.evaluate(async base64 => {
    const { YoloPersonSegmenter, BodyGenderClassifier } = await import(chrome.runtime.getURL('person-runtime.js'));
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
    const side = 320;
    const canvas = new OffscreenCanvas(side, side);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#000';
    context.fillRect(0, 0, side, side);
    const scale = Math.min(side / bitmap.width, side / bitmap.height);
    context.drawImage(bitmap, (side - bitmap.width * scale) / 2, (side - bitmap.height * scale) / 2,
      bitmap.width * scale, bitmap.height * scale);
    bitmap.close();
    const rgba = new Uint8Array(context.getImageData(0, 0, side, side).data);
    const detector = new YoloPersonSegmenter(side, 'wasm', 2);
    await detector.initialize();
    const detections = await detector.segment(rgba, 0.1);
    const output = { detections: detections.map(d => ({ box: d.box, score: d.score })), models: {} };
    for (const name of ['intel', 'paddle']) {
      const model = new BodyGenderClassifier(name, 'wasm', 2);
      await model.initialize();
      output.models[name] = await model.classify(rgba, side, detections.map(d => d.box));
      await model.dispose();
    }
    await detector.dispose();
    return output;
  }, bus);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await rm(profile, { recursive: true, force: true });
}
