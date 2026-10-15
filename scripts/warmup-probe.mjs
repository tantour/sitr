// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import ts from 'typescript';

const root = process.cwd(), cache = resolve(root, '.cache');
await mkdir(cache, { recursive: true });
const profile = await mkdtemp(resolve(cache, 'warmup-profile-'));
const target = resolve(root, 'dist/warmup-probe-worker.js');
const code = ts.transpileModule(await readFile('src/config/settings.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { DEFAULT_SETTINGS } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
await writeFile(target, `(async () => {
const runtime = await import('./person-runtime.js');
let initializations = 0;
for (const value of Object.values(runtime)) {
  if (!value?.prototype?.initialize) continue;
  const original = value.prototype.initialize;
  value.prototype.initialize = function(...args) { initializations++; return original.apply(this, args); };
}
self.addEventListener('message', ({data}) => {
  if (data.type === 'probe-counters') self.postMessage({type:'probe-counters', initializations});
});
await import('./worker.js');
})().catch(error => self.postMessage({type:'error',message:String(error)}));
`);
let context;
try {
  console.log('Launching Chromium warmup checks');
  context = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`, '--use-angle=d3d11'] });
  const sw = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const livePopup = await context.newPage();
  await livePopup.goto(new URL('popup.html', sw.url()).href);
  await livePopup.locator('#engineStatus[data-state=preparing]').waitFor().catch(async error => {
    console.log('Live popup diagnostic:', await livePopup.locator('#engineStatus').textContent());
    console.log('Live API diagnostic:', await livePopup.evaluate(() => chrome.runtime.sendMessage({ type: 'engine-status' })));
    throw error;
  });
  console.log('Waiting for startup readiness');
  // Startup must prepare the engine before any website or popup requests it.
  const startup = await sw.evaluate(async () => {
    const deadline = Date.now() + 180000;
    const observed = [];
    while (Date.now() < deadline) {
      const status = await chrome.runtime.sendMessage({ type: 'engine-status' }).catch(() => null);
      if (status?.progress) observed.push(status.progress.completed);
      if (status?.ready) return { ...status, observed };
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw Error('Startup preparation timed out: ' + JSON.stringify(await chrome.runtime.sendMessage({ type: 'engine-status' }).catch(() => null)));
  });
  assert.equal(startup.warmup.models.length, 15);
  assert.deepEqual(startup.warmup.failures, {});
  assert(startup.observed.some(completed => completed > 0 && completed < 15), 'Live progress should report intermediate preparation steps');
  await livePopup.locator('#engineStatus[data-state=ready]').waitFor();
  assert.equal(await livePopup.locator('#engineStatusTitle').textContent(), 'Ready for images and videos');
  await livePopup.close();
  console.log('Startup warmup:', Math.round(startup.warmup.elapsedMs), 'ms, all 15 paths ready');
  await sw.evaluate(() => chrome.runtime.sendMessage({ type: 'retry-engine', backend: 'wasm' }));
  const restarted = await sw.evaluate(async () => {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const status = await chrome.runtime.sendMessage({ type: 'engine-status' });
      if (status?.ready) return status;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw Error('Restart preparation timed out');
  });
  assert.equal(restarted.warmup.models.length, 15);
  assert.deepEqual(restarted.warmup.failures, {});
  await sw.evaluate(() => chrome.offscreen.closeDocument());
  const page = await context.newPage();
  await page.goto(new URL('popup.html', sw.url()).href);
  const bytes = (await readFile('tests/fixtures/man-profile.jpg')).toString('base64');
  const results = await page.evaluate(async ({ defaults, bytes, backend }) => {
    const worker = new Worker(chrome.runtime.getURL('warmup-probe-worker.js'));
    const ready = await new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => resolve(data);
      worker.onerror = event => reject(Error(event.message));
    });
    if (ready.type !== 'ready') throw Error('Worker failed to start');
    const request = message => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Warmup probe request timed out')), 180000);
      worker.onmessage = ({ data }) => { if (data.type === 'warm-progress') return; clearTimeout(timer); data.type === 'error' ? reject(Error(data.message)) : resolve(data); };
      worker.onerror = event => { clearTimeout(timer); reject(Error(event.message)); };
      worker.postMessage(message);
    });
    try {
      worker.postMessage({ type: 'backend', semantic: 'cpu', onnx: backend, threads: 2, parallelSemantic: false });
      const warm = await request({ type: 'warm-all' });
      const before = (await request({ type: 'probe-counters' })).initializations;
      const secondWarm = await request({ type: 'warm-all' });
      const afterSecondWarm = (await request({ type: 'probe-counters' })).initializations;
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(bytes), c => c.charCodeAt(0))]));
      const metrics = [];
      const configs = [
        ...Array.from({ length: 3 }, () => ({ size: 320, mode: 'finer', kind: 'image', detector: 'segment', model: 'face', comparison: true })),
        ...[320, 256, 416, 320].flatMap(size => ['finer', 'off', 'faster', 'finer'].map(mode => ({ size, mode, kind: 'image', detector: 'segment' }))),
        ...[256, 320, 416].map(size => ({ size, mode: 'off', kind: 'video', detector: 'segment' })),
        { size: 256, mode: 'off', kind: 'video', detector: 'fast-box' },
      ];
      const choices = ['face', 'body-intel', 'body-paddle', 'face-intel', 'face-paddle'];
      for (const [i, config] of configs.entries()) {
        const { size, mode, kind, detector } = config;
        const model = config.model ?? choices[i % choices.length];
        const canvas = new OffscreenCanvas(size, size), ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, size, size);
        const rgba = new Uint8Array(ctx.getImageData(0, 0, size, size).data);
        rgba[0] ^= i + 1; // Force actual inference instead of duplicate-image reuse.
        const result = (await request({ type: 'analyze', frame: {
          key: { mediaSessionId: 'warm-probe-' + i, epoch: 1, sequence: 1 }, kind,
          capturedAtMs: Date.now(), width: size, height: size, rgba,
          ...(kind === 'video' ? { faceRgba: rgba.slice(), faceSize: size } : {}),
        }, settings: { ...defaults, filter: 'both', debugOverlay: true, imageBodyRegionMode: mode,
          yoloImageSize: size, yoloVideoSize: size, videoDetector: detector, yunetSize: size,
          imageGenderModel: model, videoGenderModel: model } })).result;
        metrics.push({ ...config, model, timings: result.timingsMs,
          people: result.tracks.length, gender: result.genderDiagnostics, regions: result.bodyRegionDiagnostics });
      }
      bitmap.close();
      const after = (await request({ type: 'probe-counters' })).initializations;
      return { warm, secondWarm, before, afterSecondWarm, after, metrics };
    } finally { worker.terminate(); }
  }, { defaults: DEFAULT_SETTINGS, bytes, backend: process.env.WARMUP_BACKEND ?? 'wasm' });
  assert.equal(results.warm.models.length, 15);
  assert.deepEqual(results.warm.failures, {});
  assert.equal(results.before, 12);
  assert.equal(results.afterSecondWarm, results.before, 'Repeated preparation must reuse sessions');
  assert.equal(results.after, results.before, 'First inference and every setting switch must reuse prepared sessions');
  for (const result of results.metrics) {
    assert(result.timings.modelInit < 20, 'No model-loading delay should remain');
    assert(result.people > 0, 'Clothed male fixture must exercise actual person inference');
    assert(!result.gender.error, result.gender.error);
    assert.notEqual(result.regions.status, 'fallback');
  }
  await writeFile(resolve(cache, 'warmup-results.json'), JSON.stringify({ startup, restarted, ...results }, null, 2));
  console.log(JSON.stringify(results.metrics.map(r => ({ kind: r.kind, size: r.size, mode: r.mode,
    detector: r.detector, modelInit: r.timings.modelInit, personRun: r.timings.personRun, total: r.timings.total })), null, 2));
  console.log('Same settings first/repeated inference:', results.metrics.filter(r => r.comparison).map(r => Math.round(r.timings.total)), 'ms');
  console.log('PASS: startup, restart, idempotent warmup, all model variants, real first inference and setting switches without reinitialization.');
} finally {
  await context?.close();
  await rm(target, { force: true });
  if (!profile.startsWith(cache + sep) || !profile.split(sep).at(-1).startsWith('warmup-profile-')) throw Error('Unsafe profile cleanup');
  await rm(profile, { recursive: true, force: true });
}
