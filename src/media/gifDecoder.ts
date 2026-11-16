// SPDX-License-Identifier: AGPL-3.0-only
/** The extension-origin host provides ImageDecoder even on insecure HTTP pages. */
export class GifDecoder {
  private host=document.createElement('iframe');private port?:MessagePort;private id=0;
  private requests=new Map<number,{resolve:(value:ImageBitmap|undefined)=>void;reject:(error:Error)=>void;timer:number}>();
  private ready:Promise<void>;private stopped=false;
  constructor(){
    this.host.src=chrome.runtime.getURL('gif.html');this.host.setAttribute('aria-hidden','true');this.host.style.cssText='position:fixed!important;width:0!important;height:0!important;border:0!important;opacity:0!important;pointer-events:none!important';
    this.ready=new Promise((resolve,reject)=>{
      const timer=window.setTimeout(()=>reject(Error('GIF host connection timed out')),5000);
      this.host.onload=()=>{if(this.stopped)return;const channel=new MessageChannel();this.port=channel.port1;this.port.onmessage=event=>{
        const m=event.data;if(m.connected){clearTimeout(timer);resolve();return;}
        const pending=this.requests.get(m.id);if(!pending){m.bitmap?.close?.();return;}this.requests.delete(m.id);clearTimeout(pending.timer);
        m.error?pending.reject(Error(m.error)):pending.resolve(m.bitmap);
      };this.host.contentWindow?.postMessage({type:'gif-connect'},new URL(this.host.src).origin,[channel.port2]);};
      (document.documentElement||document.body).append(this.host);
    });
  }
  private async request(message:object,transfer:Transferable[]=[]):Promise<ImageBitmap|undefined>{
    await this.ready;if(this.stopped)throw Error('GIF decoder disposed');const id=++this.id;
    return new Promise((resolve,reject)=>{const timer=window.setTimeout(()=>{this.requests.delete(id);reject(Error('GIF decode timed out'));},10000);this.requests.set(id,{resolve,reject,timer});this.port!.postMessage({...message,id},transfer);});
  }
  async initialize(blob:Blob):Promise<void>{const data=await blob.arrayBuffer();await this.request({type:'init',data,mime:blob.type.split(';')[0]},[data]);}
  async frame(index:number):Promise<ImageBitmap>{const bitmap=await this.request({type:'frame',index});if(!bitmap)throw Error('GIF frame missing');return bitmap;}
  dispose():void{this.stopped=true;for(const pending of this.requests.values()){clearTimeout(pending.timer);pending.reject(Error('GIF decoder disposed'));}this.requests.clear();this.port?.close();this.host.remove();}
}
