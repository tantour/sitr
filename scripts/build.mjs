import { build } from 'vite';
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';

const root = process.cwd();
const out = resolve(root, 'dist');
if (!out.startsWith(root + sep)) throw new Error('Build output must stay inside the workspace');
const artifacts = JSON.parse(await readFile(resolve(root, 'models/artifacts.json'), 'utf8'));
for (const artifact of artifacts.artifacts) {
  const bytes = await readFile(resolve(root, 'models', artifact.name));
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== artifact.sha256) throw new Error(`Model SHA-256 mismatch: ${artifact.name}`);
}
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
for (const file of ['manifest.json', 'offscreen.html', 'motion.html', 'popup.html', 'NOTICE.md', 'README.md', 'BENCHMARK.md']) await cp(resolve(root, file), resolve(out, file));
await mkdir(resolve(out, 'models'), { recursive: true });
await mkdir(resolve(out, 'wasm'), { recursive: true });
for (const file of ['yolo26n-seg-256.onnx', 'yolo26n-seg-320.onnx', 'yolo26n-seg-416.onnx', 'selfie_multiclass_256x256.tflite', 'yunet-2026may.onnx', 'fastface-large-128.onnx']) {
  await cp(resolve(root, 'models', file), resolve(out, 'models', file));
}
await cp(resolve(root, 'models/artifacts.json'), resolve(out, 'models/artifacts.json'));
const ortFiles = ['ort-wasm-simd-threaded.jsep.wasm', 'ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.mjs'];
for (const file of ortFiles) await cp(resolve(root, 'node_modules/onnxruntime-web/dist', file), resolve(out, 'wasm', file));
const mpFiles = ['vision_wasm_internal.wasm', 'vision_wasm_internal.js', 'vision_wasm_nosimd_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_module_internal.wasm', 'vision_wasm_module_internal.js'];
for (const file of mpFiles) await cp(resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm', file), resolve(out, 'wasm', file));
const manifest = JSON.parse(await readFile(resolve(out, 'manifest.json'), 'utf8'));
await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
