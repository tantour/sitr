import { chromium } from 'playwright';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const sampleDir = process.env.BODY_BACK_SAMPLES ?? resolve(tmpdir(), 'body-gender-back-samples');
const selected = ['000002_female.jpg', '000003_male.jpg', '000013_female.jpg', '000014_female.jpg'];
const files = Object.fromEntries(await Promise.all(selected.map(async name =>
  [name, (await readFile(resolve(sampleDir, name))).toString('base64')])));
const profile = await mkdtemp(resolve(tmpdir(), 'body-gender-browser-'));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`] });
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
  const page = await browser.newPage();
  await page.goto(new URL('popup.html', worker.url()).href);
  const results = await page.evaluate(async files => {
    const { BodyGenderClassifier } = await import(chrome.runtime.getURL('person-runtime.js'));
    const output = {};
    for (const name of ['intel', 'paddle']) {
      const classifier = new BodyGenderClassifier(name, 'wasm', 2);
      await classifier.initialize();
      output[name] = { backend: classifier.getBackend(), estimates: {} };
      for (const [file, base64] of Object.entries(files)) {
        const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
        const canvas = new OffscreenCanvas(320, 320);
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0, 320, 320);
        bitmap.close();
        const rgba = new Uint8Array(context.getImageData(0, 0, 320, 320).data);
        const estimates = await classifier.classify(rgba, 320, [{ x: 0, y: 0, width: 1, height: 1 }]);
        output[name].estimates[file] = estimates[0];
      }
      const repeats = [];
      const first = Object.values(files)[0];
      const bytes = Uint8Array.from(atob(first), char => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
      const canvas = new OffscreenCanvas(320, 320);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0, 320, 320);
      bitmap.close();
      const rgba = new Uint8Array(context.getImageData(0, 0, 320, 320).data);
      for (let i = 0; i < 20; i++) {
        await classifier.classify(rgba, 320, [{ x: 0, y: 0, width: 1, height: 1 }]);
        if (i >= 5) repeats.push(classifier.getLastTimings().run);
      }
      repeats.sort((a, b) => a - b);
      output[name].medianRunMs = repeats[Math.floor(repeats.length / 2)];
      await classifier.dispose();
    }
    return output;
  }, files);
  console.log(JSON.stringify(results, null, 2));
  for (const [name, data] of Object.entries(results)) {
    if (data.estimates['000002_female.jpg']?.label !== 'female' ||
      data.estimates['000003_male.jpg']?.label !== 'male') throw new Error(`${name} browser output mismatch`);
  }
} finally {
  await browser?.close();
  await rm(profile, { recursive: true, force: true });
}
