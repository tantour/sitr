// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import ts from 'typescript';
const root=process.cwd(),cache=resolve('.cache');await mkdir(cache,{recursive:true});const profile=await mkdtemp(resolve(cache,'small-image-probe-'));
const code=ts.transpileModule(await readFile('src/config/settings.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {DEFAULT_SETTINGS,BODY_REGIONS}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
let context;
try{
 context=await chromium.launchPersistentContext(profile,{headless:true,channel:'chromium',args:[`--disable-extensions-except=${resolve('dist')}`,`--load-extension=${resolve('dist')}`]});
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),page=await context.newPage();await page.goto(new URL('popup.html',sw.url()).href);
 const report=await page.evaluate(async({defaults,regions,bytes})=>{
  const worker=new Worker(chrome.runtime.getURL('worker.js'));
  const request=message=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Small image probe timed out')),120000);worker.onmessage=({data})=>{if(!['result','error'].includes(data.type))return;clearTimeout(timer);data.type==='error'?reject(Error(data.message)):resolve(data);};worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message));};worker.postMessage(message);});
  try{
   worker.postMessage({type:'backend',semantic:'gpu',onnx:'webgpu',threads:2,parallelSemantic:false});
   const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))])),side=256,canvas=new OffscreenCanvas(side,side),ctx=canvas.getContext('2d');
   const scale=side/Math.max(bitmap.width,bitmap.height),w=bitmap.width*scale,h=bitmap.height*scale;ctx.drawImage(bitmap,(side-w)/2,(side-h)/2,w,h);bitmap.close();
   const tiny=new OffscreenCanvas(65,50),tinyContext=tiny.getContext('2d');tinyContext.drawImage(canvas,0,0,side,side,0,0,65,50);
   ctx.clearRect(0,0,side,side);const factor=side/65;ctx.drawImage(tiny,0,(side-50*factor)/2,side,50*factor);
   const pixels=new Uint8Array(ctx.getImageData(0,0,side,side).data),uniform=()=>({skin:Object.fromEntries(regions.map(area=>[area,'hide'])),hair:'show',otherSkin:'hide',face:'show',video:'show'});
   const settings={...defaults,yoloImageSize:256,automaticGender:false,filter:'both',fabricFill:false,imageExpansion:0,thumbnailFallback:true,personPolicies:{female:uniform(),male:uniform()}},key={mediaSessionId:'tiny-real-model',epoch:1,sequence:1};
   const frame={key,kind:'image',nativeWidth:65,nativeHeight:50,capturedAtMs:Date.now(),width:side,height:side,rgba:pixels};
   const fresh=(await request({type:'analyze',settings,frame})).result;
   settings.thumbnailFallback=false;const off=(await request({type:'settings',key,settings})).result;
   settings.thumbnailFallback=true;
   for(const policy of Object.values(settings.personPolicies)){policy.skin=Object.fromEntries(regions.map(area=>[area,'show']));policy.otherSkin='show';policy.partThresholds=[{area:'chest',percent:100,target:'part'}];}
   const conditional=(await request({type:'settings',key,settings})).result;
   return{tracks:fresh.tracks.length,fallbacks:fresh.thumbnailFallbacks,covered:fresh.rgbaMask.filter((v,i)=>i%4===3&&v).length,off:off.thumbnailFallbacks,conditional:conditional.thumbnailFallbacks};

  }finally{worker.terminate();}
 },{defaults:DEFAULT_SETTINGS,regions:BODY_REGIONS,bytes:(await readFile('tests/fixtures/bus.jpg')).toString('base64')});
 assert(report.tracks>0);assert(report.fallbacks>0,JSON.stringify(report));assert(report.covered>0);assert.equal(report.off,0);assert.equal(report.conditional,0);
 console.log('PASS: tiny-image fallback, off switch and conditional-rule isolation through the real model worker.',JSON.stringify(report));
}finally{await context?.close();assert(profile.startsWith(cache+sep));await rm(profile,{recursive:true,force:true});}
