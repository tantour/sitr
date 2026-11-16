// SPDX-License-Identifier: AGPL-3.0-only
// Native tab lifecycle regression: raw CDP avoids automation focus emulation.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,mkdir} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const cache=resolve('.cache');await mkdir(cache,{recursive:true});
const photo=await readFile('tests/fixtures/bus.jpg'),video=await readFile('tests/fixtures/bus-long.mp4');let delayed=[],holdImages=true;
const server=createServer((req,res)=>{
 if(req.url==='/cover'){res.setHeader('content-type','text/html');res.end('<!doctype html><title>Other tab</title><body style="background:#fff">Foreground test tab</body>');return;}
 if(req.url.startsWith('/delayed')){res.setHeader('content-type','image/jpeg');if(holdImages)delayed.push(res);else res.end(photo);return;}
 if(req.url.startsWith('/photo')){res.setHeader('content-type','image/jpeg');res.end(photo);return;}
 if(req.url.startsWith('/video')){res.setHeader('content-type','video/mp4');res.end(video);return;}
 res.setHeader('content-type','text/html');res.end('<!doctype html><title>Tab resume regression</title><body><video id="clip" width="320" height="180" autoplay muted loop playsinline src="/video.mp4"></video><div id="images"><img id="settled" width="100" height="130" src="/photo.jpg?settled"></div></body>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const profile=await mkdtemp(resolve(cache,'tab-resume-'));
const proc=spawn(chromium.executablePath(),['--user-data-dir='+profile,'--remote-debugging-port=0','--window-position=100,100','--no-first-run','--no-default-browser-check','--disable-extensions-except='+resolve('dist'),'--load-extension='+resolve('dist'),'about:blank'],{windowsHide:true,stdio:'ignore'});
let socket,call;const pending=new Map();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
 let lines;for(let n=0;n<200;n++){try{lines=(await readFile(resolve(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');break;}catch{await sleep(50);}}
 assert(lines,'Chromium did not expose a test debugging endpoint');
 socket=new WebSocket('ws://127.0.0.1:'+lines[0]+lines[1]);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});let sequence=0;
 socket.onmessage=event=>{const data=JSON.parse(event.data),request=pending.get(data.id);if(request){pending.delete(data.id);data.error?request.reject(Error(JSON.stringify(data.error))):request.resolve(data.result);}};
 socket.onclose=()=>{for(const request of pending.values())request.reject(Error('Test browser closed'));pending.clear();};
 call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...sessionId?{sessionId}:{}}));});
 const evaluate=async(session,expression)=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},session);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async(session,expression,timeout=30000)=>{const start=Date.now();while(Date.now()-start<timeout){try{if(await evaluate(session,expression))return;}catch{}await sleep(100);}throw Error('Timed out: '+expression);};
 const attach=async targetId=>{const session=(await call('Target.attachToTarget',{targetId,flatten:true})).sessionId;await call('Runtime.enable',{},session);await call('Runtime.runIfWaitingForDebugger',{},session);return session;};
 let worker;
 for(let n=0;n<200&&!worker;n++){
  for(const target of (await call('Target.getTargets')).targetInfos.filter(t=>t.type==='service_worker'&&t.url.endsWith('/background.js'))){const session=await attach(target.targetId);try{if(await evaluate(session,"typeof chrome!=='undefined'&&chrome.runtime?.getManifest?.().name==='stir_beta'")){worker=session;break;}}catch{}}
  if(!worker)await sleep(100);
 }
 assert(worker,'stir_beta did not start');
 const extensionId=await evaluate(worker,'chrome.runtime.id');
 const ui=await attach((await call('Target.createTarget',{url:'chrome-extension://'+extensionId+'/popup.html'})).targetId);
 await wait(ui,"typeof chrome!=='undefined'&&!!chrome.runtime");
 await evaluate(ui,"chrome.runtime.sendMessage({type:'set-settings',patch:{enabled:true,images:true,videos:true,automaticGender:false,filter:'both',videoDetector:'fast-box',advancedVideoMode:true,fabricFill:true}})");
 await wait(ui,"chrome.runtime.sendMessage({type:'engine-status'}).then(s=>s?.ready)",180000);
 const created=await evaluate(ui,'chrome.tabs.create({url:'+JSON.stringify(origin)+',active:true})');
 let target;for(let n=0;n<100;n++){target=(await call('Target.getTargets')).targetInfos.find(t=>t.url.startsWith(origin));if(target)break;await sleep(50);}
 const page=await attach(target.targetId);await call('Page.enable',{},page);await call('Emulation.setFocusEmulationEnabled',{enabled:false},page);await wait(page,"document.readyState!=='loading'");
 await wait(page,"Number(document.querySelector('video')?.dataset.localMediaCensorSequence)>3",60000);
 await wait(page,"!!document.querySelector('#settled')?.dataset.localMediaCensorSequence&&!document.querySelector('#settled').hasAttribute('data-local-media-censor-pending')",30000);
 const settledSequence=await evaluate(page,"document.querySelector('#settled').dataset.localMediaCensorSequence");
 console.log('initial visibility',await evaluate(page,'document.visibilityState'));
 await evaluate(page,"(()=>{for(let i=0;i<3;i++){const img=new Image();img.width=100;img.height=130;img.id='late-'+i;img.src='/delayed.jpg?'+i;document.querySelector('#images').append(img);}})()");
 for(let n=0;n<100&&delayed.length<3;n++)await sleep(10);assert.equal(delayed.length,3);
 const cover=await evaluate(ui,'chrome.tabs.create({url:'+JSON.stringify(origin+'/cover')+',active:true,windowId:'+created.windowId+'})');
 const windowInfo=await call('Browser.getWindowForTarget',{targetId:target.targetId});await call('Browser.setWindowBounds',{windowId:windowInfo.windowId,bounds:{windowState:'minimized'}});
 await wait(page,'document.hidden',5000);console.log('hidden confirmed');
 // Reproduce a dropped renderer callback and a cached mask awaiting presentation.
 // Native callback handles belong to the media element across isolated worlds.
 await evaluate(page,"(()=>{const video=document.querySelector('video');for(let id=1;id<16384;id++)video.cancelVideoFrameCallback(id);document.querySelector('#settled').setAttribute('data-local-media-censor-pending','');})()");
 holdImages=false;for(const res of delayed)res.end(photo);delayed=[];await sleep(1500);
 await call('Browser.setWindowBounds',{windowId:windowInfo.windowId,bounds:{windowState:'normal'}});await evaluate(ui,'chrome.tabs.update('+created.id+',{active:true})');await wait(page,'!document.hidden',5000);
 const before=await evaluate(page,"Number(document.querySelector('video').dataset.localMediaCensorSequence)");
 await wait(page,"Number(document.querySelector('video').dataset.localMediaCensorSequence)>"+(before+3),12000);
 await wait(page,"[...document.querySelectorAll('#images img')].every(img=>img.dataset.localMediaCensorSequence&&!img.hasAttribute('data-local-media-censor-pending'))",30000);
 assert.equal(await evaluate(page,"document.querySelector('#settled').dataset.localMediaCensorSequence"),settledSequence,'Completed images must be re-presented without new inference');
 await evaluate(page,"(()=>{const img=new Image();img.id='new-content';img.width=100;img.height=130;img.src='/photo.jpg?new';document.querySelector('#images').append(img);})()");
 await wait(page,"!!document.querySelector('#new-content')?.dataset.localMediaCensorSequence",20000);
 // Repeat with a new decode completing during another hidden interval.
 holdImages=true;
 await evaluate(page,"(()=>{const img=new Image();img.id='second-cycle';img.width=100;img.height=130;img.src='/delayed.jpg?second-cycle';document.querySelector('#images').append(img);})()");
 for(let n=0;n<100&&delayed.length<1;n++)await sleep(10);assert(delayed.length>0);
 await evaluate(ui,'chrome.tabs.update('+cover.id+',{active:true})');
 await call('Browser.setWindowBounds',{windowId:windowInfo.windowId,bounds:{windowState:'minimized'}});
 await wait(page,'document.hidden',5000);holdImages=false;for(const res of delayed)res.end(photo);delayed=[];await sleep(1000);
 await call('Browser.setWindowBounds',{windowId:windowInfo.windowId,bounds:{windowState:'normal'}});
 await evaluate(ui,'chrome.tabs.update('+created.id+',{active:true})');await wait(page,'!document.hidden',5000);
 const again=await evaluate(page,"Number(document.querySelector('video').dataset.localMediaCensorSequence)");
 await wait(page,"Number(document.querySelector('video').dataset.localMediaCensorSequence)>"+(again+3),12000);
 await wait(page,"!!document.querySelector('#second-cycle')?.dataset.localMediaCensorSequence&&!document.querySelector('#second-cycle').hasAttribute('data-local-media-censor-pending')",30000);
 await evaluate(ui,'chrome.tabs.remove('+cover.id+')');
 console.log('PASS: two native hide/return cycles, dropped video callback recovery, cached-mask presentation, delayed images and new content without reload.');
}finally{
 for(const res of delayed)res.end(photo);
 if(call&&socket?.readyState===1)await call('Browser.close').catch(()=>{});socket?.close();proc.kill();await sleep(300);await new Promise(r=>server.close(r));
 assert(profile.startsWith(cache+sep)&&profile.split(sep).at(-1).startsWith('tab-resume-'));await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:100});
}
