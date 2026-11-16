// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import ts from 'typescript';
const root=process.cwd(),cache=resolve('.cache');await mkdir(cache,{recursive:true});const profile=await mkdtemp(resolve(cache,'rules-probe-'));
const code=ts.transpileModule(await readFile('src/config/settings.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {DEFAULT_SETTINGS,BODY_REGIONS}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
let context;
try{
 context=await chromium.launchPersistentContext(profile,{headless:true,channel:'chromium',args:[`--disable-extensions-except=${resolve('dist')}`,`--load-extension=${resolve('dist')}`]});
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),page=await context.newPage();await page.goto(new URL('popup.html',sw.url()).href);
 const report=await page.evaluate(async({defaults,regions,bytes})=>{
  const worker=new Worker(chrome.runtime.getURL('worker.js'));
  const request=message=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Rule probe timed out')),120000);worker.onmessage=({data})=>{if(!['result','error'].includes(data.type))return;clearTimeout(timer);data.type==='error'?reject(Error(data.message)):resolve(data);};worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message));};worker.postMessage(message);});
  try{
   worker.postMessage({type:'backend',semantic:'gpu',onnx:'webgpu',threads:2,parallelSemantic:false});
   const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))])),side=256,canvas=new OffscreenCanvas(side,side),ctx=canvas.getContext('2d');
   const scale=side/Math.max(bitmap.width,bitmap.height),w=bitmap.width*scale,h=bitmap.height*scale;ctx.drawImage(bitmap,(side-w)/2,(side-h)/2,w,h);bitmap.close();
   const uniform=()=>({skin:Object.fromEntries(regions.map(area=>[area,'show'])),hair:'show',otherSkin:'show',face:'show',video:'show',partThresholds:[{area:'chest',conditions:[{areas:regions,operator:'any',percent:0},{areas:['torso'],operator:'at-least',percent:0}],match:'all',percent:0,effect:'smart',target:'body',face:'show'}]});
   const settings={...defaults,yoloImageSize:256,automaticGender:false,filter:'both',fabricFill:false,imageExpansion:0,imageBodyRegionMode:'faster',personPolicies:{female:uniform(),male:uniform()}},key={mediaSessionId:'rules-real-model',epoch:1,sequence:1};
   const fresh=(await request({type:'analyze',settings,frame:{key,kind:'image',capturedAtMs:Date.now(),width:side,height:side,rgba:new Uint8Array(ctx.getImageData(0,0,side,side).data)}})).result;
   for(const policy of Object.values(settings.personPolicies)){policy.partThresholds[0].conditions[1].operator='above';policy.partThresholds[0].conditions[1].percent=100;}
   const negative=(await request({type:'settings',key,settings})).result;
   for(const policy of Object.values(settings.personPolicies)){policy.partThresholds[0].conditions[1].operator='at-least';policy.partThresholds[0].conditions[1].percent=0;}
   settings.personPolicies.female.partThresholds[0].effect=settings.personPolicies.male.partThresholds[0].effect='black';
   const black=(await request({type:'analyze',settings,frame:{key,kind:'image',capturedAtMs:Date.now(),width:side,height:side,rgba:new Uint8Array(ctx.getImageData(0,0,side,side).data)}})).result;
   for(const policy of Object.values(settings.personPolicies))policy.partThresholds[0].enabled=false;
   const disabled=(await request({type:'analyze',settings,frame:{key,kind:'image',capturedAtMs:Date.now(),width:side,height:side,rgba:new Uint8Array(ctx.getImageData(0,0,side,side).data)}})).result;
   return {hair:fresh.blackMask?.filter(Boolean).length??0,negative:negative.smartCoverMask?.filter(Boolean).length??0,tracks:fresh.tracks.length,smart:fresh.smartCoverMask?.filter(Boolean).length??0,rgb:fresh.clothingRgb?.length??0,black:black.blackMask?.filter(Boolean).length??0,blackSmart:black.smartCoverMask?.filter(Boolean).length??0,disabled:disabled.smartCoverMask?.filter(Boolean).length??0,disabledBlack:disabled.blackMask?.filter(Boolean).length??0,reused:black.timingsMs?.person};
  }finally{worker.terminate();}
 },{defaults:DEFAULT_SETTINGS,regions:BODY_REGIONS,bytes:(await readFile('tests/fixtures/bus.jpg')).toString('base64')});
 assert(report.tracks>0);assert(report.hair>0,JSON.stringify(report));assert.equal(report.negative,0);assert(report.smart>0,JSON.stringify(report));assert.equal(report.rgb,256*256*4);assert(report.black>0);assert.equal(report.blackSmart,0);assert.equal(report.disabled,0);assert.equal(report.disabledBlack,0);
 console.log('PASS: real models produce smart clothing with fabric off, forced black and clean disabled-rule results.',JSON.stringify(report));
}finally{await context?.close();assert(profile.startsWith(cache+sep));await rm(profile,{recursive:true,force:true});}
