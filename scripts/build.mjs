// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { build } from 'vite';
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { verifyModels } from './models.mjs';
import { dependencyNotices } from './dependency-notices.mjs';

const root = process.cwd();
const out = resolve(root, 'dist');
if (!out.startsWith(root + sep)) throw new Error('Build output must stay inside the workspace');
await verifyModels();
await dependencyNotices();
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const [name, entry, formats] of [
  ['background', 'src/background/index.ts', ['es']],
  ['offscreen', 'src/offscreen/index.ts', ['es']],
  ['worker', 'src/workers/index.ts', ['iife']],
  ['motion-worker', 'src/media/motionWorker.ts', ['iife']],
  ['semantic-worker', 'src/vision/semanticWorker.ts', ['iife']],
  ['motion-host', 'src/media/motionHost.ts', ['iife']],
  ['person-runtime', 'src/vision/personRuntime.ts', ['es']],
  ['content', 'src/content/index.ts', ['iife']],
  ['popup', 'src/ui/popup.ts', ['es']],
]) {
  await build({
    configFile: false,
    publicDir: false,
    resolve: { conditions: ['onnxruntime-web-use-extern-wasm'] },
    build: {
      outDir: out,
      emptyOutDir: false,
      target: 'chrome148',
      minify: 'esbuild',
      lib: { entry: resolve(root, entry), name: name === 'content' ? 'LocalMediaCensor' : name === 'worker' ? 'LocalVisionWorker' : name === 'motion-worker' ? 'LocalMotionWorker' : name === 'semantic-worker' ? 'LocalSemanticWorker' : name === 'motion-host' ? 'LocalMotionHost' : undefined, formats, fileName: () => `${name}.js` },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
}
for (const file of ['manifest.json', 'offscreen.html', 'motion.html', 'popup.html', 'popup.css', 'LICENSE', 'NOTICE.md', 'PRIVACY.md', 'SOURCE.md', 'README.md', 'BENCHMARK.md']) await cp(resolve(root, file), resolve(out, file));
await cp(resolve(root, 'LICENSES'), resolve(out, 'LICENSES'), { recursive: true });
await cp(resolve(root, 'docs'), resolve(out, 'docs'), { recursive: true });
await mkdir(resolve(out, 'icons'), { recursive: true });
for (const size of [16, 32, 48, 128]) await cp(resolve(root, 'icons', `sitr-${size}.png`), resolve(out, 'icons', `sitr-${size}.png`));
await cp(resolve(root, 'icons/sitr-logo.png'), resolve(out, 'icons/sitr-logo.png'));
await mkdir(resolve(out, 'models'), { recursive: true });
await mkdir(resolve(out, 'wasm'), { recursive: true });
for (const file of ['yolo26n-seg-256.onnx', 'yolo26n-seg-320.onnx', 'yolo26n-seg-416.onnx',
  'yolo26n-det-256.onnx', 'yolo26n-det-256-gpu.onnx', 'selfie_multiclass_256x256.tflite', 'yunet-2026may.onnx', 'fastface-large-128.onnx',
  'body-intel-0230.onnx', 'body-paddle-pplcnet.onnx']) {
  await cp(resolve(root, 'models', file), resolve(out, 'models', file));
}
for (const size of [256, 320, 416]) await cp(resolve(root, 'models', `yolo26n-seg-${size}-gpu.onnx`), resolve(out, 'models', `yolo26n-seg-${size}-gpu.onnx`));
await cp(resolve(root, 'models/artifacts.json'), resolve(out, 'models/artifacts.json'));
await cp(resolve(root, 'models/README.md'), resolve(out, 'models/README.md'));
const ortFiles = ['ort-wasm-simd-threaded.jsep.wasm', 'ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.mjs'];
for (const file of ortFiles) await cp(resolve(root, 'node_modules/onnxruntime-web/dist', file), resolve(out, 'wasm', file));
const mpFiles = ['vision_wasm_internal.wasm', 'vision_wasm_internal.js', 'vision_wasm_nosimd_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_module_internal.wasm', 'vision_wasm_module_internal.js'];
for (const file of mpFiles) await cp(resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm', file), resolve(out, 'wasm', file));
const manifest = JSON.parse(await readFile(resolve(out, 'manifest.json'), 'utf8'));
await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
