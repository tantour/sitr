// SPDX-License-Identifier: AGPL-3.0-only
import {uniqueId} from '../state/id';
import type {Settings} from '../config/settings';
import {resolvePersonSize} from '../config/settings';
import type {AnalysisResult,FramePacket} from '../state/contracts';
import {captureSquare} from './capture';
import {GifDecoder} from './gifDecoder';
import {gifPosition,type GifInfo} from './gif';
import {Overlay} from '../rendering/overlay';
import type {BackgroundSurface} from './backgroundImages';
let posterBusy=false;
interface Options {
  target?:HTMLElement; background?:BackgroundSurface;
  settings:()=>Settings; enabled:()=>boolean; admitted:()=>boolean;
  analyze:(frame:FramePacket,settings:Settings)=>Promise<AnalysisResult>;
  reset:(id:string,epoch:number)=>void; protect:()=>void; release:()=>void;
}
/** Show only decoded frames with their matching masks; never a live GIF under a stale overlay. */
export class GifPlayback {
  private decoder?:GifDecoder;private decoderReady?:Promise<void>;private overlay?:Overlay;
  private capture=document.createElement('canvas');private display=document.createElement('canvas');
  private session=uniqueId();private epoch=1;private sequence=0;private generation=0;
  private timer=0;private lastAdmittedAt=0;private busy=false;private disposed=false;private finished=false;
  private elapsed=0;private started=0;private ticking=false;private lastIndex=-1;private lastRevision=-1;
  private previous?:Uint8Array;private result?:AnalysisResult;private signature='';
  private opacity:string;private opacityPriority:string;private resize:ResizeObserver;
  constructor(private image:HTMLImageElement,private blob:Blob,readonly info:GifInfo,private options:Options){
    this.opacity=image.style.getPropertyValue('opacity');this.opacityPriority=image.style.getPropertyPriority('opacity');
    const scale=Math.min(1,1024/info.width,1024/info.height);
    this.capture.width=this.display.width=Math.max(1,Math.round(info.width*scale));this.capture.height=this.display.height=Math.max(1,Math.round(info.height*scale));
    this.image.dataset.localMediaCensorKind=info.type==='image/webp'?'webp-video':'gif-video';this.image.dataset.localMediaCensorGifFrames=String(info.durations.length);
    this.resize=new ResizeObserver(()=>this.overlay?.draw());this.resize.observe(options.target??image);this.update();
  }
  getResult():AnalysisResult|undefined{return this.result;}
  isPlaying():boolean{return !this.disposed&&!this.finished&&this.options.enabled();}
  private parkDecoder():void{this.decoder?.dispose();this.decoder=undefined;this.decoderReady=undefined;this.previous=undefined;}
  private restoreOpacity():void{if(this.opacity)this.image.style.setProperty('opacity',this.opacity,this.opacityPriority);else this.image.style.removeProperty('opacity');}
  private visible():boolean{const target=this.options.target??this.image,r=target.getBoundingClientRect();return target.isConnected&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;}
  update(refresh=false):void{
    if(this.disposed)return;
    const current=this.options.settings(),signature=JSON.stringify([current.videoDetector,current.advancedVideoMode,current.videoGenderModel,current.automaticGender,resolvePersonSize(current,'video')]);
    if(refresh){this.generation++;if(this.signature!==signature)this.options.reset(this.session,this.epoch++);this.lastRevision=-1;this.finished=false;}
    this.signature=signature;
    clearTimeout(this.timer);this.timer=0;
    const enabled=this.options.enabled(),active=enabled&&!document.hidden&&this.visible();
    if(!active){
      if(!this.busy)this.parkDecoder();
      if(this.ticking){this.elapsed+=performance.now()-this.started;this.ticking=false;}
      if(!enabled){this.overlay?.dispose();this.overlay=undefined;this.result=undefined;this.lastIndex=-1;this.lastRevision=-1;this.restoreOpacity();this.options.release();}
      if(enabled&&!document.hidden)this.schedule(250);
      return;
    }
    if(!this.ticking){this.started=performance.now();this.ticking=true;}
    if(this.result&&this.overlay){this.image.style.setProperty('opacity','0','important');if(this.overlay.drawNow())this.options.release();}
    else if(!this.result||!this.options.background)this.options.protect();
    if(!this.busy&&!this.finished)this.schedule(0);
  }
  private schedule(delay:number):void{if(this.disposed||document.hidden||!this.options.enabled())return;clearTimeout(this.timer);this.timer=window.setTimeout(()=>{this.timer=0;void this.tick();},Math.max(0,delay));}
  private async tick():Promise<void>{
    if(this.disposed||this.busy)return;
    if(document.hidden||!this.options.enabled()||!this.visible()){this.update();return;}
    const settings=this.options.settings(),admitted=this.options.admitted(),poster=!admitted&&(!this.result||this.lastRevision!==settings.revision);
    if(!admitted&&!poster){if(performance.now()-this.lastAdmittedAt>1000)this.parkDecoder();this.schedule(250);return;}
    // Every visible animation gets one analyzed still preview. Only one such
    // initialization runs at a time, without starting unlimited playback loops.
    if(poster&&posterBusy){this.schedule(100);return;}
    if(poster)posterBusy=true;
    this.lastAdmittedAt=performance.now();
    const elapsed=this.elapsed+performance.now()-this.started,position=gifPosition(this.info,poster?0:elapsed);
    if(position.index===this.lastIndex&&settings.revision===this.lastRevision){if(poster)posterBusy=false;if(position.finished)this.finished=true;else this.schedule(position.nextMs);return;}
    this.busy=true;const generation=this.generation;
    let bitmap:ImageBitmap|undefined;
    try{
      if(!this.decoder){this.decoder=new GifDecoder();this.decoderReady=this.decoder.initialize(this.blob);}
      await this.decoderReady;bitmap=await this.decoder.frame(position.index);
      if(this.disposed||generation!==this.generation)return;
      const ctx=this.capture.getContext('2d')!;ctx.clearRect(0,0,this.capture.width,this.capture.height);ctx.drawImage(bitmap,0,0,this.capture.width,this.capture.height);
      const side=resolvePersonSize(settings,'video'),rgba=captureSquare(this.capture,this.capture.width,this.capture.height,side);
      if(this.previous){let changed=0,total=0;for(let p=0;p<rgba.length;p+=128){if(Math.abs(rgba[p]-this.previous[p])>70)changed++;total++;}if(changed>total*.55)this.options.reset(this.session,this.epoch++);}
      this.previous=rgba;
      const faceRgba=settings.automaticGender&&settings.videoGenderModel.startsWith('face')&&Date.now()>=(this.result?.nextFaceCheckAtMs??0)
        ?captureSquare(this.capture,this.capture.width,this.capture.height,settings.faceCaptureSize):undefined;
      const frame:FramePacket={key:{mediaSessionId:this.session,epoch:this.epoch,sequence:++this.sequence},kind:'video',mediaTimeSec:elapsed/1000,capturedAtMs:Date.now(),width:side,height:side,rgba,faceRgba,faceSize:faceRgba?settings.faceCaptureSize:undefined};
      const result=await this.options.analyze(frame,settings);
      if(this.disposed||generation!==this.generation||!this.options.enabled()||settings.revision!==this.options.settings().revision)return;
      const display=this.display.getContext('2d')!;display.clearRect(0,0,this.display.width,this.display.height);display.drawImage(bitmap,0,0,this.display.width,this.display.height);
      this.result=result;this.lastIndex=position.index;this.lastRevision=settings.revision;
      if(this.options.background){
        const blob=await new Promise<Blob>((resolve,reject)=>this.display.toBlob(value=>value?resolve(value):reject(Error('GIF background encoding failed')),'image/png'));
        if(this.disposed||generation!==this.generation||!this.options.enabled())return;
        this.options.background.source(blob);this.options.background.accept(result);
      }else{
        this.overlay??=new Overlay(this.image,this.display);this.overlay.set(result);
        this.image.style.setProperty('opacity','0','important');
        if(!document.hidden&&this.overlay.drawNow())this.options.release();
      }
      this.image.dataset.localMediaCensorSequence=String(this.sequence);this.image.dataset.localMediaCensorGifFrame=String(position.index);
      this.image.dataset.localMediaCensorStatus=result.reason;this.image.dataset.localMediaCensorTimingsMs=JSON.stringify(result.timingsMs??{});
      if(position.finished)this.finished=true;
    }catch(error){
      if(!this.disposed){this.image.dataset.localMediaCensorStatus=String(error);if(!this.result)this.options.protect();this.schedule(1000);}
    }finally{
      bitmap?.close();this.busy=false;if(poster)posterBusy=false;
      if(poster||document.hidden||!this.options.enabled())this.parkDecoder();
      if(!this.timer&&!this.disposed&&!this.finished)this.schedule(4);
    }
  }
  dispose():void{if(this.disposed)return;this.disposed=true;this.generation++;clearTimeout(this.timer);this.decoder?.dispose();this.overlay?.dispose();this.resize.disconnect();this.restoreOpacity();this.options.reset(this.session,this.epoch);this.capture.width=this.display.width=0;}
}
