// SPDX-License-Identifier: AGPL-3.0-only
import {getDocument,GlobalWorkerOptions,OPS,TextLayer,type PDFDocumentProxy,type PDFPageProxy,type RenderTask,type PDFDocumentLoadingTask} from 'pdfjs-dist';
import {DEFAULT_SETTINGS,normalizeSettings,resolveYoloSize,siteIsExcepted,type Settings} from '../config/settings';
import {captureSquare} from '../media/capture';
import {renderBackground} from '../rendering/background';
import {uniqueId} from '../state/id';
import type {AnalysisResult,FrameKey,FramePacket} from '../state/contracts';
import {initializeUiPreferences} from '../ui/preferences';
import {t} from '../ui/localization';
import {PdfLayout} from './layoutClient';
import {pdfMime} from './mime';
import {embeddedRegions,intersects,clampRect,type PdfRect,type PdfRegion} from './regions';
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const layout=new PdfLayout();
const viewport=el('viewport'),pagesEl=el('pages'),pageInput=el<HTMLInputElement>('pageNumber');
GlobalWorkerOptions.workerSrc=chrome.runtime.getURL('pdfjs/pdf.worker.mjs');
let settings:Settings=DEFAULT_SETTINGS,pdf:PDFDocumentProxy|undefined,loading:PDFDocumentLoadingTask|undefined;
let documentGeneration=0,viewerTabId:number|undefined,sourceUrl='',mimeStream=false,sourceFile:File|undefined;
let working=false,pumpTimer=0,currentPage=1,drawMode=false,settingsGeneration=0,renderedTotal=0,analyzedTotal=0;
let passwordCallback:((password:string)=>void)|undefined;
const visible=new Set<PageState>(),states:PageState[]=[],MAX_PIXELS=2_000_000;
type Job={id:string;rect:PdfRect;kind:'overview'|'picture';key:FrameKey;mask?:ImageBitmap;error?:string;busy?:boolean};
type PageState={index:number;el:HTMLElement;canvas:HTMLCanvasElement;placeholder:HTMLElement;regionsEl:HTMLElement;textEl:HTMLElement;
 page?:PDFPageProxy;task?:RenderTask;text?:TextLayer;raw?:HTMLCanvasElement;width:number;height:number;regions:PdfRegion[];automatic:PdfRegion[];regionsInitialized?:boolean;jobs:Job[];touched:number;generation:number};
function status(message:string){el('status').textContent=t(message);}
function protection(){let except=false;try{except=!!sourceUrl&&siteIsExcepted(new URL(sourceUrl).hostname,settings.siteExceptions);}catch{}return settings.enabled&&settings.pdfs&&!except;}
function diagnostics(){document.body.dataset.pdfRenderedPages=String(renderedTotal);document.body.dataset.pdfAnalyzedRegions=String(analyzedTotal);document.body.dataset.pdfCachedPages=String(states.filter(s=>s.raw).length);document.body.dataset.pdfCacheBytes=String(cacheBytes());document.body.dataset.pdfReadyPages=states.filter(s=>s.raw&&s.jobs.length&&s.jobs.every(j=>j.mask)).map(s=>s.index).join(',');}
function cacheBytes(){return states.reduce((n,s)=>n+(s.raw?s.raw.width*s.raw.height*8:0)+s.jobs.reduce((a,j)=>a+(j.mask?j.mask.width*j.mask.height*4:0),0),0);}
function resetJob(job:Job){job.mask?.close();job.mask=undefined;void chrome.runtime.sendMessage({type:'reset-session',mediaSessionId:job.key.mediaSessionId,epoch:job.key.epoch,viewerTabId}).catch(()=>{});}
function discard(s:PageState){s.generation++;s.task?.cancel();s.text?.cancel();s.text=undefined;s.textEl.replaceChildren();s.raw&&(s.raw.width=s.raw.height=0);s.raw=undefined;s.canvas.width=s.canvas.height=0;s.jobs.forEach(resetJob);s.jobs=[];s.page?.cleanup();s.page=undefined;s.placeholder.hidden=false;s.el.dataset.pdfRendered='false';}
function buffered(s:PageState){return visible.has(s)||s.index>=currentPage-2&&s.index<=currentPage+3;}
function evict(){for(const s of states)if(s.raw&&!buffered(s))discard(s);diagnostics();}
function loadingProgress(message?:string,loaded=0,total=0){
 const panel=el('pdfLoading'),progress=el<HTMLProgressElement>('downloadProgress');panel.hidden=!message;
 viewport.setAttribute('aria-busy',String(!!message));
 if(!message)return;
 el('loadingDetail').textContent=t(message)+(loaded?' '+(total?Math.min(100,Math.round(loaded/total*100))+'%':(loaded/1048576).toFixed(1)+' MB'):'');
 if(total>0){progress.max=total;progress.value=loaded;}else progress.removeAttribute('value');
}
function schedule(){clearTimeout(pumpTimer);pumpTimer=window.setTimeout(()=>void pump(),32);}
function visibleRect(s:PageState):PdfRect|undefined{
 const r=s.el.getBoundingClientRect(),v=viewport.getBoundingClientRect();if(!r.width||!r.height)return;
 return clampRect({x:Math.max(0,(v.left-r.left)/r.width),y:Math.max(0,(v.top-r.top)/r.height),width:Math.min(1,(v.right-r.left)/r.width)-Math.max(0,(v.left-r.left)/r.width),height:Math.min(1,(v.bottom-r.top)/r.height)-Math.max(0,(v.top-r.top)/r.height)});
}
function newJob(id:string,rect:PdfRect,kind:Job['kind']):Job{return{id,rect,kind,key:{mediaSessionId:uniqueId(),epoch:1,sequence:1}};}
function initializeJobs(s:PageState){
 s.jobs.forEach(resetJob);s.jobs=[];
 // Stable page strips are cached across scrolling; only intersecting strips run.
 const bands=Math.max(2,Math.ceil(s.height/260));
 for(let i=0;i<bands;i++)s.jobs.push(newJob('overview-'+i,{x:0,y:i/bands,width:1,height:1/bands},'overview'));
 for(const region of s.regions)s.jobs.push(newJob(region.id,region,'picture'));
}
function paint(s:PageState){
 if(!s.raw)return;const ctx=s.canvas.getContext('2d')!,w=s.raw.width,h=s.raw.height;
 ctx.clearRect(0,0,w,h);ctx.drawImage(s.raw,0,0);
 if(protection()){
  const pending=getComputedStyle(document.documentElement).getPropertyValue('--pending').trim()||'#edf1ef';
  // Overview masks are drawn first; picture crops refine with higher source detail.
  for(const job of s.jobs.filter(j=>j.kind==='overview')){
   const r=job.rect;if(job.mask)ctx.drawImage(job.mask,r.x*w,r.y*h,r.width*w,r.height*h);else{ctx.fillStyle=pending;ctx.fillRect(Math.floor(r.x*w),Math.floor(r.y*h),Math.ceil(r.width*w)+1,Math.ceil(r.height*h)+1);}
  }
  for(const job of s.jobs.filter(j=>j.kind==='picture')){
   const r=job.rect;if(job.mask){
    // A refined crop replaces the overview within its bounds. Transparent mask
    // pixels must reveal the source, not a stale coarse mask underneath.
    ctx.drawImage(s.raw,r.x*w,r.y*h,r.width*w,r.height*h,r.x*w,r.y*h,r.width*w,r.height*h);
    ctx.drawImage(job.mask,r.x*w,r.y*h,r.width*w,r.height*h);
   }else{ctx.fillStyle=pending;ctx.fillRect(Math.floor(r.x*w),Math.floor(r.y*h),Math.ceil(r.width*w)+1,Math.ceil(r.height*h)+1);}
  }
 }
 s.placeholder.hidden=true;
}
function regionButtons(s:PageState){
 s.regionsEl.hidden=!el<HTMLInputElement>('showRegions').checked;
 s.regionsEl.replaceChildren();
 for(const region of s.regions){const b=document.createElement('button');b.type='button';b.className='image-region';b.dataset.region=region.id;b.dataset.kind=region.kind;b.setAttribute('aria-label',t('Image region')+' '+(s.regions.indexOf(region)+1));b.title=t('Drag to move; drag the lower-right corner to resize. Delete removes the box.');position(b,region);b.onkeydown=e=>{if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();removeRegion(s,region.id);}};s.regionsEl.append(b);}
}
function position(target:HTMLElement,r:PdfRect){Object.assign(target.style,{left:r.x*100+'%',top:r.y*100+'%',width:r.width*100+'%',height:r.height*100+'%'});}
function removeRegion(s:PageState,id:string){s.regions=s.regions.filter(r=>r.id!==id);const job=s.jobs.find(j=>j.id===id);if(job)resetJob(job);s.jobs=s.jobs.filter(j=>j.id!==id);regionButtons(s);paint(s);schedule();}
function commitRegion(s:PageState,r:PdfRegion){const existing=s.regions.findIndex(b=>b.id===r.id);if(existing<0){if(s.regions.length>=128){status('This page already has 128 image boxes.');return;}s.regions.push(r);}else s.regions[existing]=r;
 const old=s.jobs.find(j=>j.id===r.id);if(old)resetJob(old);s.jobs=s.jobs.filter(j=>j.id!==r.id);s.jobs.push(newJob(r.id,r,'picture'));regionButtons(s);paint(s);schedule();}
function bindDrawing(s:PageState){
 let drag:{start:{x:number;y:number};original?:PdfRegion;mode:'new'|'move'|'resize';element:HTMLElement}|undefined;
 const point=(e:PointerEvent)=>{const r=s.el.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};};
 const rectangle=(p:{x:number;y:number}):PdfRect=>{const d=drag!;if(!d.original)return{x:Math.min(d.start.x,p.x),y:Math.min(d.start.y,p.y),width:Math.abs(p.x-d.start.x),height:Math.abs(p.y-d.start.y)};
  if(d.mode==='resize')return{...d.original,width:Math.max(.015,p.x-d.original.x),height:Math.max(.015,p.y-d.original.y)};
  return{...d.original,x:Math.max(0,Math.min(1-d.original.width,d.original.x+p.x-d.start.x)),y:Math.max(0,Math.min(1-d.original.height,d.original.y+p.y-d.start.y))};};
 s.el.onpointerdown=e=>{
  const button=(e.target as Element).closest<HTMLElement>('[data-region]');if(!drawMode&&!button)return;if(e.button!==0||!s.raw)return;
  const p=point(e),original=button?s.regions.find(r=>r.id===button.dataset.region):undefined;if(!original&&!drawMode)return;
  e.preventDefault();const element=document.createElement('div');element.className='drag-box';s.regionsEl.append(element);
  drag={start:p,original,element,mode:original?(p.x>original.x+original.width-.03&&p.y>original.y+original.height-.03?'resize':'move'):'new'};s.el.setPointerCapture(e.pointerId);
 };
 s.el.onpointermove=e=>{if(drag)position(drag.element,rectangle(point(e)));};
 s.el.onpointerup=e=>{if(!drag)return;const r=clampRect(rectangle(point(e))),id=drag.original?.id??'manual-'+uniqueId();drag.element.remove();drag=undefined;if(r&&r.width>.01&&r.height>.01)commitRegion(s,{...r,id,kind:'manual'});};
 s.el.onpointercancel=()=>{drag?.element.remove();drag=undefined;};
}
function setPageSize(s:PageState){const zoom=el<HTMLSelectElement>('zoom').value,cssWidth=zoom==='fit'?Math.min(1050,Math.max(240,viewport.clientWidth-48)):s.width*Number(zoom)*96/72;
 s.el.style.width=cssWidth+'px';s.el.style.height=cssWidth*s.height/s.width+'px';s.el.style.setProperty('--total-scale-factor',String(cssWidth/s.width));}
function relayout(){
 const page=states[currentPage-1],before=page?.el.getBoundingClientRect(),root=viewport.getBoundingClientRect();
 const fraction=before?.height?Math.max(0,Math.min(1,(root.top-before.top)/before.height)):0;
 states.forEach(setPageSize);
 if(page){page.el.scrollIntoView({block:'start'});viewport.scrollTop+=fraction*page.el.getBoundingClientRect().height;pageInput.value=String(page.index);}
 schedule();
}
async function renderPage(s:PageState){
 if(!pdf)return;const doc=pdf,generation=s.generation,docGeneration=documentGeneration;s.page=await doc.getPage(s.index);
 if(docGeneration!==documentGeneration||generation!==s.generation)return;
 const base=s.page.getViewport({scale:1});s.width=base.width;s.height=base.height;setPageSize(s);
 const css=s.el.getBoundingClientRect().width,scale=Math.min(2,Math.max(1,css/s.width*Math.min(devicePixelRatio,1.5)),Math.sqrt(MAX_PIXELS/(s.width*s.height)),2300/Math.max(s.width,s.height));
 const view=s.page.getViewport({scale}),raw=document.createElement('canvas');raw.width=Math.ceil(view.width);raw.height=Math.ceil(view.height);
 s.task=s.page.render({canvas:raw,viewport:view,background:'#fff'});
 try{await s.task.promise;}catch(error){raw.width=raw.height=0;if(String(error).includes('Rendering cancelled'))return;throw error;}finally{s.task=undefined;}
 if(docGeneration!==documentGeneration||generation!==s.generation){raw.width=raw.height=0;return;}
 s.raw=raw;s.canvas.width=raw.width;s.canvas.height=raw.height;
 const list=await s.page.getOperatorList();if(docGeneration!==documentGeneration||generation!==s.generation)return;
 const exact=embeddedRegions(list,OPS,base),large=exact.some(r=>r.width*r.height>.65);
 const preview=document.createElement('canvas'),factor=Math.min(1,960/Math.max(raw.width,raw.height));preview.width=Math.max(1,Math.round(raw.width*factor));preview.height=Math.max(1,Math.round(raw.height*factor));const c=preview.getContext('2d',{willReadFrequently:true})!;c.drawImage(raw,0,0,preview.width,preview.height);
 const regions=await layout.analyze(c.getImageData(0,0,preview.width,preview.height),exact,base.width,base.height,large);preview.width=preview.height=0;
 if(docGeneration!==documentGeneration||generation!==s.generation)return;
 // Keep manual corrections when a page is evicted and later revisited.
 if(!s.regionsInitialized){s.regionsInitialized=true;s.automatic=regions;s.regions=regions.map(r=>({...r}));}
 initializeJobs(s);regionButtons(s);paint(s);renderedTotal++;s.el.dataset.pdfRendered='true';s.el.dataset.pdfRegions=String(s.regions.length);
 const textViewport=s.page.getViewport({scale:css/s.width});s.textEl.replaceChildren();s.text=new TextLayer({textContentSource:s.page.streamTextContent(),container:s.textEl,viewport:textViewport});void s.text.render().catch(()=>{});
 diagnostics();evict();
}
async function analyzeJob(s:PageState,job:Job){
 if(!s.raw)return;const generation=s.generation,settingsToken=settingsGeneration,current=settings,docGeneration=documentGeneration;
 const r=job.rect,raw=s.raw,x=Math.max(0,Math.floor(r.x*raw.width)),y=Math.max(0,Math.floor(r.y*raw.height)),w=Math.max(1,Math.min(raw.width-x,Math.ceil(r.width*raw.width))),h=Math.max(1,Math.min(raw.height-y,Math.ceil(r.height*raw.height)));
 const crop=document.createElement('canvas');crop.width=w;crop.height=h;crop.getContext('2d')!.drawImage(raw,x,y,w,h,0,0,w,h);
 // Known pictures have their own full-detail jobs. Excluding them from the
 // overview prevents oversized low-resolution hair halos outside picture bounds.
 if(job.kind==='overview'){
  const ctx=crop.getContext('2d')!;ctx.fillStyle='#fff';
  for(const picture of s.regions){const left=Math.floor(picture.x*raw.width)-x,top=Math.floor(picture.y*raw.height)-y;
   ctx.fillRect(left,top,Math.ceil(picture.width*raw.width)+1,Math.ceil(picture.height*raw.height)+1);}
 }
 job.busy=true;
 if(visible.has(s))status('Checking visible pictures…');
 try{
  await chrome.runtime.sendMessage({type:'ensure-offscreen'});
  if(document.hidden||!buffered(s)||generation!==s.generation)return;
  const size=resolveYoloSize(current,'image'),rgba=captureSquare(crop,w,h,size),faceRgba=captureSquare(crop,w,h,current.faceCaptureSize);
  const frame:FramePacket={key:job.key,kind:'image',capturedAtMs:Date.now(),width:size,height:size,nativeWidth:w,nativeHeight:h,rgba,faceRgba,faceSize:current.faceCaptureSize};
  const response=await chrome.runtime.sendMessage({type:'analyze',frame,settings:current,viewerTabId}) as {ok:boolean;result?:AnalysisResult;error?:string};
  if(generation!==s.generation||settingsToken!==settingsGeneration||docGeneration!==documentGeneration)return;
  if(!response.ok||!response.result)throw Error(response.error||'Picture analysis failed');
  const blob=await new Promise<Blob>((resolve,reject)=>crop.toBlob(b=>b?resolve(b):reject(Error('Picture capture failed')),'image/png'));
  const masked=await renderBackground(blob,response.result,true),bitmap=await createImageBitmap(masked);
  if(generation!==s.generation||settingsToken!==settingsGeneration||docGeneration!==documentGeneration){bitmap.close();return;}
  job.mask=bitmap;job.error=undefined;analyzedTotal++;s.el.dataset.pdfAnalyzed=String(s.jobs.filter(j=>j.mask).length);paint(s);diagnostics();
 }catch(error){job.error=String(error);s.el.dataset.pdfError=job.error;status('A picture could not be checked. Use Retry.');el('retryScan').hidden=false;}
 finally{job.busy=false;crop.width=crop.height=0;}
}
async function pump(){
 if(working||document.hidden||!pdf)return;working=true;
 try{
  while(!document.hidden&&pdf){
   const active=[...visible].sort((a,b)=>Math.abs(a.index-currentPage)-Math.abs(b.index-currentPage));
   const render=active.find(s=>!s.raw&&!s.el.dataset.pdfFatal);
   if(render){render.touched=performance.now();try{await renderPage(render);}catch(error){render.el.dataset.pdfFatal=String(error);render.placeholder.textContent=t('This page could not be rendered. Use Retry.');el('retryScan').hidden=false;}continue;}
   if(!protection()){active.forEach(paint);status('PDF protection is off.');break;}
   let next:{s:PageState;job:Job}|undefined;
   for(const s of active){const rect=visibleRect(s);if(!rect)continue;s.touched=performance.now();const job=s.jobs.find(j=>!j.mask&&!j.error&&!j.busy&&intersects(j.rect,rect));if(job){next={s,job};break;}}
   if(!next){
    // Finish the current page, then prepare the next three, one job at a time.
    // Every iteration rechecks visible work, so scrolling immediately takes priority.
    const ahead=states.filter(s=>s.index>=currentPage&&s.index<=currentPage+3);
    const target=ahead.find(s=>!s.el.dataset.pdfFatal&&(!s.raw||s.jobs.some(j=>!j.mask&&!j.error&&!j.busy)));
    if(target){
     if(!target.raw){try{await renderPage(target);}catch(error){target.el.dataset.pdfFatal=String(error);}continue;}
     const job=target.jobs.find(j=>!j.mask&&!j.error&&!j.busy);
     if(job){await analyzeJob(target,job);evict();await new Promise<void>(resolve=>setTimeout(resolve,0));continue;}
    }
    const failure=active.some(s=>s.el.dataset.pdfFatal||s.jobs.some(j=>j.error&&intersects(j.rect,visibleRect(s)??{x:0,y:0,width:0,height:0})));status(failure?'A picture could not be checked. Use Retry.':'Visible pictures checked.');break;}
   await analyzeJob(next.s,next.job);evict();
   await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
 }finally{working=false;}
}
const observer=new IntersectionObserver(entries=>{for(const entry of entries){const s=states.find(s=>s.el===entry.target);if(!s)continue;if(entry.isIntersecting&&entry.intersectionRect.height>0){visible.add(s);s.touched=performance.now();}else{visible.delete(s);if(!buffered(s))s.task?.cancel();}}updateCurrentPage();schedule();},{root:viewport,threshold:0});
function buildPages(count:number,width:number,height:number){
 observer.disconnect();visible.clear();pagesEl.replaceChildren();states.length=0;
 const fragment=document.createDocumentFragment();
 for(let index=1;index<=count;index++){
  const section=document.createElement('section');section.className='pdf-page';section.dataset.page=String(index);section.setAttribute('aria-label',t('Page')+' '+index);
  const canvas=document.createElement('canvas'),placeholder=document.createElement('div'),textEl=document.createElement('div'),regionsEl=document.createElement('div');placeholder.className='page-placeholder';placeholder.textContent=t('Page')+' '+index;textEl.className='textLayer';regionsEl.className='regions';section.append(canvas,placeholder,textEl,regionsEl);
  const state:PageState={index,el:section,canvas,placeholder,textEl,regionsEl,width,height,regions:[],automatic:[],jobs:[],touched:0,generation:0};states.push(state);setPageSize(state);bindDrawing(state);fragment.append(section);
 }
 pagesEl.append(fragment);states.forEach(s=>observer.observe(s.el));
}
function showError(error:unknown){loadingProgress();el('errorDetail').textContent=String(error);el('error').hidden=false;status('Could not open this PDF.');}
async function openDocument(source:string|File|Uint8Array,name?:string){
 const generation=++documentGeneration;settingsGeneration++;observer.disconnect();visible.clear();states.forEach(discard);states.length=0;pagesEl.replaceChildren();await loading?.destroy();pdf=undefined;renderedTotal=analyzedTotal=0;
 loadingProgress('Opening PDF…');el('error').hidden=el('passwordForm').hidden=true;el('empty').hidden=true;status('Opening PDF…');
 try{
  const prefix=chrome.runtime.getURL('pdfjs/');
  const options={cMapUrl:prefix+'cmaps/',cMapPacked:true,standardFontDataUrl:prefix+'standard_fonts/',wasmUrl:prefix+'wasm/',iccUrl:prefix+'iccs/',isEvalSupported:false,enableXfa:false,disableAutoFetch:true,disableStream:true,canvasMaxAreaInBytes:32*1024*1024};
  const data=source instanceof File?new Uint8Array(await source.arrayBuffer()):source;
  loading=getDocument(typeof data==='string'?{...options,url:data,withCredentials:true}:{...options,data});
  loading.onProgress=({loaded,total}:{loaded:number;total:number})=>{if(generation===documentGeneration)loadingProgress('Downloading PDF…',loaded,total);};
  loading.onPassword=(callback:(password:string)=>void)=>{passwordCallback=callback;el('passwordForm').hidden=false;el<HTMLInputElement>('password').focus();};
  pdf=await loading.promise;if(generation!==documentGeneration)return;loadingProgress('Preparing PDF…');
  const first=await pdf.getPage(1),view=first.getViewport({scale:1});if(generation!==documentGeneration)return;
  const title=name||'PDF reader';el('documentTitle').textContent=title;document.title=title+' · Sitr';pageInput.max=String(pdf.numPages);el('pageCount').textContent='/ '+pdf.numPages;
  buildPages(pdf.numPages,view.width,view.height);loadingProgress();states[0].page=first;viewport.scrollTop=0;currentPage=1;pageInput.value='1';diagnostics();schedule();
  const requested=Number((location.hash||sourceUrl.split('#')[1]||'').match(/page=(\d+)/)?.[1]);if(requested)goPage(requested);
 }catch(error){if(generation===documentGeneration)showError(error);}
}
function goPage(number:number){const s=states[Math.max(0,Math.min(states.length-1,Math.round(number)-1))];if(!s)return;s.el.scrollIntoView({block:'start'});currentPage=s.index;pageInput.value=String(currentPage);schedule();}
function updateSettings(next:Settings){settings=next;settingsGeneration++;for(const s of states){s.generation++;s.jobs.forEach(resetJob);if(s.raw){initializeJobs(s);paint(s);}}schedule();}
el('openFile').onclick=()=>el<HTMLInputElement>('file').click();el<HTMLInputElement>('file').onchange=()=>{const file=el<HTMLInputElement>('file').files?.[0];if(file){sourceFile=file;sourceUrl='';void openDocument(file,file.name);}};
el('urlForm').onsubmit=e=>{e.preventDefault();const url=el<HTMLInputElement>('pdfUrl').value;try{const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol))throw Error('Use an HTTP or HTTPS PDF address.');sourceFile=undefined;sourceUrl=parsed.href;void openDocument(sourceUrl,decodeURIComponent(parsed.pathname.split('/').at(-1)||'PDF'));}catch(error){showError(error);}};
el('previous').onclick=()=>goPage(currentPage-1);el('next').onclick=()=>goPage(currentPage+1);pageInput.onchange=()=>goPage(Number(pageInput.value));
el<HTMLSelectElement>('zoom').onchange=()=>{relayout();states.forEach(s=>{if(s.text&&s.page){s.text.cancel();s.textEl.replaceChildren();s.text=new TextLayer({textContentSource:s.page.streamTextContent(),container:s.textEl,viewport:s.page.getViewport({scale:s.el.getBoundingClientRect().width/s.width})});void s.text.render().catch(()=>{});}});schedule();};
el<HTMLInputElement>('showRegions').onchange=()=>{states.forEach(regionButtons);el('regionHint').hidden=!el<HTMLInputElement>('showRegions').checked;};
el('drawRegion').onclick=()=>{drawMode=!drawMode;document.body.classList.toggle('drawing',drawMode);el('drawRegion').setAttribute('aria-pressed',String(drawMode));el<HTMLInputElement>('showRegions').checked=true;states.forEach(regionButtons);el('regionHint').hidden=false;};
el('resetRegions').onclick=()=>{const s=states[currentPage-1];if(s?.raw){s.regions=s.automatic.map(r=>({...r}));initializeJobs(s);regionButtons(s);paint(s);schedule();}};
el('settings').onclick=()=>void chrome.tabs.create({url:chrome.runtime.getURL('popup.html#settings')});
el('passwordForm').onsubmit=e=>{e.preventDefault();passwordCallback?.(el<HTMLInputElement>('password').value);el<HTMLInputElement>('password').value='';el('passwordForm').hidden=true;};
el('tryAgain').onclick=()=>{el('error').hidden=true;if(sourceFile)void openDocument(sourceFile,sourceFile.name);else if(sourceUrl)void openDocument(sourceUrl,el('documentTitle').textContent||'PDF');};
el('nativeViewer').onclick=()=>{if(mimeStream)void pdfMime()?.abortAndFallbackToNativeHandler();};
el('retryScan').onclick=()=>{for(const s of states){delete s.el.dataset.pdfFatal;delete s.el.dataset.pdfError;s.jobs.forEach(j=>j.error=undefined);}el('retryScan').hidden=true;schedule();};
function updateCurrentPage(){
 const root=viewport.getBoundingClientRect();
 const onScreen=[...visible].filter(s=>{const r=s.el.getBoundingClientRect();return r.bottom>root.top+2&&r.top<root.bottom;}).sort((a,b)=>a.index-b.index);
 if(onScreen[0]){currentPage=onScreen[0].index;pageInput.value=String(currentPage);}
}
viewport.addEventListener('scroll',()=>{updateCurrentPage();schedule();},{passive:true});
const toolbarResize=new ResizeObserver(()=>{const height=document.querySelector('.reader-bar')!.getBoundingClientRect().height+document.querySelector('.reader-status')!.getBoundingClientRect().height;document.documentElement.style.setProperty('--reader-top',height+'px');relayout();});toolbarResize.observe(document.querySelector('.reader-bar')!);
window.addEventListener('resize',relayout);document.addEventListener('visibilitychange',()=>{if(document.hidden)states.forEach(s=>s.task?.cancel());else schedule();});
window.addEventListener('pagehide',()=>{layout.dispose();states.forEach(discard);void loading?.destroy();});
chrome.storage.onChanged.addListener(changes=>{if(changes.settings)updateSettings(normalizeSettings(changes.settings.newValue));});
initializeUiPreferences(()=>states.filter(s=>s.raw).forEach(paint),message=>status(message),()=>{});
async function start(){
 settings=normalizeSettings((await chrome.storage.local.get('settings')).settings);viewerTabId=(await chrome.tabs.getCurrent())?.id;
 const url=new URL(location.href).searchParams.get('src');if(url){sourceUrl=url;try{const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol))throw Error('Choose a local PDF using Open PDF.');await openDocument(url,decodeURIComponent(parsed.pathname.split('/').at(-1)||'PDF'));}catch(error){showError(error);}return;}
 if(pdfMime())try{const info=await pdfMime()!.getStreamInfo();mimeStream=true;viewerTabId=info.tabId;sourceUrl=info.originalUrl;el('nativeViewer').hidden=false;
  loadingProgress('Downloading PDF…');
  const response=await fetch(info.streamUrl);if(!response.ok)throw Error('PDF stream could not be read');
  const total=Number(response.headers.get('content-length'))||0,reader=response.body?.getReader(),chunks:Uint8Array[]=[];let loaded=0;
  if(reader){while(true){const {done,value}=await reader.read();if(done)break;chunks.push(value);loaded+=value.length;loadingProgress('Downloading PDF…',loaded,total);}}
  else{chunks.push(new Uint8Array(await response.arrayBuffer()));loaded=chunks[0].length;}
  const data=new Uint8Array(loaded);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}chunks.length=0;
  if(!protection()){await pdfMime()!.abortAndFallbackToNativeHandler();return;}
  let name='PDF';try{name=decodeURIComponent(new URL(sourceUrl).pathname.split('/').at(-1)||'PDF');}catch{}await openDocument(data,name);
 }catch(error){if(mimeStream)showError(error);}
}
void start().catch(showError);
