// SPDX-License-Identifier: AGPL-3.0-only
import {chromium} from 'playwright';import {createServer} from 'node:http';
import {readFile,mkdir,mkdtemp,rm} from 'node:fs/promises';import {resolve,sep} from 'node:path';import assert from 'node:assert/strict';
const cache=resolve('.cache');await mkdir(cache,{recursive:true});const profile=await mkdtemp(resolve(cache,'image-preview-'));
const photo=await readFile('tests/fixtures/bus.jpg');
const server=createServer((req,res)=>{
 if(req.url.includes('.jpg')){const send=()=>{res.setHeader('content-type','image/jpeg');res.end(photo);};if(req.url.includes('slow'))setTimeout(send,1200);else send();return;}
 if(process.env.SITR_PREVIEW_STRICT_CSP==='1')res.setHeader('content-security-policy',"style-src-elem 'none'; style-src-attr 'unsafe-inline'");
 res.setHeader('content-type','text/html');res.end('<!doctype html><style>img{width:220px;height:290px;object-fit:contain}</style><img id="preview" style="filter:contrast(.9)" src="/bus.jpg?first">');
});await new Promise(r=>server.listen(0,'127.0.0.1',r));let context;
try{
 context=await chromium.launchPersistentContext(profile,{headless:true,channel:'chromium',args:[`--disable-extensions-except=${resolve('dist')}`,`--load-extension=${resolve('dist')}`]});
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),ui=await context.newPage();await ui.goto(new URL('popup.html',sw.url()).href);await ui.evaluate(()=>chrome.runtime.sendMessage({type:'set-settings',patch:{images:true,automaticGender:false,filter:'both'}}));
 const page=await context.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/');
 const ready=(expected='')=>page.waitForFunction(expected=>{const i=document.querySelector('#preview');return (i?.currentSrc||'').includes(expected)&&i?.complete&&i.dataset.localMediaCensorSequence&&!i.hasAttribute('data-local-media-censor-pending')&&getComputedStyle(i).filter!=='brightness(0)';},expected,{timeout:45000});
 await ready();
 await page.evaluate(()=>{const thumb=document.querySelector('#preview').cloneNode();thumb.id='pending';thumb.src='/slow.jpg';document.body.append(thumb);});
 await page.waitForFunction(()=>document.querySelector('#pending').hasAttribute('data-local-media-censor-pending'));
 await page.evaluate(()=>{const clone=document.querySelector('#pending').cloneNode();clone.id='preview';clone.src='/bus.jpg?cloned';document.querySelector('#preview').replaceWith(clone);document.querySelector('#pending').remove();});
 await ready();assert((await page.locator('#preview').evaluate(i=>i.style.filter)).includes('contrast'),'Preview cloned the pending blackout as its original filter');
 // Google copies just cssText into its new high-resolution image, stripping
 // extension data attributes. The stylesheet shield must not enter that cssText.
 await page.evaluate(()=>{const thumb=new Image();thumb.id='style-source';thumb.style.cssText='width:220px;height:290px;filter:contrast(.85)!important';thumb.src='/slow.jpg?style-source';document.body.append(thumb);});
 await page.waitForFunction(()=>document.querySelector('#style-source').hasAttribute('data-local-media-censor-pending'));
 const copied=await page.evaluate(()=>{const thumb=document.querySelector('#style-source');const state={inline:thumb.style.filter,pendingOpacity:getComputedStyle(thumb).opacity};const img=new Image();img.id='preview';img.src='/bus.jpg?style-copy';img.style.cssText=thumb.style.cssText;document.querySelector('#preview').replaceWith(img);thumb.remove();return state;});
 assert.equal(copied.inline,'contrast(0.85)','Image blackout leaked into copied inline styles');assert.equal(copied.pendingOpacity,'0','Important page filters must not defeat pending protection');
 await ready('style-copy');assert.equal(await page.locator('#preview').evaluate(i=>getComputedStyle(i).filter),'contrast(0.85)');

 for(let n=0;n<3;n++){await page.locator('#preview').evaluate((i,n)=>{i.src='/bus.jpg?selection='+n;},n);await ready('selection='+n);}
 // Hide the image after acquisition but before cached-result adoption returns.
 await page.evaluate(()=>{const i=document.querySelector('#preview');const observer=new MutationObserver(()=>{observer.disconnect();i.style.display='none';i.dataset.probeHidden='yes';const adopted=new MutationObserver(()=>{adopted.disconnect();i.dataset.probeAccepted='yes';});adopted.observe(i,{attributes:true,attributeFilter:['data-local-media-censor-sequence']});});observer.observe(i,{attributes:true,attributeFilter:['data-local-media-censor-acquire-ms']});i.src='/bus.jpg?hidden-adoption';});
 await page.waitForFunction(()=>{const i=document.querySelector('#preview');return i.dataset.probeHidden==='yes'&&i.dataset.probeAccepted==='yes'&&i.hasAttribute('data-local-media-censor-pending');},null,{timeout:15000}).catch(async error=>{console.log(await page.locator('#preview').evaluate(i=>({src:i.currentSrc,style:i.style.cssText,data:{...i.dataset},pending:i.hasAttribute('data-local-media-censor-pending')})));throw error;});
 await page.locator('#preview').evaluate(i=>i.style.display='block');await ready();
 console.log('PASS: pending-thumbnail clones, Google-style cssText-only preview copies, important page filters, repeated sidebar selections, and hidden-result recovery.');
}finally{await context?.close();await new Promise(r=>server.close(r));assert(profile.startsWith(cache+sep));await rm(profile,{recursive:true,force:true});}
