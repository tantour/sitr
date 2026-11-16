import { chromium } from 'playwright';
import ts from 'typescript';
import { build } from 'esbuild';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const compiled=ts.transpileModule(await readFile('src/rendering/fabric.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const url='data:text/javascript;base64,'+Buffer.from(compiled).toString('base64');
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:760,height:440},deviceScaleFactor:1});
 await page.setContent('<style>body{background:#e9edef;font:16px Arial;margin:24px;color:#193537}main{display:flex;gap:24px}canvas{width:336px;height:336px;background:#c8987b}h3{margin:0 0 12px}</style><main><section><h3>Previous: edge extrusion</h3><canvas id="before" width="336" height="336"></canvas></section><section><h3>Revised: smooth garment tone + contour</h3><canvas id="after" width="336" height="336"></canvas></section></main>');
 const bundle = await build({stdin:{contents: "export { Overlay } from './src/rendering/overlay.ts'; export {renderBackground} from './src/rendering/background.ts';", resolveDir:process.cwd()},bundle:true,write:false,format:'iife',globalName:'FabricRenderCheck',platform:'browser'});
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 const report=await page.evaluate(async url=>{
  const {clothingFabric,applyClothing,softenFabricEdges}=await import(url);
  const s=112,n=s*s,rgba=new Uint8Array(n*4),categories=new Uint8Array(n).fill(2),mask=new Float32Array(n).fill(1);
  for(let y=0;y<s;y++) for(let x=0;x<s;x++){
   const p=y*s+x;if(y<36) categories[p]=4;
   const v=213+Math.round(7*Math.sin(x*1.5)+5*Math.sin(y*.8));rgba.set(y<36?[v,v+2,v+3,255]:[200,150,125,255],p*4);
  }
  const cloth=clothingFabric(rgba,categories,[{mask}],s);
  const before=new Uint8ClampedArray(n*4),after=new Uint8ClampedArray(n*4);
  for(let y=25;y<64;y++)for(let x=18+Math.floor((y-25)/9);x<92-Math.floor((y-25)/9);x++){
   const p=y*s+x;before.set([...rgba.slice((33*s+x)*4,(33*s+x)*4+3),255],p*4);after[p*4+3]=255;
  }
  const alpha=after.filter((_,i)=>i%4===3);applyClothing(after,cloth);softenFabricEdges(after,s,s);
  for(const [id,pixels]of [['before',before],['after',after]]){
   const c=document.createElement('canvas');c.width=c.height=s;c.getContext('2d').putImageData(new ImageData(pixels,s,s),0,0);
   document.getElementById(id).getContext('2d').drawImage(c,0,0,336,336);
  }
  // Exercise the actual cached overlay path, not only the RGB helper.
  const media=document.createElement('img');media.style.cssText='position:absolute;left:0;top:0;width:112px;height:112px';
  const source=document.createElement('canvas');source.width=source.height=s;media.src=source.toDataURL();
  document.body.append(media);await media.decode();
  // about:blank fixture lacks secure-context UUID; isolate anchor identity only.
  Object.defineProperty(crypto,'randomUUID',{value:()=> '00000000-0000-4000-8000-000000000001'});
  const overlay=new window.FabricRenderCheck.Overlay(media);
  const frame={width:s,height:s,rgbaMask:new Uint8Array(n*4),black:false,fabricFill:true,clothingRgb:cloth,tracks:[]};
  for(let y=30;y<100;y++)for(let x=20;x<90;x++)frame.rgbaMask[(y*s+x)*4+3]=255;
  overlay.set(frame);
  const sample=()=>{overlay.drawNow();const canvas=overlay.canvas;return canvas.getContext('2d').getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height*.75),1,1).data;};
  const garment=sample();
  overlay.set({...frame,fabricFill:false,clothingRgb:undefined});const black=sample();
  overlay.set({...frame,rgbaMask:new Uint8Array(n*4)});const cleared=sample();
  const toneFrame={...frame,rgbaMask:new Uint8Array(0),clothingRgb:undefined,trackMasks:[{id:'video',alpha:Uint8Array.from({length:n},(_,p)=>p%s>20&&p%s<90?255:0),fabricColor:[230,232,234]}]};
  overlay.set(toneFrame);const videoTone=sample();
  overlay.set({...toneFrame,fabricFill:false});const videoBlack=sample();
  const videoPaletteWorks=videoTone[0]>=226&&videoTone[0]<=234&&videoTone[3]===255&&videoBlack[0]===0&&videoBlack[3]===255;
  const areaMask=Uint8Array.from({length:n},(_,p)=>p%s>20&&p%s<90?255:0);
  overlay.set({...frame,fabricFill:false,rgbaMask:new Uint8Array(n*4),smartCoverMask:areaMask});const forcedSmart=sample();
  overlay.set({...frame,fabricFill:true,blackMask:areaMask,smartCoverMask:areaMask});const forcedBlack=sample();
  if(!(forcedSmart[0]>190&&forcedSmart[3]===255&&forcedBlack[0]===0&&forcedBlack[3]===255))throw Error('Explicit smart/black rule effects failed');
  const hairAlpha=Uint8Array.from({length:n},(_,p)=>p%s>50&&p%s<61?255:0);
  const hairFrame={...toneFrame,trackMasks:[{...toneFrame.trackMasks[0],blackAlpha:hairAlpha}]};
  overlay.set(hairFrame);const hair=sample();
  overlay.setMotion(new Map([['video',{x:.1,y:0}]]));overlay.drawNow();
  const moving=overlay.canvas.getContext('2d').getImageData(67,84,1,1).data;
  if(!(hair[0]===0&&hair[3]===255&&moving[0]===0&&moving[3]===255))throw Error('Hair must stay black and move with its track');
  overlay.setMotion(new Map());overlay.set(toneFrame);if(sample()[0]<200)throw Error('Hair RGB leaked into a reused fabric layer');
  const original=await new Promise(resolve=>source.toBlob(resolve));
  const baked=[];
  for(const result of [{...frame,fabricFill:false,rgbaMask:new Uint8Array(n*4),smartCoverMask:areaMask},{...frame,fabricFill:true,smartCoverMask:areaMask,blackMask:areaMask}]){
   const blob=await window.FabricRenderCheck.renderBackground(original,result),bitmap=await createImageBitmap(blob);
   const c=document.createElement('canvas');c.width=c.height=s;const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();baked.push(ctx.getImageData(s/2,Math.floor(s*.75),1,1).data);
  }
  if(!(baked[0][0]>190&&baked[0][3]===255&&baked[1][0]===0&&baked[1][3]===255))throw Error('Background smart/black effects failed');
  const hairBlob=await window.FabricRenderCheck.renderBackground(original,hairFrame),hairBitmap=await createImageBitmap(hairBlob);
  const hc=document.createElement('canvas');hc.width=hc.height=s;hc.getContext('2d').drawImage(hairBitmap,0,0);hairBitmap.close();
  const hairPixel=hc.getContext('2d').getImageData(56,84,1,1).data;if(hairPixel[0]!==0||hairPixel[3]!==255)throw Error('Background hair must remain black');
  const video=document.createElement('video');video.style.cssText=media.style.cssText;
  Object.defineProperties(video,{videoWidth:{value:s},videoHeight:{value:s}});document.body.append(video);
  const continuity=new window.FabricRenderCheck.Overlay(video);
  continuity.set({...hairFrame,tracks:[{id:'video',box:{x:.15,y:0,width:.7,height:1}}]});
  continuity.setVideoPadding(.04);continuity.drawNow();
  const cc=continuity.canvas.getContext('2d'),margin=cc.getImageData(18,84,1,1).data,core=cc.getImageData(56,84,1,1).data,far=cc.getImageData(2,84,1,1).data;
  if(!(margin[0]>200&&margin[3]===255&&core[0]===0&&core[3]===255&&far[3]===0))throw Error('Continuity must extend clothing locally, preserve black hair, and leave background open');
  continuity.setVideoPadding(0);continuity.drawNow();if(cc.getImageData(18,84,1,1).data[3])throw Error('Temporary continuity margin did not clear');
  continuity.dispose();video.remove();
  media.remove();overlay.dispose();
  return {videoPaletteWorks,samples:[Array.from(garment),Array.from(black),Array.from(cleared)],cachedOverlayWorks:garment[0]>190&&garment[3]===255&&black[0]===0&&black[3]===255&&cleared[3]===0,coveragePreserved:alpha.every((a,p)=>after[p*4+3]>=a),noSlate:after[(60*s+56)*4]>190};
 },url);
 assert(report.videoPaletteWorks);assert(report.cachedOverlayWorks);assert(report.coveragePreserved);assert(report.noSlate);
 await mkdir('.impeccable/review',{recursive:true});await page.screenshot({path:'.impeccable/review/fabric-refinement.png'});
 console.log('PASS: browser garment tone continuity and opaque coverage; synthetic comparison captured.');
} finally {await browser.close();}
