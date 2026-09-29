import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const root = process.cwd();
const count = Number(process.env.PERF_COUNT || 24);
const repetitions = Number(process.env.PERF_REPETITIONS || 3);
const durationMinutes = Number(process.env.PERF_DURATION_MINUTES || 0);
if (!Number.isInteger(count) || count < 1 || count > 100 || !Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10 ||
    !Number.isFinite(durationMinutes) || durationMinutes < 0 || durationMinutes > 30) {
  throw new Error('PERF_COUNT must be 1–100, PERF_REPETITIONS must be 1–10, and PERF_DURATION_MINUTES must be 0–30');
}
const fixtureNames = ['bus.jpg', 'woman-profile.jpg', 'man-profile.jpg', 'lena.jpg'];
const fixtures = new Map(await Promise.all(fixtureNames.map(async name => [name, await readFile(resolve(root, 'tests/fixtures', name))])));
const server = createServer((request, response) => {
  const name = request.url?.slice(1);
  const fixture = fixtures.get(name);
  if (fixture) { response.writeHead(200, { 'content-type': 'image/jpeg' }); response.end(fixture); return; }
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end('<!doctype html><html><body style="margin:0"></body></html>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const profile = await mkdtemp(resolve(tmpdir(), 'local-media-censor-perf-'));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, {
    headless: true, channel: process.env.PERF_BROWSER === 'chrome' ? 'chrome' : 'chromium',
    viewport: { width: 1800, height: 3400 },
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`],
  });
  const page = await browser.newPage();
  if (process.env.PERF_THREADS && !['1', '2', '4', '6', '8', '12', '16'].includes(process.env.PERF_THREADS)) {
    throw new Error('PERF_THREADS must be 1, 2, 4, 6, 8, 12, or 16');
  }
  if (process.env.PERF_THREADS || process.env.PERF_SEMANTIC_PARALLEL === '1') {
    const extensionWorker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
    await extensionWorker.evaluate(async options => {
      if (options.threads) {
        const current = (await chrome.storage.local.get('settings')).settings || {};
        await chrome.storage.local.set({ settings: { ...current, onnxThreads: options.threads, revision: (current.revision || 0) + 1 } });
      }
      if (options.parallelSemantic) {
        if (!await chrome.offscreen.hasDocument()) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: [chrome.offscreen.Reason.WORKERS], justification: 'Browser performance comparison' });
        await chrome.runtime.sendMessage({ type: 'retry-engine', parallelSemantic: true });
      }
    }, { threads: Number(process.env.PERF_THREADS) || undefined,
      parallelSemantic: process.env.PERF_SEMANTIC_PARALLEL === '1' });
  }
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const samples = [];
  const benchmarkStarted = Date.now();
  for (let round = 0; durationMinutes ? (round === 0 || Date.now() - benchmarkStarted < durationMinutes * 60000) : round < repetitions; round++) {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const started = await page.evaluate(async ({ count, round, fixtureNames }) => {
      const sources = await Promise.all(fixtureNames.map(name => new Promise((done, fail) => {
        const image = new Image(); image.onload = () => done(image); image.onerror = fail; image.src = `/${name}`;
      })));
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(8,200px);gap:6px';
      for (let i = 0; i < count; i++) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 480;
        const ctx = canvas.getContext('2d');
        const source = sources[(round * count + i) % sources.length];
        const crop = Math.min(source.width, source.height);
        const x = Math.floor((source.width - crop) * ((i % 7) / 7));
        const y = Math.floor((source.height - crop) * ((i % 5) / 5));
        ctx.drawImage(source, x, y, crop, crop, 0, 0, 480, 480);
        ctx.fillStyle = `rgba(${(i * 53 + round * 17) % 255},20,40,.025)`;
        ctx.fillRect(0, 0, 480, 480);
        const image = document.createElement('img');
        image.id = `perf-${round}-${i}`;
        image.width = image.height = 200;
        image.src = canvas.toDataURL('image/jpeg', .85);
        grid.append(image);
      }
      document.body.append(grid);
      return performance.now();
    }, { count, round, fixtureNames });
    try {
      await page.waitForFunction(count => [...document.querySelectorAll('img[id^="perf-"]')].length === count &&
        [...document.querySelectorAll('img[id^="perf-"]')].every(img => img.dataset.localMediaCensorSequence && !img.hasAttribute('data-local-media-censor-pending')),
      count, { timeout: Number(process.env.PERF_TIMEOUT_MS) || Math.max(60000, count * 1500) });
    } catch (error) {
      const images = await page.evaluate(() => [...document.querySelectorAll('img[id^="perf-"]')].map(img => ({
        id: img.id, status: img.dataset.localMediaCensorStatus, pending: img.hasAttribute('data-local-media-censor-pending'),
        sequence: img.dataset.localMediaCensorSequence, timing: img.dataset.localMediaCensorTimingsMs,
      })));
      const extensionWorker = browser.serviceWorkers()[0];
      const offscreen = extensionWorker ? await extensionWorker.evaluate(() => chrome.offscreen.hasDocument()) : undefined;
      throw new Error(`Photo grid did not finish: ${JSON.stringify({ images, errors, offscreen, serviceWorkers: browser.serviceWorkers().map(worker => worker.url()) })}`, { cause: error });
    }
    const result = await page.evaluate(started => ({
      elapsedMs: Math.round(performance.now() - started),
      images: [...document.querySelectorAll('img[id^="perf-"]')].map(image => ({
        revealMs: Number(image.dataset.localMediaCensorRevealMs),
        acquireMs: Number(image.dataset.localMediaCensorAcquireMs),
        timings: JSON.parse(image.dataset.localMediaCensorTimingsMs || '{}'),
        status: image.dataset.localMediaCensorStatus,
      })),
    }), started);
    const sorted = result.images.map(image => image.revealMs).sort((a, b) => a - b);
    samples.push({ round: round + 1, count, elapsedMs: result.elapsedMs,
      imagesPerSecond: Math.round(count * 1000 / result.elapsedMs * 100) / 100,
      p50RevealMs: sorted[Math.floor(sorted.length * .5)], p95RevealMs: sorted[Math.floor(sorted.length * .95)],
      cached: result.images.filter(image => image.timings.backend === 'cache').length,
      threads: [...new Set(result.images.map(image => image.timings.onnxThreads).filter(Boolean))],
      meanStagesMs: Object.fromEntries(['acquire', 'queue', 'personRun', 'personDecode', 'semantic', 'semanticRun', 'face', 'faceRun', 'gender', 'genderRun', 'composition', 'render']
        .map(key => [key, Math.round(result.images.reduce((sum, image) => sum + (image.timings[key] || 0), 0) / count)])),
      statuses: [...new Set(result.images.map(image => image.status))],
    });
    if (process.env.PERF_THREADS && samples.at(-1).threads.some(value => value !== Number(process.env.PERF_THREADS))) {
      throw new Error(`Requested ${process.env.PERF_THREADS} threads, observed ${samples.at(-1).threads.join(', ')}`);
    }
    console.log(JSON.stringify(samples.at(-1)));
  }
  if (errors.length) throw new Error(`Browser page errors: ${errors.join('; ')}`);
  if (durationMinutes) {
    const batchMs = samples.reduce((sum, sample) => sum + sample.elapsedMs, 0);
    console.log(JSON.stringify({ rounds: samples.length, images: samples.length * count, batchMs,
      imagesPerSecond: Math.round(samples.length * count * 1000 / batchMs * 100) / 100,
      minBatchImagesPerSecond: Math.min(...samples.map(sample => sample.imagesPerSecond)),
      maxBatchImagesPerSecond: Math.max(...samples.map(sample => sample.imagesPerSecond)),
      cached: samples.reduce((sum, sample) => sum + sample.cached, 0) }));
  } else console.log(JSON.stringify({ samples }, null, 2));
} finally {
  await browser?.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
