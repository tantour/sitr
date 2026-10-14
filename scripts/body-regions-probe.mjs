// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, mkdir, rm, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import ts from 'typescript';

const root = process.cwd(), cache = resolve(root, '.cache');
await mkdir(cache, { recursive: true });
const profile = await mkdtemp(resolve(cache, 'body-regions-profile-'));
const code = ts.transpileModule(await readFile('src/config/settings.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { DEFAULT_SETTINGS, BODY_REGIONS } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
let context;
try {
  context = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`, '--use-angle=d3d11'] });
  const sw = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const page = await context.newPage(); await page.goto(new URL('popup.html', sw.url()).href);
  const bytes = (await readFile('tests/fixtures/bus.jpg')).toString('base64');
  await page.evaluate(({ defaults, regions, bytes }) => {
    window.runBodyRegionProbe = async (mode, failure = false, backend = 'wasm', diagram = false) => {
      const worker = new Worker(chrome.runtime.getURL('worker.js'));
      const request = message => new Promise((resolve, reject) => {
        const timer = setTimeout(() => { worker.terminate(); reject(Error('Body region probe timed out')); }, 120000);
        worker.onmessage = ({ data }) => { clearTimeout(timer); data.type === 'error' ? reject(Error(data.message)) : resolve(data); };
        worker.onerror = error => { clearTimeout(timer); reject(Error(error.message)); };
        worker.postMessage(message);
      });
      try {
        await request({ type: 'backend', semantic: 'cpu', onnx: backend, threads: 2, parallelSemantic: false });
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(bytes), c => c.charCodeAt(0))]));
        const side = 320, canvas = new OffscreenCanvas(side, side), ctx = canvas.getContext('2d');
        const scale = side / Math.max(bitmap.width, bitmap.height), w = bitmap.width * scale, h = bitmap.height * scale;
        ctx.drawImage(bitmap, (side - w) / 2, (side - h) / 2, w, h); bitmap.close();
        const rgba = new Uint8Array(ctx.getImageData(0, 0, side, side).data.buffer);
        let settings = { ...defaults, filter: 'both', automaticGender: false, hair: false, imageExpansion: 2,
          imageBodyRegionMode: mode, debugOverlay: true, imageFemaleAllowedRegions: [], imageMaleAllowedRegions: [] };
        if (diagram) {
          const uniform = action => ({ skin: Object.fromEntries(regions.map(area => [area, action])), otherSkin: action,
            hair: action, face: action === 'hide' ? 'black' : 'show', video: action === 'hide' ? 'black' : 'show' });
          settings = { ...settings, imageExpansion: 24, personPolicies: { female: uniform('hide'), male: uniform('show') } };
          settings.personPolicies.male.skin.thighs = 'hide';
        }
        const key = { mediaSessionId: 'body-regions-' + mode, epoch: 1, sequence: 1 };
        const fresh = (await request({ type: 'analyze', frame: { key, kind: 'image', capturedAtMs: Date.now(), width: side, height: side, rgba: rgba.slice() }, settings })).result;
        const masked = r => r.rgbaMask.filter((v, i) => i % 4 === 3 && v > 0).length;
        if (diagram) {
          let thighs = fresh;
          for (const track of fresh.tracks) thighs = (await request({ type: 'label', key, trackId: track.id, label: 'male', settings })).result;
          settings.personPolicies = structuredClone(settings.personPolicies); settings.personPolicies.male.skin.thighs = 'show'; settings.revision++;
          const shown = (await request({ type: 'settings', key, settings })).result;
          settings.personPolicies = structuredClone(settings.personPolicies); settings.personPolicies.male.face = 'blur'; settings.revision++;
          const blur = (await request({ type: 'settings', key, settings })).result;
          for (const track of fresh.tracks) await request({ type: 'label', key, trackId: track.id, label: 'female', settings });
          const mixed = (await request({ type: 'label', key, trackId: fresh.tracks[0].id, label: 'male', settings })).result;
          settings.personPolicies = structuredClone(settings.personPolicies);
          settings.personPolicies.female.face = 'blur'; settings.personPolicies.female.faceStrength = 14;
          settings.personPolicies.male.faceStrength = 38; settings.revision++;
          const strengths = (await request({ type: 'settings', key, settings })).result;
          const brief = r => ({ masked: masked(r), diagnostics: r.bodyRegionDiagnostics,
            faces: r.faceLayers?.map(layer => ({ kind: layer.effect.kind, intensity: layer.effect.intensity, pixels: layer.alpha.filter(Boolean).length })) ?? [], timings: r.timingsMs });
          return { people: fresh.tracks.length, thighs: brief(thighs), shown: brief(shown), blur: brief(blur), mixed: brief(mixed), strengths: brief(strengths) };
        }
        if (failure) return { diagnostics: fresh.bodyRegionDiagnostics, masked: masked(fresh), timings: fresh.timingsMs };
        if (backend === 'webgpu') {
          const warm = [];
          for (let i = 0; i < 3; i++) {
            const changed = rgba.slice(); changed[0] ^= i + 1; // Bypass image reuse while keeping the fixture visually identical.
            const result = (await request({ type: 'analyze', frame: { key: { ...key, sequence: i + 2 }, kind: 'image', capturedAtMs: Date.now(), width: side, height: side, rgba: changed }, settings })).result;
            warm.push({ diagnostics: result.bodyRegionDiagnostics, timings: result.timingsMs });
          }
          return { fresh: { diagnostics: fresh.bodyRegionDiagnostics, timings: fresh.timingsMs }, warm };
        }
        settings = { ...settings, imageMaleAllowedRegions: regions, revision: 1 };
        let allowed = fresh;
        for (const track of fresh.tracks) allowed = (await request({ type: 'label', key, trackId: track.id, label: 'male', settings })).result;
        settings = { ...settings, imageMaleAllowedRegions: [], revision: 2 };
        const blocked = (await request({ type: 'settings', key, settings })).result;
        settings = { ...settings, imageFemaleAllowedRegions: regions, revision: 3 };
        let female = blocked;
        for (const track of fresh.tracks) female = (await request({ type: 'label', key, trackId: track.id, label: 'female', settings })).result;
        const adopted = (await request({ type: 'reuse-image', key: { mediaSessionId: 'duplicate-' + mode, epoch: 1, sequence: 1 }, fromKey: key, settings })).result;
        const inferredDuplicate = (await request({ type: 'analyze', frame: { key: { mediaSessionId: 'inferred-duplicate-' + mode, epoch: 1, sequence: 1 }, kind: 'image', capturedAtMs: Date.now(), width: side, height: side, rgba: rgba.slice() }, settings })).result;
        const video = (await request({ type: 'analyze', frame: { key: { mediaSessionId: 'video-' + mode, epoch: 1, sequence: 1 }, kind: 'video', capturedAtMs: Date.now(), width: side, height: side, rgba: rgba.slice() }, settings: { ...settings, yoloVideoSize: 320 } })).result;
        const noSkinKey = { mediaSessionId: 'skin-disabled-' + mode, epoch: 1, sequence: 1 };
        const skinDisabled = (await request({ type: 'analyze', frame: { key: noSkinKey, kind: 'image', capturedAtMs: Date.now(), width: side, height: side, rgba: rgba.slice() }, settings: { ...settings, bodySkin: false } })).result;
        const disabled = (await request({ type: 'settings', key: noSkinKey, settings: { ...settings, bodySkin: false, imageBodyRegionMode: 'off' } })).result;
        const brief = r => ({ masked: masked(r), diagnostics: r.bodyRegionDiagnostics, timings: r.timingsMs });
        return { fresh: { ...brief(fresh), regions: [...new Set(fresh.debugBodyRegions?.labels ?? [])], people: fresh.tracks.length },
          maleAllowed: brief(allowed), blocked: brief(blocked), femaleAllowed: brief(female), adopted: brief(adopted), inferredDuplicate: brief(inferredDuplicate),
          video: { ...brief(video), hasPartDebug: !!video.debugBodyRegions }, skinDisabled: brief(skinDisabled), disabled: brief(disabled) };
      } finally { worker.terminate(); }
    };
  }, { defaults: DEFAULT_SETTINGS, regions: BODY_REGIONS, bytes });
  const output = {};
  // Test missing weights before any BodyPix resource can enter the browser cache.
  const target = resolve(root, 'dist/models/bodypix-mobilenet075-stride16-257.onnx');
  const saved = resolve(profile, 'bodypix-probe-saved.onnx');
  assert(target.startsWith(resolve(root, 'dist') + sep) && saved.startsWith(profile + sep));
  await rename(target, saved);
  try {
    const r = await page.evaluate(() => window.runBodyRegionProbe('faster', true));
    assert.equal(r.diagnostics.status, 'fallback'); assert(r.diagnostics.error); assert.equal(r.diagnostics.allowedSkinPixels, 0); assert(r.masked > 0);
    output.failure = r;
  } finally { await rename(saved, target); }
  for (const mode of ['faster', 'finer']) {
    const r = await page.evaluate(mode => window.runBodyRegionProbe(mode), mode);
    assert.equal(r.fresh.diagnostics.status, 'ready'); assert.equal(r.fresh.diagnostics.backend, 'wasm');
    assert.equal(r.fresh.diagnostics.stride, mode === 'faster' ? 16 : 8);
    assert(r.fresh.timings.bodyRegionRun > 0); assert(r.fresh.people > 0); assert(r.fresh.regions.some(id => id > 0));
    assert(r.maleAllowed.diagnostics.allowedSkinPixels > 0); assert(r.maleAllowed.masked < r.fresh.masked);
    assert.equal(r.blocked.diagnostics.allowedSkinPixels, 0); assert(r.blocked.masked > r.maleAllowed.masked);
    assert.equal(r.blocked.timings.bodyRegionRun, 0); assert.equal(r.blocked.diagnostics.status, 'cache');
    assert(r.femaleAllowed.diagnostics.allowedSkinPixels > 0);
    assert.equal(r.adopted.diagnostics.status, 'cache'); assert.equal(r.adopted.timings.bodyRegions, 0);
    assert.equal(r.inferredDuplicate.diagnostics.status, 'cache'); assert.equal(r.inferredDuplicate.timings.bodyRegions, 0); assert.equal(r.inferredDuplicate.timings.bodyRegionBackend, 'cache');
    assert.equal(r.video.diagnostics.status, 'skipped-video'); assert.equal(r.video.timings.bodyRegions, 0); assert.equal(r.video.hasPartDebug, false);
    assert.equal(r.skinDisabled.diagnostics.status, 'skipped-no-skin'); assert.equal(r.skinDisabled.timings.bodyRegions, 0);
    assert.equal(r.disabled.diagnostics.status, 'disabled'); assert.equal(r.disabled.diagnostics.model, 'off'); assert.equal(r.disabled.timings.bodyRegionBackend, 'disabled');
    output[mode] = r;
  }
  output.webgpu = {};
  for (const mode of ['faster', 'finer']) {
    const r = await page.evaluate(mode => window.runBodyRegionProbe(mode, false, 'webgpu'), mode);
    assert.equal(r.fresh.diagnostics.status, 'ready');
    assert(['webgpu', 'wasm'].includes(r.fresh.diagnostics.backend), 'GPU preference must work or fall back to WASM');
    for (const warm of r.warm) { assert.equal(warm.diagnostics.status, 'ready'); assert(warm.timings.bodyRegionRun > 0); }
    output.webgpu[mode] = r;
  }
  output.diagram = await page.evaluate(() => window.runBodyRegionProbe('finer', false, 'wasm', true));
  assert(output.diagram.people > 0);
  assert.equal(output.diagram.shown.masked, 0, 'Show all must remove body/hair borders at maximum expansion');
  assert.equal(output.diagram.shown.faces.length, 0, 'Show all must leave faces visible');
  assert(output.diagram.blur.faces.some(layer => layer.kind === 'blur' && layer.pixels > 0));
  assert.equal(output.diagram.blur.timings.bodyRegionRun, 0, 'Face/region edits reuse saved inference');
  assert(output.diagram.mixed.faces.some(layer => layer.kind === 'black' && layer.pixels > 0));
  assert(output.diagram.mixed.faces.some(layer => layer.kind === 'blur' && layer.pixels > 0));
  assert.deepEqual(output.diagram.strengths.faces.map(layer => layer.intensity).sort((a,b) => a-b),[14,38]);
  assert.equal(output.diagram.strengths.timings.bodyRegionRun,0,'Independent face strength edits reuse inference');
  await writeFile(resolve(cache, 'body-regions-browser.json'), JSON.stringify(output, null, 2));
  console.log('PASS: both packaged BodyPix variants on CPU and GPU preference, male/female allowlists, live cached policy edits, duplicates, image-only inference, conservative model-failure fallback.');
} finally {
  await context?.close();
  if (!profile.startsWith(cache + sep) || !profile.split(sep).at(-1).startsWith('body-regions-profile-')) throw Error('Unsafe profile cleanup');
  await rm(profile, { recursive: true, force: true });
}
