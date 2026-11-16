// SPDX-License-Identifier: AGPL-3.0-only
import {chromium} from 'playwright';import {createServer} from 'node:http';import {readFile,mkdir,mkdtemp,rm} from 'node:fs/promises';import {resolve,sep} from 'node:path';import assert from 'node:assert/strict';
const cache=resolve('.cache');await mkdir(cache,{recursive:true});const profile=await mkdtemp(resolve(cache,'animation-grid-'));
const files={gif:await readFile('tests/fixtures/gif-animated.gif'),webp:await readFile('tests/fixtures/webp-animated.webp')};
const server=createServer((req,res)=>{const ext=req.url.split('?')[0].split('.').at(-1);if(files[ext]){res.setHeader('content-type','image/'+ext);res.end(files[ext]);return;}res.setHeader('content-type','text/html');res.end('<!doctype html><style>main{display:grid;grid-template-columns:repeat(4,120px);gap:8px}img{width:120px;height:160px}</style><main>'+Array.from({length:8},(_,i)=>`<img id="tile${i}" src="/animation.${i%2?'webp':'gif'}?tile=${i}">`).join('')+'</main>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));let context;
try{
 context=await chromium.launchPersistentContext(profile,{headless:true,channel:'chromium',args:[`--disable-extensions-except=${resolve('dist')}`,`--load-extension=${resolve('dist')}`]});
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),ui=await context.newPage();await ui.goto(new URL('popup.html',sw.url()).href);
 await ui.evaluate(()=>chrome.runtime.sendMessage({type:'set-settings',patch:{images:true,videos:true,automaticGender:false,filter:'both',videoDetector:'fast-box'}}));
 const page=await context.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/');
 const states=()=>page.evaluate(()=>[...document.images].map(i=>({id:i.id,kind:i.dataset.localMediaCensorKind,sequence:Number(i.dataset.localMediaCensorSequence||0),pending:i.hasAttribute('data-local-media-censor-pending'),status:i.dataset.localMediaCensorStatus})));
 await page.waitForFunction(()=>[...document.images].length===8&&[...document.images].every(i=>Number(i.dataset.localMediaCensorSequence)>0&&!i.hasAttribute('data-local-media-censor-pending')),null,{timeout:45000}).catch(async e=>{console.log(await states());throw e;});
 const before=await states();await page.waitForTimeout(1800);const after=await states();
 const playing=after.filter((s,i)=>s.sequence>before[i].sequence).length;assert(playing>0&&playing<=2,'Keep the active animation limit while showing analyzed previews for every tile');
 assert(after.every(s=>!s.pending));assert(after.some(s=>s.kind==='webp-video'));assert(after.some(s=>s.kind==='gif-video'));
 console.log('PASS: all 8 mixed GIF/WebP tiles have analyzed visible previews; '+playing+' animate concurrently.');
}finally{await context?.close();await new Promise(r=>server.close(r));assert(profile.startsWith(cache+sep));await rm(profile,{recursive:true,force:true});}
