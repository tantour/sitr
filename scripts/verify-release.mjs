// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root, verifyModels } from './models.mjs';

export async function verifyRelease() {
  const directory = resolve(root, 'dist');
  const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  assert.equal(manifest.version, pkg.version, 'Package and extension versions differ');
  assert.equal(pkg.license, 'AGPL-3.0-only');
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, '148');
  assert.deepEqual(manifest.permissions, ['offscreen', 'storage']);
  assert.equal(manifest.message_serialization, 'structured_clone');
  assert(!manifest.content_security_policy.extension_pages.includes('http'), 'Remote scripts are forbidden');
  const required = [manifest.background.service_worker, manifest.action.default_popup,
    ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap(script => script.js),
    ...manifest.web_accessible_resources.flatMap(entry => entry.resources),
    'offscreen.js', 'worker.js', 'semantic-worker.js', 'person-runtime.js', 'popup.js', 'popup.css',
    'wasm/ort-wasm-simd-threaded.jsep.wasm', 'wasm/ort-wasm-simd-threaded.wasm',
    'wasm/ort-wasm-simd-threaded.jsep.mjs', 'wasm/ort-wasm-simd-threaded.mjs',
    'wasm/vision_wasm_internal.wasm', 'wasm/vision_wasm_internal.js',
    'wasm/vision_wasm_nosimd_internal.wasm', 'wasm/vision_wasm_nosimd_internal.js',
    'wasm/vision_wasm_module_internal.wasm', 'wasm/vision_wasm_module_internal.js',
    'LICENSE', 'NOTICE.md', 'PRIVACY.md', 'SOURCE.md', 'LICENSES/ONNX-Runtime-MIT.txt',
    'LICENSES/ONNX-Runtime-ThirdPartyNotices.txt', 'LICENSES/DEPENDENCIES.txt',
    'docs/images/popup.png', 'docs/images/popup-en-dark.png', 'docs/images/popup-ar-light.png',
    'docs/images/coverage-example.png', 'docs/images/settings-desktop.png'];
  for (const file of required) assert((await stat(resolve(directory, file))).size > 0, `Missing or empty ${file}`);
  await verifyModels(resolve(directory, 'models'));
  const expected = JSON.parse(await readFile(resolve(root, 'models/artifacts.json'), 'utf8'));
  for (const artifact of expected.artifacts) assert((await stat(resolve(directory, artifact.licenseFile))).size > 0,
    `Missing artifact license: ${artifact.name}`);
  assert.deepEqual(JSON.parse(await readFile(resolve(directory, 'models/artifacts.json'), 'utf8')), expected);
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = resolve(folder, entry.name);
      assert(!['.git', 'node_modules', '.env', '.cache'].includes(entry.name), `Private/build input in extension: ${path}`);
      assert(!/\.(pt|log|map|zip)$/i.test(entry.name), `Unexpected release file ${path}`);
      if (entry.isDirectory()) await walk(path);
    }
  }
  await walk(directory);
  console.log(`PASS: Sitr ${manifest.version}, packaged resources, model hashes, license texts, and release boundaries.`);
}
if (process.argv[1]?.endsWith('verify-release.mjs')) verifyRelease().catch(error => { console.error(error.message); process.exitCode = 1; });
