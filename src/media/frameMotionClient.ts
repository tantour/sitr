// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import type { AnalysisResult } from '../state/contracts';
import type { MotionAnchor } from './frameMotion';

type MotionOutput = { type: 'motion'; source: 'frame' | 'align'; generation: number; cut: boolean;
  at: number; frames: number; sequence: number; reliable: boolean; reliableIds: string[]; offsets: Array<[string, { x: number; y: number }]>; processingMs?: number };

/** Moves readback and block matching off the page thread; one frame may run and one may replace it. */
export class FrameMotion {
  private readonly host = document.createElement('iframe');
  private port?: MessagePort;
  private connected = false;
  private generation = 0;
  private inFlight = false;
  private capturePending = false;
  private queued?: { frame: ImageBitmap; at: number };
  private anchor?: MotionAnchor;
  private currentOffsets = new Map<string, { x: number; y: number }>();
  private measuredPositions = new Map<string, { x: number; y: number }>();
  private measuredAt = 0;
  private velocities = new Map<string, { x: number; y: number }>();
  private lastObservedAt = 0;
  private offsetAt = 0;
  private lastCaptureRequestedAt = 0;
  private alignedSequence = -1;
  private reliable = false;
  private reliableIds = new Set<string>();
  private failed = false;
  error = '';
  frames = 0;
  processingMs = 0;

  constructor(private readonly onUpdate: (cut: boolean) => void) {
    this.host.src = chrome.runtime.getURL('motion.html');
    this.host.setAttribute('aria-hidden', 'true');
    this.host.style.cssText = 'position:fixed!important;width:0!important;height:0!important;border:0!important;opacity:0!important;pointer-events:none!important';
    this.host.onload = () => {
      const channel = new MessageChannel();
      this.port = channel.port1;
      this.port.onmessage = (event: MessageEvent<MotionOutput | { type: 'error'; message: string } | { type: 'connected' }>) => {
      const value = event.data;
      if (value.type === 'error') { this.failed = true; this.error = value.message; return; }
      if (value.type === 'connected') {
        this.connected = true;
        this.port?.postMessage({ type: 'reset', generation: this.generation });
        if (this.anchor) this.port?.postMessage({ type: 'align', anchor: this.anchor, generation: this.generation });
        return;
      }
      if (value.generation !== this.generation) return;
      if (value.source === 'frame') this.inFlight = false;
      this.frames = value.frames;
      this.processingMs = value.processingMs ?? this.processingMs;
      // A frame reply can already be queued when a newer analysis rebases the
      // masks. Its offsets belong to the previous anchor and must not move them.
      if (this.anchor && value.sequence !== this.anchor.sequence) {
        if(value.cut)this.onUpdate(true);
        this.flushQueued();
        return;
      }
      this.lastObservedAt = value.at;
      this.offsetAt = value.at;
      this.alignedSequence = value.sequence;
      this.reliable = value.reliable;
      this.reliableIds = new Set(value.reliableIds);
      this.currentOffsets = new Map(value.offsets);
      if (value.source === 'frame') {
        const dt=(value.at-this.measuredAt)/1000,positions=new Map<string,{x:number;y:number}>();
        for(const track of this.anchor?.tracks??[]){
          const offset=this.currentOffsets.get(track.id);
          if(!offset||!this.reliableIds.has(track.id)){this.velocities.delete(track.id);continue;}
          const current={x:track.box.x+track.box.width/2+offset.x,y:track.box.y+track.box.height/2+offset.y};
          positions.set(track.id,current);
          const previous=this.measuredPositions.get(track.id);
          // Compare world positions, not offsets: rebasing changes an offset
          // even when the person has continued moving at exactly the same speed.
          if(previous&&dt>0&&dt<.25){
            const old=this.velocities.get(track.id);
            const x=Math.max(-1.5,Math.min(1.5,(current.x-previous.x)/dt));
            const y=Math.max(-1.5,Math.min(1.5,(current.y-previous.y)/dt));
            this.velocities.set(track.id,{x:old?(old.x+x)*.5:x,y:old?(old.y+y)*.5:y});
          }
        }
        this.measuredPositions=positions;this.measuredAt=value.at;
      }
      this.onUpdate(value.cut);
      this.flushQueued();
      };
      try {
        this.host.contentWindow?.postMessage({ type: 'connect' }, new URL(this.host.src).origin, [channel.port2]);
      } catch (error) { this.failed = true; this.error = String(error); }
    };
    const attach = () => {
      if (document.documentElement) this.host.isConnected || document.documentElement.appendChild(this.host);
      else setTimeout(attach, 0);
    };
    attach();
    setTimeout(() => { if (!this.connected && !this.failed) { this.failed = true; this.error = 'Motion host did not connect'; } }, 3000);
  }
  private flushQueued():void{
    if(this.queued&&!this.inFlight){const queued=this.queued;this.queued=undefined;this.sendFrame(queued.frame,queued.at);}
  }
  private sendFrame(frame: ImageBitmap, at: number): void {
    try {
      this.port?.postMessage({ type: 'frame', frame, at, generation: this.generation,
        maskIds: this.anchor?.maskIds ?? [] }, [frame]);
      this.inFlight = true;
    } catch (error) { frame.close(); this.failed = true; this.error = String(error); }
  }
  observe(video: HTMLVideoElement, at: number): void {
    if (this.failed || !this.connected || this.capturePending || at - this.lastCaptureRequestedAt < 16 || !video.videoWidth || !video.videoHeight) return;
    this.lastCaptureRequestedAt = at;
    this.capturePending = true;
    const generation = this.generation;
    const ratio = Math.min(96 / video.videoWidth, 96 / video.videoHeight);
    void createImageBitmap(video, { resizeWidth: Math.max(1, Math.round(video.videoWidth * ratio)),
      resizeHeight: Math.max(1, Math.round(video.videoHeight * ratio)) })
      .then(frame => {
        if (this.failed || generation !== this.generation) { frame.close(); return; }
        if (this.inFlight) {
          this.queued?.frame.close();
          this.queued = { frame, at };
        } else this.sendFrame(frame, at);
      })
      .catch(error => { this.failed = true; this.error = String(error); })
      .finally(() => { this.capturePending = false; });
  }
  align(result: AnalysisResult): void {
    const previousBoxes = new Map(this.anchor?.tracks.map(track => [track.id, track.box]) ?? []);
    const previousOffsets = this.offsets();
    this.anchor = { capturedAtMs: result.capturedAtMs, sequence: result.key.sequence,
      tracks: result.tracks.map(track => ({ id: track.id, box: track.box })), maskIds: result.trackMasks?.map(mask => mask.id) ?? [] };
    const provisional = new Map<string, { x: number; y: number }>();
    for (const track of result.tracks) {
      const oldBox = previousBoxes.get(track.id);
      const oldShift = previousOffsets.get(track.id);
      if (oldBox && oldShift) provisional.set(track.id, {
        x: Math.max(-0.35, Math.min(0.35, oldShift.x + oldBox.x - track.box.x)),
        y: Math.max(-0.35, Math.min(0.35, oldShift.y + oldBox.y - track.box.y)),
      });
    }
    this.currentOffsets = provisional;
    this.offsetAt = Date.now();
    this.reliable = false;
    try { if (this.connected) this.port?.postMessage({ type: 'align', anchor: this.anchor, generation: this.generation }); }
    catch (error) { this.failed = true; this.error = String(error); }
  }
  offsets(now = Date.now()): Map<string, { x: number; y: number }> {
    // Follow measured movement immediately. A display low-pass adds visible
    // trailing latency; only extrapolate the short worker-delivery interval.
    const dt=Math.min(.03,Math.max(0,now-this.offsetAt)/1000);
    return new Map([...this.currentOffsets].map(([id,offset])=>{
      const velocity=this.reliableIds.has(id)?this.velocities.get(id):undefined;
      return [id,{x:offset.x+(velocity?.x??0)*dt,y:offset.y+(velocity?.y??0)*dt}];
    }));
  }

  predictedTracks(now = Date.now()): Array<{ id: string; box: { x: number; y: number; width: number; height: number } }> {
    if (this.failed || now - this.lastObservedAt > 100) return [];
    const offsets = this.offsets(now);
    return (this.anchor?.tracks ?? []).filter(track => this.reliableIds.has(track.id)).map(track => {
      const shift = offsets.get(track.id);
      return { id: track.id, box: { ...track.box, x: track.box.x + (shift?.x ?? 0), y: track.box.y + (shift?.y ?? 0) } };
    });
  }
  trackingLost(result:AnalysisResult):boolean{
    return this.failed||this.alignedSequence===result.key.sequence&&!this.reliable;
  }
  canPropagate(result: AnalysisResult, now: number, maxAgeMs = 250): boolean {
    return !this.failed && this.reliable && this.alignedSequence === result.key.sequence &&
      now - result.capturedAtMs <= maxAgeMs && now - this.lastObservedAt <= 100;
  }
  reset(): void {
    this.generation++;
    this.queued?.frame.close(); this.queued = undefined;
    this.inFlight = false;
    this.anchor = undefined;
    this.currentOffsets.clear();
    this.measuredPositions.clear();
    this.measuredAt = 0;
    this.velocities.clear();
    this.lastCaptureRequestedAt = 0;
    this.alignedSequence = -1;
    this.reliable = false;
    this.reliableIds.clear();
    this.lastObservedAt = 0;
    this.offsetAt = 0;
    if (this.connected) this.port?.postMessage({ type: 'reset', generation: this.generation });
  }
  dispose(): void { this.queued?.frame.close(); this.port?.close(); this.host.remove(); }
}
