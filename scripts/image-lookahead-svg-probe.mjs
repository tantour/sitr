// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { chromium } from 'playwright';
import { transform } from 'esbuild';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import assert from 'node:assert/strict';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><style>rect{fill:#e74b21}</style><rect width="120" height="80"/></svg>';
const photo = await readFile(resolve('tests/fixtures/bus.jpg'));
const html = `<!doctype html><style>body{margin:0;height:5000px}img,.background{position:absolute;width:120px;height:80px}</style>
<script>window.events=[];new MutationObserver(records=>{for(const record of records){const node=record.target;
if(node.id)events.push({id:node.id,status:node.dataset.localMediaCensorStatus,time:performance.now()});}})
.observe(document,{subtree:true,attributes:true,attributeFilter:['data-local-media-censor-status']});</script>
<img id="visible" style="top:0" src="/photo.jpg?visible">
<img id="svg" style="top:0;left:150px" src="/logo.svg">
<img id="svg-cross" style="top:100px" src="CROSS_ORIGIN">
<img id="svg-data" style="top:100px;left:150px" src="data:image/svg+xml,${encodeURIComponent(svg)}">
<div id="svg-background" class="background" style="top:200px;background-image:url('/logo.svg')"></div>
<img id="below" style="top:800px" src="/photo.jpg?below">
<img id="next" loading="lazy" style="top:1500px" src="/photo.jpg?next">
<img id="far" style="top:2500px" src="/photo.jpg?far">`;
const images = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'image/svg+xml' }); response.end(svg);
});
await new Promise(done => images.listen(0, '127.0.0.1', done));
const server = createServer((request, response) => {
  if (request.url.startsWith('/photo.jpg')) {
    response.writeHead(200, { 'content-type': 'image/jpeg' }); response.end(photo);
  } else if (request.url === '/logo.svg') {
    response.writeHead(200, { 'content-type': 'image/svg+xml' }); response.end(svg);
  } else {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(html.replace('CROSS_ORIGIN', `http://127.0.0.1:${images.address().port}/logo.svg`));
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const root = await mkdtemp(resolve(tmpdir(), 'image-lookahead-svg-'));
const extension = resolve(root, 'extension');
let browser;
try {
  await cp(resolve('dist'), extension, { recursive: true });
  // Use deterministic delayed model results to test scheduler order and real
  // acquisition/SVG rendering without variable GPU compilation or detections.
  await writeFile(resolve(extension, 'offscreen.js'), `
const sessions=new Map();let active=0,maxActive=0;
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message.type==='probe-stats'){reply({maxActive});return false;}
  if(message.type==='prepare-engine'){reply({ok:true});return false;}
  if(message.type==='reset-session'){sessions.delete(message.mediaSessionId);reply({ok:true});return false;}
  if(message.type==='analyze'){
    active++;maxActive=Math.max(maxActive,active);
    setTimeout(()=>{const frame=message.frame;const result={key:frame.key,width:frame.width,height:frame.height,
      capturedAtMs:frame.capturedAtMs,analyzedAtMs:Date.now(),settingsRevision:message.settings.revision,
      black:false,reason:'clear',rgbaMask:new Uint8Array(frame.width*frame.height*4),tracks:[]};
      sessions.set(frame.key.mediaSessionId,result);active--;reply({ok:true,result});},350);return true;
  }
  if(message.type==='reuse-image'){
    const original=sessions.get(message.fromKey.mediaSessionId);
    if(!original){reply({ok:false,error:'Cached analysis unavailable'});return false;}
    const result={...original,key:message.key,settingsRevision:message.settings.revision};
    sessions.set(message.key.mediaSessionId,result);reply({ok:true,result});return false;
  }
  return false;
});`);
  browser = await chromium.launchPersistentContext(resolve(root, 'profile'), { headless: true, channel: 'chromium',
    viewport: { width: 900, height: 700 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => ['visible', 'svg', 'svg-cross', 'svg-data', 'below', 'next'].every(id => {
    const image = document.getElementById(id);
    return image.dataset.localMediaCensorSequence && !image.hasAttribute('data-local-media-censor-pending');
  }) && document.getElementById('svg-background').dataset.localMediaCensorBackground === 'protected',
  undefined, { timeout: 30000 });
  const events = await page.evaluate(() => window.events);
  const latestVisible = Math.max(...['visible', 'svg', 'svg-cross', 'svg-data'].map(id =>
    events.find(event => event.id === id && event.status === 'clear').time));
  const belowStarted = events.find(event => event.id === 'below' && event.status === 'analyzing');
  const nextStarted = events.find(event => event.id === 'next' && event.status === 'analyzing');
  const belowFinished = events.find(event => event.id === 'below' && event.status === 'clear');
  if (belowStarted.time < latestVisible) console.log('Scheduler events:', events);
  assert(belowStarted.time >= latestVisible, 'Look-ahead must wait until visible images finish');
  assert(nextStarted.time >= belowFinished.time, 'Off-screen images must run one at a time');
  assert.equal(await page.locator('#far').evaluate(image => image.dataset.localMediaCensorSequence), undefined,
    'Images outside the look-ahead limit must remain unprocessed');
  assert.equal(await page.locator('#next').getAttribute('loading'), 'lazy', 'An author lazy-loading hint must be restored');
  const baked = await page.locator('#svg-background').evaluate(async element => {
    const url = getComputedStyle(element).backgroundImage.slice(5, -2);
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const context=canvas.getContext('2d');context.drawImage(image,0,0);
    return Array.from(context.getImageData(20,20,1,1).data);
  });
  assert.deepEqual(baked, [231, 75, 33, 255], 'SVG background must show its original pixels');
  await page.evaluate(() => window.scrollTo(0, 800));
  assert(await page.locator('#below').evaluate(image => !image.hasAttribute('data-local-media-censor-pending')),
    'An image should already be ready when it scrolls into view');

  // Exercise SVG static validation in a real DOM/CSS parser, including formats
  // ImageDecoder cannot handle, and verify animated/malformed files are rejected.
  const bundled = await transform(await readFile(resolve('src/media/capture.ts'), 'utf8'), { loader: 'ts', format: 'iife', globalName: 'Capture' });
  await page.addScriptTag({ content: bundled.code });
  const samples = [svg,
    svg.replace('</svg>', '<animate attributeName="opacity" values="0;1" dur="1s" repeatCount="indefinite"/></svg>'),
    svg.replace('rect{fill:#e74b21}', '@keyframes pulse{to{opacity:0}}rect{animation:pulse 1s infinite}'),
    svg.replace('<rect ', '<rect style="animation: pulse 1s infinite" '),
    svg.replace('rect{fill:#e74b21}', '@import "extra.css";rect{fill:red}'), '<svg>broken'];
  const checks = await page.evaluate(async samples => Promise.all(samples.map(text => Capture.sourceIsStatic(new Blob([text], { type: 'image/svg+xml' })))), samples);
  assert.deepEqual(checks, [true, false, false, false, false, false]);
  console.log('PASS: bounded look-ahead waits for visible work and prepares scrolling; SVG images, data URLs, cross-origin files and CSS backgrounds render correctly.');
} finally {
  await browser?.close(); server.close(); images.close();
  if (!resolve(root).startsWith(`${resolve(tmpdir())}${sep}`)) throw new Error('Unsafe test cleanup path');
  await rm(root, { recursive: true, force: true });
}
