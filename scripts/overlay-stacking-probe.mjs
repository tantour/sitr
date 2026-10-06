// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { build } from 'vite';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

const bundle = await build({ configFile: false, publicDir: false, logLevel: 'silent',
  build: { write: false, target: 'chrome148', lib: { entry: resolve('src/rendering/overlay.ts'),
    name: 'OverlayProbe', formats: ['iife'] } } });
const code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(item => item.type === 'chunk').code;
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end(`<!doctype html><style>
    body{margin:0;min-height:2000px} header{position:fixed;top:0;left:0;width:100%;height:60px;background:white;z-index:20}
    .card{position:relative;margin-top:100px;width:300px;height:300px} img{width:300px;height:300px}
    button{position:absolute;top:100px;left:20px;z-index:2}
    </style><header id="header">Navigation</header><div class="card"><img id="photo"
    src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Crect width='300' height='300' fill='red'/%3E%3C/svg%3E"><button id="control">Save photo</button></div>`);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.addScriptTag({ content: code });
  await page.evaluate(async () => {
    const image = document.querySelector('#photo'); await image.decode();
    window.overlay = new OverlayProbe.Overlay(image);
    const rgbaMask = new Uint8Array(8 * 8 * 4);
    for (let i = 3; i < rgbaMask.length; i += 4) rgbaMask[i] = 255;
    overlay.set({ width: 8, height: 8, rgbaMask, black: false });
    overlay.setPointerInput(true); // Hit testing checks paint order, including the mask.
  });
  await page.evaluate(() => window.scrollTo(0, 80));
  await page.waitForTimeout(100);
  const state = await page.evaluate(() => {
    const image = document.querySelector('#photo'), canvas = overlay.canvas;
    const a = image.getBoundingClientRect(), b = canvas.getBoundingClientRect();
    const button = document.querySelector('#control').getBoundingClientRect();
    return { aboveHeader: document.elementFromPoint(30, 30)?.id,
      aboveControl: document.elementFromPoint(button.x + 5, button.y + 5)?.id,
      aligned: Math.abs(a.top - b.top) < 1 && Math.abs(a.left - b.left) < 1 };
  });
  console.log(state);
  if (state.aboveHeader !== 'header' || state.aboveControl !== 'control' || !state.aligned) {
    throw new Error('Mask covers page UI or fails to follow the image while scrolling');
  }
  await page.evaluate(() => { document.querySelector('#photo').remove(); overlay.draw(); });
  await page.waitForTimeout(100);
  if (await page.evaluate(() => overlay.canvas.isConnected && getComputedStyle(overlay.canvas).display !== 'none')) {
    throw new Error('Detached media left a visible orphan mask');
  }
} finally { await browser.close(); server.close(); }
