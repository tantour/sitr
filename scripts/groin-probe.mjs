// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'vite';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const root = process.cwd(), cache = resolve(root, '.cache');
await mkdir(cache, { recursive: true });
const profile = await mkdtemp(resolve(cache, 'groin-profile-'));
const bundle = await build({ configFile: false, publicDir: false, logLevel: 'error',
  resolve: { conditions: ['onnxruntime-web-use-extern-wasm'] },
  build: { write: false, target: 'chrome148', minify: true,
    lib: { entry: resolve('scripts/groin-probe-entry.ts'), name: 'GroinProbe', formats: ['iife'] },
    rollupOptions: { output: { inlineDynamicImports: true } } } });
// Reference points were placed on the fully clothed photographs before model
// inference. Bus coordinates refer to the upstream 810×1080 photograph.
const fixtures = [
  { name: 'standing-man', file: 'bus.jpg', crop: [50, 390, 205, 530], points: [[132, 720], [175, 745], [145, 620]] },
  { name: 'crossed-legs-man', file: 'bus.jpg', crop: [220, 395, 140, 465], points: [[280, 718], [300, 740], [292, 600]] },
  { name: 'seated-man', file: 'man-seated.jpg', points: [[214, 431], [270, 470], [212, 290]] },
  { name: 'multiple-men', file: 'bus.jpg', points: [[132, 720], [280, 718]] },
  { name: 'torso-crop-man', file: 'man-profile.jpg', points: [] },
];
let context;
try {
  context = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`, '--use-angle=d3d11'] });
  const sw = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const page = await context.newPage(); await page.goto(new URL('popup.html', sw.url()).href);
  await page.evaluate((Array.isArray(bundle) ? bundle[0] : bundle).output.find(item => item.type === 'chunk').code);
  const results = [];
  for (const mode of ['faster', 'finer']) for (const fixture of fixtures) for (const mirror of [false, true]) {
    const bytes = (await readFile(resolve('tests/fixtures', fixture.file))).toString('base64');
    const result = await page.evaluate(args => globalThis.groinProbe(args), { ...fixture, bytes, mode, mirror, backend: 'wasm' });
    const { png, ...metrics } = result;
    await writeFile(resolve(cache, `groin-${fixture.name}-${mode}${mirror ? '-mirror' : ''}.png`), Buffer.from(png));
    results.push({ fixture: fixture.name, mode, mirror, ...metrics });
    assert.equal(result.clothingLabelled, 0, 'Actual skin decoder must leave every clothing pixel unlabelled');
    if (fixture.name === 'torso-crop-man') assert.equal(result.groinPixels, 0, 'No fabricated pelvis on a torso-only crop');
    console.log(JSON.stringify(results.at(-1)));
  }
  await writeFile(resolve(cache, 'groin-model-results.json'), JSON.stringify(results, null, 2));
  // Anatomical checks on the current models, kept separate from integration.
  for (const result of results.filter(r => r.fixture === 'standing-man' || r.fixture === 'seated-man' ||
    r.fixture === 'crossed-legs-man' && r.mode === 'finer')) {
    assert(result.people > 0); assert(result.groinPixels > 0);
    assert(result.sample[0].counts[9] >= 13, 'Clothed pelvic landmark must lie predominantly in the groin region');
    // Damage in the old seated photograph can erase foreground on one mirrored
    // thigh. Keep that uncertainty explicit rather than inventing a known part.
    if (result.fixture === 'seated-man' && result.mode === 'finer' && result.mirror)
      assert.equal(result.sample[1].label, 0, 'Missing foreground must remain unknown');
    else assert.equal(result.sample[1].label, 5, 'Thigh landmark must be separate from torso');
    assert.equal(result.sample[2].label, 1, 'Chest must remain torso');
  }
  console.log('PASS: clothed male anatomy probes, mirrors, both variants, clothing exclusion and crop abstention.');
} finally {
  await context?.close();
  if (!profile.startsWith(cache + sep) || !profile.split(sep).at(-1).startsWith('groin-profile-')) throw Error('Unsafe profile cleanup');
  await rm(profile, { recursive: true, force: true });
}
