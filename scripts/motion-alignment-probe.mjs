// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import ts from 'typescript';
import {readFile,mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
const cache=resolve('.cache');await mkdir(cache,{recursive:true});
const profile=await mkdtemp(resolve(cache,'motion-alignment-'));
const compiled=ts.transpileModule(await readFile('src/media/frameMotionClient.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace('export class FrameMotion','window.ProbeMotion = class FrameMotion');
const guardCode=ts.transpileModule(await readFile('src/media/videoMaskFreshness.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace('export function videoMaskNeedsProtection','window.probeNeedsProtection=function').replace('export function videoMaskPadding','window.probePadding=function');
let context;
try{
 context=await chromium.launchPersistentContext(profile,{headless:true,channel:'chromium',args:[`--disable-extensions-except=${resolve('dist')}`,`--load-extension=${resolve('dist')}`]});
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),page=await context.newPage();
 await page.goto(new URL('popup.html',sw.url()).href);await page.evaluate(compiled);await page.evaluate('(()=>{'+guardCode+'})()');
 const report=await page.evaluate(async()=>{
  const side=384,canvas=document.createElement('canvas');canvas.width=canvas.height=side;
  const sampleCanvas=document.createElement('canvas');sampleCanvas.width=sampleCanvas.height=side;const sampleContext=sampleCanvas.getContext('2d',{willReadFrequently:true});
  const ctx=canvas.getContext('2d'),texture=document.createElement('canvas');texture.width=128;texture.height=192;
  const tc=texture.getContext('2d'),pixels=tc.createImageData(128,192);
  for(let p=0;p<128*192;p++){const bx=Math.floor((p%128)/8),by=Math.floor(Math.floor(p/128)/8),v=50+((bx*37+by*61+bx*by*7)%180);pixels.data.set([v,v,v,255],p*4);}tc.putImageData(pixels,0,0);
  const video=document.createElement('video');video.style.cssText='position:fixed;left:0;top:0;width:384px;height:384px;z-index:2147483647';video.muted=true;video.autoplay=true;video.srcObject=canvas.captureStream(60);document.body.append(video);
  const motion=new window.ProbeMotion(()=>{}),history=[],samples=[];let sequence=0,stopped=false,origin=performance.now();
  const box=(x)=>({x:x/side,y:90/side,width:128/side,height:192/side});
  let x=128,anchorX=x,anchorAt=0,lastAnchor=0,frames=0,held=0,activeAnchor;
  const draw=()=>{if(stopped)return;const t=performance.now()-origin;
   // Stationary warmup, then a quick walk with two direction changes.
   const phase=Math.max(0,frames-40)*.075;x=frames<40?128:128+85*Math.sin(phase);
   ctx.fillStyle='#c8c8c8';ctx.fillRect(0,0,side,side);ctx.drawImage(texture,x,90);ctx.fillStyle=`rgb(${Math.floor(t)%255},0,0)`;ctx.fillRect(0,0,4,4);requestAnimationFrame(draw);

  };draw();await video.play();
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Motion alignment timeout')),14000);
   const tick=()=>{if(stopped)return;const at=Date.now();frames++;
    sampleContext.drawImage(video,0,0);const row=sampleContext.getImageData(0,120,side,1).data;
    let visibleX=0;for(let i=0;i<side;i++)if(Math.abs(row[i*4]-200)>12){visibleX=i;break;}
    history.push({at,x:visibleX});if(history.length>180)history.shift();
    motion.observe(video,at);
    // Simulate delayed analysis results, rebasing the mask several times a second.
    if(at-lastAnchor>=85&&history.length>5){lastAnchor=at;const sample=history.reduce((best,s)=>Math.abs(at-65-s.at)<Math.abs(at-65-best.at)?s:best);anchorX=sample.x;anchorAt=sample.at;const anchor={key:{sequence:++sequence},capturedAtMs:anchorAt,tracks:[{id:'person',box:box(anchorX)}],trackMasks:[{id:'person'}]};motion.align(anchor);activeAnchor=anchor;}
    if(performance.now()-origin>1700&&anchorAt){const offset=motion.offsets(at).get('person');if(offset){
      const shield=window.probeNeedsProtection(activeAnchor,at,undefined,motion.canPropagate(activeAnchor,at),motion.trackingLost(activeAnchor));
      if(shield)held++;else {
        const margin=window.probePadding(activeAnchor,at,undefined,motion.canPropagate(activeAnchor,at),motion.trackingLost(activeAnchor))*192;
        samples.push(Math.max(0,Math.abs(anchorX+offset.x*side-visibleX)-margin));
      }
    }}
    if(performance.now()-origin>5700){stopped=true;clearTimeout(timeout);resolve();}else video.requestVideoFrameCallback(tick);
   };video.requestVideoFrameCallback(tick);
  });
  const error=motion.error,observed=motion.frames;motion.dispose();video.srcObject.getTracks().forEach(track=>track.stop());video.remove();
  samples.sort((a,b)=>a-b);return{held,visibleFraction:samples.length/(samples.length+held),frames,observed,error,samples:samples.length,mean:samples.reduce((a,b)=>a+b,0)/samples.length,p50:samples[Math.floor(samples.length*.5)],p95:samples[Math.floor(samples.length*.95)],max:samples.at(-1)};
 });
 console.log(JSON.stringify(report));await writeFile(resolve(cache,'motion-alignment.json'),JSON.stringify(report,null,2));
 assert(!report.error,report.error);assert(report.samples>70);assert(report.observed>70);assert(report.visibleFraction>.75,'Tracking must not pass by shielding most playback');
 assert(report.p95<14,`Mask coverage gap p95 ${report.p95.toFixed(1)}px exceeds 14px at 384px`);
}finally{await context?.close();assert(profile.startsWith(cache+sep));await rm(profile,{recursive:true,force:true});}
