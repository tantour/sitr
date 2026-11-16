// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import ts from 'typescript';
const root=process.cwd(),cache=resolve('.cache');await mkdir(cache,{recursive:true});const profile=await mkdtemp(resolve(cache,'hair-smoothing-'));
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
   const uniform=()=>({skin:Object.fromEntries(regions.map(area=>[area,'show'])),hair:'hide',otherSkin:'show',face:'show',video:'show'});
   const settings={...defaults,yoloImageSize:256,automaticGender:false,filter:'both',fabricFill:false,imageExpansion:0,personPolicies:{female:uniform(),male:uniform()}},key={mediaSessionId:'hair-shape',epoch:1,sequence:1};
   const fresh=(await request({type:'analyze',settings,frame:{key,kind:'image',capturedAtMs:Date.now(),width:side,height:side,rgba:new Uint8Array(ctx.getImageData(0,0,side,side).data)}})).result;
   const before=Uint8Array.from({length:side*side},(_,p)=>fresh.rgbaMask[p*4+3]),after=fresh.blackMask;
   if(!after)throw Error('Smoothed hair layer missing');
   let exposed=0,fringe=0;for(let p=0;p<before.length;p++){if(before[p]&&after[p]<before[p])exposed++;if(after[p]>0&&after[p]<255)fringe++;}
   const preview=new OffscreenCanvas(side*2,side+28),out=preview.getContext('2d');out.fillStyle='white';out.fillRect(0,0,preview.width,preview.height);out.font='14px Arial';out.fillStyle='black';out.fillText('Previous detailed outline',8,19);out.fillText('Rounded opaque hair mask',side+8,19);
   for(const [index,alpha]of [before,after].entries()){
     out.drawImage(canvas,index*side,28);const layer=new OffscreenCanvas(side,side),lc=layer.getContext('2d'),pixels=new ImageData(side,side);for(let p=0;p<alpha.length;p++)pixels.data[p*4+3]=alpha[p];lc.putImageData(pixels,0,0);out.drawImage(layer,index*side,28);
   }
   for(const policy of Object.values(settings.personPolicies))policy.hair='show';
   const shown=(await request({type:'settings',key,settings})).result;
   return{tracks:fresh.tracks.length,before:before.filter(Boolean).length,after:after.filter(Boolean).length,exposed,fringe,shown:shown.blackMask?.filter(Boolean).length??0,png:Array.from(new Uint8Array(await(await preview.convertToBlob({type:'image/png'})).arrayBuffer()))};

  }finally{worker.terminate();}
 },{defaults:DEFAULT_SETTINGS,regions:BODY_REGIONS,bytes:(await readFile('tests/fixtures/woman-profile.jpg')).toString('base64')});
 assert(report.before>0);assert(report.after>report.before);assert.equal(report.exposed,0);assert(report.fringe>0);assert.equal(report.shown,0);
 const {png,...metrics}=report;await writeFile(resolve(cache,'hair-smoothing.png'),Buffer.from(png));
 console.log('PASS: real-model hair has a larger smooth black envelope, no reduced coverage, feathered exterior and a working Show choice.',JSON.stringify(metrics));
}finally{await context?.close();assert(profile.startsWith(cache+sep));await rm(profile,{recursive:true,force:true});}
