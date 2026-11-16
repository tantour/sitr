// SPDX-License-Identifier: AGPL-3.0-only
import type {PdfRect,PdfRegion} from './regions';
/** A single lazy worker keeps scan statistics off the reader's scroll thread. */
export class PdfLayout{
 private worker?:Worker;private next=0;private pending=new Map<number,{resolve:(regions:PdfRegion[])=>void;reject:(error:Error)=>void;timer:number}>();
 analyze(image:ImageData,embedded:PdfRect[],pageWidth:number,pageHeight:number,scanned:boolean):Promise<PdfRegion[]>{
  if(!this.worker){this.worker=new Worker(chrome.runtime.getURL('pdf-layout-worker.js'));this.worker.onmessage=({data})=>{const request=this.pending.get(data.id);if(!request)return;clearTimeout(request.timer);this.pending.delete(data.id);data.error?request.reject(Error(data.error)):request.resolve(data.regions);};this.worker.onerror=()=>this.dispose();}
  const id=++this.next;
  return new Promise((resolve,reject)=>{const timer=window.setTimeout(()=>{this.pending.delete(id);reject(Error('Layout detection timed out'));},5000);this.pending.set(id,{resolve,reject,timer});this.worker!.postMessage({id,rgba:image.data.buffer,width:image.width,height:image.height,embedded,pageWidth,pageHeight,scanned},[image.data.buffer]);});
 }
 dispose(){this.worker?.terminate();this.worker=undefined;for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(Error('Layout detection stopped'));}this.pending.clear();}
}
