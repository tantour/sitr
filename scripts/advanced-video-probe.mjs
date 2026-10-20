// SPDX-License-Identifier: AGPL-3.0-only
// Run after npm run build. Uses real packaged models on a deterministic frame.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import ts from 'typescript';

const root = process.cwd(), cache = resolve(root, '.cache');
await mkdir(cache, { recursive: true });
const profile = await mkdtemp(resolve(cache, 'advanced-video-'));
const code = ts.transpileModule(await readFile('src/config/settings.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { DEFAULT_SETTINGS, BODY_REGIONS } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`] });
  const sw = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
  const page = await browser.newPage(); await page.goto(new URL('popup.html', sw.url()).href);
  const result = await page.evaluate(async ({ defaults, regions, bytes }) => {
    const worker = new Worker(chrome.runtime.getURL('worker.js'));
    const request = message => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Advanced video probe timeout')), 90000);
      worker.onmessage = ({ data }) => {
        if (data.type !== 'result' && data.type !== 'error') return;
        clearTimeout(timer); data.type === 'error' ? reject(Error(`${message.type}: ${data.message}`)) : resolve(data.result);
      };
      worker.onerror = error => { clearTimeout(timer); reject(Error(error.message)); };
      worker.postMessage(message);
    });
    try {
      // Backend messages do not reply; the following analyze observes the update.
      worker.postMessage({ type: 'backend', semantic: 'cpu', onnx: 'wasm', threads: 2, parallelSemantic: false });
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(bytes), c => c.charCodeAt(0))]));
      const side = 256, canvas = new OffscreenCanvas(side, side), ctx = canvas.getContext('2d');
      const scale = side / Math.max(bitmap.width, bitmap.height), w = bitmap.width * scale, h = bitmap.height * scale;
      ctx.drawImage(bitmap, (side - w) / 2, (side - h) / 2, w, h); bitmap.close();
      const rgba = new Uint8Array(ctx.getImageData(0, 0, side, side).data.buffer);
      const policy = () => ({ skin: Object.fromEntries(regions.map(area => [area, 'show'])), otherSkin: 'show',
        hair: 'show', face: 'show', video: 'black', videoSkin: 'hide', videoFace: 'show', videoHair: 'show' });
      const summary = result => ({ people: result.tracks.length,
        pixels: result.trackMasks.reduce((sum, track) => sum + track.alpha.filter(Boolean).length, 0),
        semantic: result.timingsMs.semanticBackend, bodyRegions: result.timingsMs.bodyRegionBackend,
        semanticMs: result.timingsMs.semantic, bodyRegionMs: result.timingsMs.bodyRegions,
        blur: result.effect?.kind ?? result.trackMasks.find(track => track.effect)?.effect.kind });
      const outcomes = [];
      for (const detector of ['segment', 'fast-box']) {
        let settings = { ...defaults, automaticGender: false, videoDetector: detector, yoloVideoSize: 256,
          imageBodyRegionMode: 'finer', videoExpansion: 0, videoSkinExpansion: 0,
          personPolicies: { female: policy(), male: policy() } };
        let sequence = 0;
        const analyze = advanced => {
          settings = { ...settings, advancedVideoMode: advanced };
          return request({ type: 'analyze', settings, frame: {
            key: { mediaSessionId: `advanced-${detector}`, epoch: 1, sequence: ++sequence }, kind: 'video',
            mediaTimeSec: sequence / 10, capturedAtMs: Date.now(), width: side, height: side, rgba: rgba.slice(),
          } });
        };
        const standard = await analyze(false), advanced = await analyze(true);
        const key = advanced.key;
        for (const policy of Object.values(settings.personPolicies)) { policy.videoSkin = 'show'; policy.videoFace = 'hide'; }
        const face = await request({ type: 'settings', key, settings });
        for (const policy of Object.values(settings.personPolicies)) { policy.videoFace = 'show'; policy.videoHair = 'hide'; }
        const hair = await request({ type: 'settings', key, settings });
        for (const policy of Object.values(settings.personPolicies)) policy.videoHair = 'show';
        const shown = await request({ type: 'settings', key, settings });
        outcomes.push({ detector, standard: summary(standard), advanced: summary(advanced), face: summary(face), hair: summary(hair), shown: summary(shown) });
      }
      // The same packaged worker must apply part-threshold face overrides and
      // restore ordinary face effects when the threshold stops triggering.
      const imagePolicy = face => ({ ...policy(), face: 'black', partThresholds:
        regions.map(area => ({ area, percent: 0, target: 'body', face })) });
      let imageSettings = { ...defaults, automaticGender: false, yoloImageSize: 256,
        imageBodyRegionMode: 'finer', imageExpansion: 2,
        personPolicies: { female: imagePolicy('black'), male: imagePolicy('black') } };
      let imageSequence = 0;
      const analyzeImage = () => request({ type: 'analyze', settings: imageSettings, frame: {
        key: { mediaSessionId: 'part-thresholds', epoch: 1, sequence: ++imageSequence }, kind: 'image',
        capturedAtMs: Date.now(), width: side, height: side, rgba: rgba.slice(),
      } });
      const black = await analyzeImage();
      imageSettings = { ...imageSettings, personPolicies: { female: imagePolicy('show'), male: imagePolicy('show') } };
      const show = await analyzeImage();
      for (const policy of Object.values(imageSettings.personPolicies)) for (const rule of policy.partThresholds) rule.percent = 100;
      const inactive = await request({ type: 'settings', key: show.key, settings: imageSettings });
      const thresholdSummary = result => ({ blackout: result.blackMask?.filter(Boolean).length ?? 0,
        faceEffect: (result.faceLayers ?? []).reduce((sum, layer) => sum + layer.alpha.filter(Boolean).length, 0),
        bodyRegionBackend: result.timingsMs.bodyRegionBackend });
      return { video: outcomes, thresholds: { black: thresholdSummary(black), show: thresholdSummary(show), inactive: thresholdSummary(inactive) } };
    } finally { worker.terminate(); }
  }, { defaults: DEFAULT_SETTINGS, regions: BODY_REGIONS, bytes: (await readFile('tests/fixtures/bus.jpg')).toString('base64') });
  for (const entry of result.video) {
    assert(entry.standard.people > 0 && entry.advanced.people > 0);
    assert.equal(entry.standard.semantic, 'skipped');
    assert.equal(entry.advanced.semantic, 'cpu');
    assert.equal(entry.advanced.bodyRegions, 'skipped-video'); assert.equal(entry.advanced.bodyRegionMs, 0);
    assert(entry.advanced.pixels > 0 && entry.advanced.pixels < entry.standard.pixels);
    assert(entry.face.pixels > 0 && entry.hair.pixels > 0);
    assert.equal(entry.shown.pixels, 0); assert.equal(entry.advanced.blur, undefined);
  }
  assert(result.thresholds.black.blackout > 0, 'Exposed-part threshold must cover the body');
  assert(result.thresholds.show.blackout < result.thresholds.black.blackout, 'Show must reopen faces in body masks after expansion');
  assert(result.thresholds.show.faceEffect < result.thresholds.black.faceEffect, 'Shown threshold faces must override ordinary face effects');
  assert.equal(result.thresholds.inactive.blackout, 0, 'A 100% threshold must not trigger');
  assert.equal(result.thresholds.inactive.faceEffect, result.thresholds.black.faceEffect, 'Inactive thresholds restore ordinary face effects');
  assert.equal(result.thresholds.inactive.bodyRegionBackend, 'cache', 'Percentage edits must reuse the anatomy map');
  console.log(JSON.stringify(result, null, 2));
  console.log('PASS: both detectors add MediaPipe only in advanced mode; independent skin/face/hair masks, cached edits and no body-part inference.');
  console.log('PASS: image part thresholds black/show faces after expansion, override ordinary effects and reuse cached anatomy for percentage edits.');
} finally {
  await browser?.close();
  if (!profile.startsWith(cache + sep) || !profile.split(sep).at(-1).startsWith('advanced-video-')) throw Error('Unsafe profile cleanup');
  await rm(profile, { recursive: true, force: true });
}
