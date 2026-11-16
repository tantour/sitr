// SPDX-License-Identifier: AGPL-3.0-only
// Actual playing-video benchmark; warmup excluded, packaged backends preserved.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import ts from 'typescript';

const root = process.cwd(), cache = resolve(root, '.cache');
await mkdir(cache, { recursive: true });
const profile = await mkdtemp(resolve(cache, 'advanced-performance-'));
const duration = Number(process.env.SITR_PERF_DURATION_MS ?? 12000);
assert(Number.isFinite(duration) && duration >= 1000 && duration <= 300000, 'Benchmark duration must be 1000–300000 ms');
const source = ts.transpileModule(await readFile('src/config/settings.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { BODY_REGIONS } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const bytes = await readFile('tests/fixtures/bus-long.mp4');
const motionSource = process.env.SITR_PERF_SOURCE === 'motion';
const photo = await readFile('tests/fixtures/bus.jpg');
const motionHtml = `<!doctype html><video id="clip" width="640" height="480" autoplay muted playsinline></video><script>
const image=new Image();image.src='/photo.jpg';image.onload=()=>{
const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const ctx=canvas.getContext('2d');
const draw=t=>{ctx.fillStyle='#000';ctx.fillRect(0,0,640,480);ctx.drawImage(image,Math.sin(t/1400)*8-10,-10,660,500);requestAnimationFrame(draw);};
requestAnimationFrame(draw);clip.srcObject=canvas.captureStream(60);clip.play();};</script>`;
const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': request.url === '/video.mp4' ? 'video/mp4' : request.url === '/photo.jpg' ? 'image/jpeg' : 'text/html' });
  response.end(request.url === '/video.mp4' ? bytes : request.url === '/photo.jpg' ? photo : motionSource ? motionHtml : '<!doctype html><video id="clip" width="640" height="480" autoplay muted loop playsinline src="/video.mp4"></video>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let context;
try {
  context = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`] });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const ui = await context.newPage(); await ui.goto(new URL('popup.html', worker.url()).href);
  const gpu = await ui.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2', { powerPreference: 'high-performance' });
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unavailable';
  });
  await ui.locator('#saveStatus').filter({ hasText: 'Saved automatically' }).waitFor();
  const automaticGender = process.env.SITR_PERF_GENDER !== '0';
  const fabricFill = process.env.SITR_PERF_FABRIC === '1', advancedVideoMode = process.env.SITR_PERF_ADVANCED !== '0';
  const hideHair = process.env.SITR_PERF_HAIR === '1';
  await ui.evaluate(async ({ regions, automaticGender, fabricFill, advancedVideoMode, hideHair }) => {
    const policy = () => ({ skin: Object.fromEntries(regions.map(area => [area, 'hide'])), otherSkin: 'hide', hair: 'hide',
      face: 'show', video: 'black', videoSkin: 'hide', videoFace: 'show', videoHair: hideHair ? 'hide' : 'show' });
    await chrome.runtime.sendMessage({ type: 'set-settings', patch: { advancedVideoMode, automaticGender, fabricFill,
      images: false, videos: true, yoloVideoSize: 256, debugOverlay: false, personPolicies: { male: policy(), female: policy() } } });
  }, { regions: BODY_REGIONS, automaticGender, fabricFill, advancedVideoMode, hideHair });
  if (process.env.SITR_PERF_PARALLEL) await ui.evaluate(async () => chrome.runtime.sendMessage({ type: 'retry-engine', parallelSemantic: true }));
  await ui.waitForFunction(async () => (await chrome.runtime.sendMessage({ type: 'engine-status' }))?.ready, null, { timeout: 180000 });
  const results = [];
  for (const detector of process.env.SITR_PERF_DETECTOR ? [process.env.SITR_PERF_DETECTOR] : ['segment', 'fast-box']) {
    await ui.evaluate(async detector => chrome.runtime.sendMessage({ type: 'set-settings', patch: { videoDetector: detector } }), detector);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => Number(document.querySelector('video').dataset.localMediaCensorSequence) >= 3, null, { timeout: 60000 });
    const result = await page.evaluate(duration => new Promise(resolve => {
      const video = document.querySelector('video'), samples = [];
      let lastSequence;
      const started = performance.now(), presented = video.getVideoPlaybackQuality().totalVideoFrames;
      const errorsAtStart = Number(video.dataset.localMediaCensorVideoErrors || 0);
      let visibleSamples = 0, observations = 0,blackouts=0;
      const observer=new MutationObserver(records=>{for(const record of records)if(record.oldValue===null)blackouts++;});
      observer.observe(video,{attributes:true,attributeOldValue:true,attributeFilter:['data-local-media-censor-pending']});
      const timer = setInterval(() => {
        const sequence = Number(video.dataset.localMediaCensorSequence);
        observations++; if (!video.hasAttribute('data-local-media-censor-pending')) visibleSamples++;
        if (sequence !== lastSequence) {
          lastSequence = sequence;
          samples.push({ ...JSON.parse(video.dataset.localMediaCensorTimingsMs || '{}'), latency: Number(video.dataset.localMediaCensorLatencyMs),
            capture: Number(video.dataset.localMediaCensorCaptureMs) });
        }
        if (performance.now() - started < duration) return;
        clearInterval(timer);observer.disconnect();
        resolve({ elapsedMs: performance.now() - started, analyzed: Math.max(0, samples.length - 1), samples,
          presented: video.getVideoPlaybackQuality().totalVideoFrames - presented,
          blackouts,visibleFraction: visibleSamples / observations, newErrors: Number(video.dataset.localMediaCensorVideoErrors || 0) - errorsAtStart,
          status: video.dataset.localMediaCensorStatus, errors: video.dataset.localMediaCensorLastError });
      }, 10);
    }), duration);
    const metrics = {};
    for (const field of ['total', 'person', 'semantic', 'face', 'gender', 'render', 'composition', 'queue', 'capture', 'latency']) {
      const values = result.samples.map(sample => sample[field] ?? 0).sort((a, b) => a - b);
      metrics[field] = { mean: values.reduce((a, b) => a + b, 0) / values.length, p50: values[Math.floor(values.length / 2)], p95: values[Math.floor(values.length * .95)] };
    }
    const backends = [...new Set(result.samples.map(sample => `${sample.backend}/${sample.semanticBackend}/parallel=${sample.semanticParallel}`))];
    const semanticDevices = [...new Set(result.samples.map(sample => sample.semanticDevice).filter(Boolean))];
    assert.deepEqual(errors, []); assert(result.analyzed > 0);
    assert.equal(result.newErrors, 0, 'Video analysis must not accumulate errors during measurement');
    if (advancedVideoMode) assert(result.samples.every(sample => sample.semantic > 0), 'Each measured advanced update must include fresh segmentation');
    results.push({ detector, status: result.status, lastError: result.errors, newErrors: result.newErrors, blackouts:result.blackouts,visibleFraction: result.visibleFraction,
      cadenceReasons: Object.fromEntries([...new Set(result.samples.map(s => s.personCadence))].map(reason => [reason, result.samples.filter(s => s.personCadence === reason).length])),
      detectorFraction: result.samples.filter(sample => sample.person > 0).length / result.samples.length,
      faceCaptureFraction: result.samples.filter(sample => sample.faceCaptureSize > 0).length / result.samples.length,
      analyzedHz: 1000 * result.analyzed / result.elapsedMs, presentedHz: 1000 * result.presented / result.elapsedMs, backends, semanticDevices, metrics });
    await page.close();
  }
  const output = { measuredAt: new Date().toISOString(), gpu, automaticGender, fabricFill, advancedVideoMode, motionSource, durationMs: duration, results };
  console.log(JSON.stringify(output, null, 2));
  if (process.env.SITR_PERF_OUTPUT) {
    const target = resolve(root, process.env.SITR_PERF_OUTPUT);
    assert(target.startsWith(cache + sep), 'Benchmark output must stay inside .cache');
    await writeFile(target, JSON.stringify(output, null, 2));
  }
  if(process.env.SITR_PERF_MAX_BLACKOUTS)for(const result of results)assert(result.blackouts<=Number(process.env.SITR_PERF_MAX_BLACKOUTS),`${result.detector}: ${result.blackouts} playback blackouts`);
  if (process.env.SITR_PERF_MIN_HZ) for (const result of results) assert(result.analyzedHz >= Number(process.env.SITR_PERF_MIN_HZ), `${result.detector}: ${result.analyzedHz.toFixed(2)} fresh masks/s missed requested throughput`);
} finally {
  await context?.close(); await new Promise(done => server.close(done));
  assert(profile.startsWith(cache + sep) && profile.split(sep).at(-1).startsWith('advanced-performance-'));
  await rm(profile, { recursive: true, force: true });
}
