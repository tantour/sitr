import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const clip = await readFile(resolve(root, 'tests/fixtures/bus.mp4'));
const server = createServer((request, response) => {
  if (request.url === '/bus.mp4') { response.writeHead(200, { 'content-type': 'video/mp4' }); response.end(clip); return; }
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end('<video id="clip" muted autoplay loop playsinline width="640" height="360" src="/bus.mp4"></video>');
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const profile = await mkdtemp(resolve(tmpdir(), 'motion-probe-'));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForTimeout(3000);
  const host = page.frames().find(frame => frame.url().endsWith('/motion.html'));
  console.log(JSON.stringify({ host: host ? await host.evaluate(() => ({ ...document.body.dataset })) : null,
    video: await page.locator('#clip').evaluate(video => ({ ...video.dataset })), errors }, null, 2));
} finally {
  await browser?.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
