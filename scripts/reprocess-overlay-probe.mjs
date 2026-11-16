// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
const photo=await readFile('tests/fixtures/bus.jpg'),cache=resolve('.cache');await mkdir(cache,{recursive:true});
const profile=await mkdtemp(resolve(cache,'reprocess-overlay-'));
const server=createServer((req,res)=>{if(req.url.startsWith('/photo')){res.setHeader('content-type','image/jpeg');res.end(photo);}else{res.setHeader('content-type','text/html');res.end('<img id="photo" width="240" height="320" src="/photo.jpg">');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let context;
try{
 context=await chromium.launchPersistentContext(profile,{headless:true,channel:'chromium',args:[`--disable-extensions-except=${resolve('dist')}`,`--load-extension=${resolve('dist')}`]});
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),ui=await context.newPage();await ui.goto(new URL('popup.html',sw.url()).href);
 await ui.waitForFunction(()=>!document.body.classList.contains('loading'));
 await ui.evaluate(()=>chrome.runtime.sendMessage({type:'set-settings',patch:{images:true,automaticGender:false,filter:'both',fabricFill:true,imageCoverage:'whole-body'}}));
 await ui.waitForFunction(async()=>(await chrome.runtime.sendMessage({type:'engine-status'})).ready,null,{timeout:180000});
 const page=await context.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
 const ready=()=>page.waitForFunction(()=>!!document.querySelector('#photo').dataset.localMediaCensorSequence&&!document.querySelector('#photo').hasAttribute('data-local-media-censor-pending'));
 await ready();
 await page.evaluate(()=>{
  window.pendingSamples=[];
  window.overlayPixels=()=>{const canvas=document.querySelector('canvas[data-local-media-censor-overlay]'),ctx=canvas?.getContext('2d');if(!ctx)return{alpha:0,color:0};const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let alpha=0,color=0;for(let i=0;i<data.length;i+=4)if(data[i+3]){alpha++;if(data[i]||data[i+1]||data[i+2])color++;}return{alpha,color};};
  new MutationObserver(()=>{if(document.querySelector('#photo').hasAttribute('data-local-media-censor-pending'))window.pendingSamples.push(window.overlayPixels());}).observe(document.querySelector('#photo'),{attributes:true,attributeFilter:['data-local-media-censor-pending']});
 });
 assert((await page.evaluate(()=>window.overlayPixels())).color>0,'Start with visible smart clothing');
 for(const patch of [{imageExpansion:2},{fabricFill:false},{fabricFill:true}]){
  const previous=await page.evaluate(()=>window.pendingSamples.length);
  await ui.evaluate(patch=>chrome.runtime.sendMessage({type:'set-settings',patch}),patch);
  await page.waitForFunction(previous=>window.pendingSamples.length>previous,previous);await ready();
  assert((await page.evaluate(()=>window.overlayPixels())).alpha>0,'Fresh mask returns after blackout');
 }
 const samples=await page.evaluate(()=>window.pendingSamples);assert(samples.length>=3);assert(samples.every(sample=>sample.alpha===0),'Old clothing must disappear during every pending blackout');
 assert((await page.evaluate(()=>window.overlayPixels())).color>0,'Smart clothing returns after processing');
 console.log('PASS: image blackout clears old fabric immediately for cached and fresh analysis; completed clothing returns.');
}finally{await context?.close();await new Promise(resolve=>server.close(resolve));assert(profile.startsWith(cache+sep));await rm(profile,{recursive:true,force:true});}
