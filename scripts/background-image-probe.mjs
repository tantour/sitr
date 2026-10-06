// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const photo = await readFile(resolve('tests/fixtures/bus.jpg'));
const server = createServer((request, response) => {
  response.setHeader('content-type', request.url === '/photo.jpg' ? 'image/jpeg' : 'text/html');
  response.end(request.url === '/photo.jpg' ? photo : `<!doctype html>
    <style>
      .photo { background-image:url('/photo.jpg'); background-size:cover; background-position:25% 70%; }
      .tile { display:inline-block; width:240px; height:210px; vertical-align:top; }
      .empty { background-image:linear-gradient(red, blue); }
    </style>
    <div id="class" class="tile photo"><button id="button">Still clickable</button></div>
    <div id="inline" class="tile" style="background-image:url('/photo.jpg') !important;background-size:contain;background-repeat:no-repeat"></div>
    <div id="multiple" class="tile" style="background-image:linear-gradient(transparent,transparent),url('/photo.jpg'),url('/photo.jpg');background-size:40px 50px;background-repeat:repeat"></div>
    <div id="later" class="photo" style="width:200px;height:200px;margin-top:10000px"></div>`);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const profile = await mkdtemp(resolve(tmpdir(), 'background-image-'));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { headless:true, channel:'chromium',
    viewport:{width:1100,height:800},
    args:[`--disable-extensions-except=${resolve('dist')}`,`--load-extension=${resolve('dist')}`] });
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
  await worker.evaluate(async () => {
    const current = (await chrome.storage.local.get('settings')).settings || {};
    await chrome.storage.local.set({settings:{...current,filter:'both',automaticGender:false,revision:(current.revision||0)+1}});
  });
  const page = await browser.newPage();
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(()=>['class','inline','multiple'].every(id=>document.getElementById(id).dataset.localMediaCensorBackground==='protected'),undefined,{timeout:90000});
  const state=await page.evaluate(async()=>{
    const element=document.getElementById('class'), css=getComputedStyle(element);
    const url=/url\("([^"]+)"\)/.exec(css.backgroundImage)[1];
    const count=async url=>{
      const bitmap=await createImageBitmap(await (await fetch(url)).blob());
      const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
      const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
      let black=0;for(let i=0;i<data.length;i+=4)if(data[i]===0&&data[i+1]===0&&data[i+2]===0&&data[i+3]===255)black++;
      return black;
    };
    return {masked:await count(url),original:await count('/photo.jpg'),size:css.backgroundSize,position:css.backgroundPosition,
      multiple:getComputedStyle(document.getElementById('multiple')).backgroundImage,
      offscreen:document.getElementById('later').dataset.localMediaCensorBackground};
  });
  assert(state.masked>state.original,'Background must contain actual censor pixels');
  assert.equal(state.size,'cover');assert.equal(state.position,'25% 70%');
  assert.equal((state.multiple.match(/blob:/g)||[]).length,2);assert(state.multiple.includes('linear-gradient'));
  assert.equal(state.offscreen,'pending');
  // Discovery must reach a newly inserted background before its first paint,
  // including one behind more nodes than fit in a single discovery batch.
  const firstPaint = await page.evaluate(async()=>{
    const wrapper=document.createElement('div');
    for(let i=0;i<450;i++) wrapper.append(document.createElement('span'));
    const image=document.createElement('div'); image.id='late-background';
    image.style.cssText='width:200px;height:100px;background-image:url(/photo.jpg)';wrapper.append(image);
    document.body.prepend(wrapper);
    return await new Promise(resolve=>requestAnimationFrame(()=>resolve(image.dataset.localMediaCensorBackground)));
  });
  assert(firstPaint==='pending'||firstPaint==='protected','A newly inserted background must not paint before protection');
  const beforeDebug=await page.locator('#class').evaluate(element=>element.style.backgroundImage);
  await worker.evaluate(async()=>{
    const current=(await chrome.storage.local.get('settings')).settings;
    await chrome.storage.local.set({settings:{...current,debugOverlay:true,revision:current.revision+1}});
  });
  await page.waitForFunction(before=>{
    const image=document.getElementById('class');
    return image.dataset.localMediaCensorBackground==='protected'&&image.style.backgroundImage!==before;
  },beforeDebug,{timeout:60000});
  const debugPixels=await page.locator('#class').evaluate(async element=>{
    const url=/url\("([^"]+)"\)/.exec(element.style.backgroundImage)[1];
    const bitmap=await createImageBitmap(await(await fetch(url)).blob());
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]===255&&pixels[i+1]===194&&pixels[i+2]===71)count++;
    return count;
  });
  assert(debugPixels>100,'Debug mode must paint colored person outlines and labels into CSS backgrounds');
  await page.locator('#button').click();
  await page.locator('#class').evaluate(element=>element.className='tile empty');
  await page.waitForFunction(()=>!document.getElementById('class').hasAttribute('data-local-media-censor-background'));
  await page.locator('#class').evaluate(element=>element.className='tile photo');
  await page.waitForFunction(()=>document.getElementById('class').dataset.localMediaCensorBackground==='protected');
  await worker.evaluate(async()=>{
    const current=(await chrome.storage.local.get('settings')).settings;
    await chrome.storage.local.set({settings:{...current,images:false,revision:current.revision+1}});
  });
  await page.waitForFunction(()=>!document.getElementById('inline').hasAttribute('data-local-media-censor-background'));
  const restored=await page.locator('#inline').evaluate(element=>({value:element.style.backgroundImage,priority:element.style.getPropertyPriority('background-image')}));
  assert(restored.value.includes('/photo.jpg'));assert.equal(restored.priority,'important');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,...state,firstPaint,debugPixels,restored},null,2));
} finally {
  await browser?.close();server.close();await rm(profile,{recursive:true,force:true});
}
