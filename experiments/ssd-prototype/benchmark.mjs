import { createServer } from 'vite';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, appType: 'mpa' });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  browser = await chromium.launch({ headless: true, channel: 'chromium' });
  const page = await browser.newPage();
  page.on('pageerror', error => console.error('PAGE ERROR:', error));
  await page.goto(`http://127.0.0.1:${address.port}/experiments/ssd-prototype/index.html`);
  const input = { base64: (await readFile('tests/fixtures/bus.jpg')).toString('base64'), count: 40 };
  for (const delegate of process.env.DETECT_ONLY === '1' ? [] : ['CPU', 'GPU']) {
    try {
      const result = await page.evaluate(async options => {
        while (!window.runProbe) await new Promise(resolve => setTimeout(resolve, 20));
        return window.runProbe(options);
      }, { ...input, delegate });
      const sorted = result.timings.toSorted((a, b) => a - b);
      console.log(JSON.stringify({ delegate, initializedMs: result.initializedMs,
        medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.floor(sorted.length * .95)],
        detections: result.detections }));
    } catch (error) { console.error(`${delegate} failed:`, error); }
  }
  try {
    const result = await page.evaluate(async options => {
      while (!window.runDetectProbe) await new Promise(resolve => setTimeout(resolve, 20));
      return window.runDetectProbe(options);
    }, input);
    const sorted = result.timings.toSorted((a, b) => a - b);
    console.log(JSON.stringify({ delegate: 'YOLO-detect WebGPU', medianMs: sorted[Math.floor(sorted.length / 2)],
      p95Ms: sorted[Math.floor(sorted.length * .95)], candidates: result.candidates }));
  } catch (error) { console.error('YOLO-detect failed:', error); }
} finally { await browser?.close(); await server.close(); }
