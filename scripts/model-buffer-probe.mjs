// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { chromium } from 'playwright';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd(), profile = await mkdtemp(resolve(tmpdir(), 'sitr-model-buffers-'));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`] });
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
  const page = await browser.newPage();
  await page.goto(new URL('popup.html', worker.url()).href);
  const result = await page.evaluate(async base64 => {
    const { AppearanceGenderClassifier, BodyGenderClassifier } = await import(chrome.runtime.getURL('person-runtime.js'));
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
    const canvas = new OffscreenCanvas(320, 320), ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, 320, 320); bitmap.close();
    const rgba = new Uint8Array(ctx.getImageData(0, 0, 320, 320).data.buffer);
    const boxes = [{ x: .05, y: .4, width: .25, height: .5 }, { x: .3, y: .4, width: .2, height: .5 },
      { x: .72, y: .4, width: .17, height: .5 }];
    const results = {};
    for (const name of ['face', 'intel', 'paddle']) {
      const classifier = name === 'face' ? new AppearanceGenderClassifier() : new BodyGenderClassifier(name);
      await classifier.initialize();
      try {
        const width = name === 'face' ? 128 : name === 'intel' ? 80 : 192;
        const height = name === 'face' ? 128 : name === 'intel' ? 160 : 256;
        const inputName = name === 'face' ? 'image' : name === 'intel' ? '0' : 'x';
        const outputName = name === 'face' ? 'gender_logits' : name === 'intel' ? '453/sink_port_0' : 'sigmoid_2.tmp_0';
        const source = new OffscreenCanvas(320, 320), crop = new OffscreenCanvas(width, height);
        const sourceCtx = source.getContext('2d'), cropCtx = crop.getContext('2d', { willReadFrequently: true });
        const run = classifier.session.run.bind(classifier.session);
        let lastInput;
        classifier.session.run = (feeds, ...options) => { lastInput = Object.values(feeds)[0]; return run(feeds, ...options); };
        let priorBuffer;
        for (const [iteration, currentBoxes] of [boxes, boxes.slice(0, 1), [boxes[0], { x: 0, y: 0, width: 0, height: 0 }, boxes[2]]].entries()) {
          const frame = iteration === 1 ? new Uint8Array(rgba.length) : rgba;
          const chosen = name === 'face' ? currentBoxes.filter(box => box.width > 0) : currentBoxes;
          const actual = await classifier.classify(frame, 320, chosen);
          sourceCtx.putImageData(new ImageData(new Uint8ClampedArray(frame.buffer), 320, 320), 0, 0);
          const inputs = [];
          for (const box of chosen) {
            if (box.width <= 0 || box.height <= 0) { inputs.push(undefined); continue; }
            cropCtx.fillStyle = '#000'; cropCtx.fillRect(0, 0, width, height);
            if (name === 'face') {
              const side = Math.max(box.width, box.height) * 320 * 1.2;
              cropCtx.drawImage(source, (box.x + box.width / 2) * 320 - side / 2,
                (box.y + box.height / 2) * 320 - side / 2, side, side, 0, 0, width, height);
            } else cropCtx.drawImage(source, box.x * 320, box.y * 320, box.width * 320, box.height * 320, 0, 0, width, height);
            const pixels = width * height, data = cropCtx.getImageData(0, 0, width, height).data, input = new Float32Array(pixels * 3);
            for (let p = 0; p < pixels; p++) for (let channel = 0; channel < 3; channel++)
              input[channel * pixels + p] = name === 'intel' ? data[p * 4 + 2 - channel]
                : (data[p * 4 + channel] / 255 - [.485, .456, .406][channel]) / [.229, .224, .225][channel];
            inputs.push(input);
          }
          const valid = inputs.filter(Boolean), combined = new Float32Array(valid.length * width * height * 3);
          valid.forEach((input, i) => combined.set(input, i * width * height * 3));
          if (combined.some((v, i) => !Object.is(v, classifier.input[i]))) throw new Error(`${name}: preprocessing changed at iteration ${iteration}`);
          if (priorBuffer && priorBuffer !== classifier.input.buffer) throw new Error(`${name}: buffer was not reused`);
          priorBuffer = classifier.input.buffer;
          const batches = name === 'intel' ? valid : [combined];
          const estimates = [];
          for (const input of batches) {
            const count = input.length / (3 * width * height);
            const output = await run({ [inputName]: new lastInput.constructor('float32', input, [count, 3, height, width]) });
            try {
              const data = output[outputName].data;
              for (let i = 0; i < count; i++) {
                if (name === 'face') {
                  const female = data[i * 2], male = data[i * 2 + 1];
                  estimates.push({ label: male > female ? 'male' : 'female', confidence: 1 / (1 + Math.exp(-Math.abs(male - female))) });
                } else {
                  const female = name === 'intel' ? 1 - data[0] : data[i * 26 + 22];
                  estimates.push({ label: female >= .5 ? 'female' : 'male', confidence: Math.max(female, 1 - female) });
                }
              }
            } finally { for (const tensor of Object.values(output)) tensor.dispose(); }
          }
          let cursor = 0;
          const expected = inputs.map(input => input ? estimates[cursor++] : undefined);
          if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${name}: inference changed at iteration ${iteration}`);
          results[name] = { iterations: iteration + 1, backend: classifier.getBackend() };
        }
      } finally { await classifier.dispose(); }
    }
    return results;
  }, (await readFile('tests/fixtures/bus.jpg')).toString('base64'));
  console.log(JSON.stringify(result));
} finally { await browser?.close(); await rm(profile, { recursive: true, force: true }); }
