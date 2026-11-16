// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import type { Rect } from '../state/contracts';

const SIDE = 96;
type Sample = { at: number; gray: Uint8Array };
type MovingTrack = { box: Rect; x: number; y: number; reliable: boolean; weakFrames: number };

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

/** Sparse, bounded patch matching between displayed video frames. */
export function estimateTranslation(previous: Uint8Array, current: Uint8Array, side: number, box: Rect, offsetX = 0, offsetY = 0): { dx: number; dy: number; reliable: boolean } {
  const votesX: number[] = [], votesY: number[] = [];
  for (let gy = 1; gy <= 3; gy++) for (let gx = 1; gx <= 3; gx++) {
    // Pick a textured patch within each part of the person instead of nine
    // fixed points, which often all land on flat skin/clothing and stop moving.
    let x=-1,y=-1,texture=12;
    const left=Math.max(12,Math.floor((box.x+offsetX+box.width*(gx-1)/3)*side));
    const right=Math.min(side-13,Math.ceil((box.x+offsetX+box.width*gx/3)*side));
    const top=Math.max(12,Math.floor((box.y+offsetY+box.height*(gy-1)/3)*side));
    const bottom=Math.min(side-13,Math.ceil((box.y+offsetY+box.height*gy/3)*side));
    for(let py=top;py<=bottom;py+=2)for(let px=left;px<=right;px+=2){
      const score=Math.abs(previous[py*side+px-1]-previous[py*side+px+1])+
        Math.abs(previous[(py-1)*side+px]-previous[(py+1)*side+px]);
      if(score>texture){texture=score;x=px;y=py;}
    }
    if(x<0)continue;
    let best = Infinity, next = Infinity, bestX = 0, bestY = 0;
    const radius=10,diameter=radius*2+1,errors=new Float32Array(diameter*diameter);
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      let error=0;
      for(let py=-1;py<=1;py++)for(let px=-1;px<=1;px++)
        error+=Math.abs(previous[(y+py)*side+x+px]-current[(y+dy+py)*side+x+dx+px]);
      errors[(dy+radius)*diameter+dx+radius]=error;
      if (error < best) { next = best; best = error; bestX = dx; bestY = dy; }
      else if (error < next) next = error;
    }
    if (best < 315 && (next - best > 3 || best < 20)) {
      const center=(bestY+radius)*diameter+bestX+radius;
      const refine=(low:number,high:number)=>{
        const curvature=low-2*best+high;
        return curvature>0?Math.max(-.5,Math.min(.5,(low-high)/(2*curvature))):0;
      };
      const dx=bestX+(Math.abs(bestX)<radius?refine(errors[center-1],errors[center+1]):0);
      const dy=bestY+(Math.abs(bestY)<radius?refine(errors[center-diameter],errors[center+diameter]):0);
      votesX.push(dx);votesY.push(dy);
    }
  }
  if (votesX.length < 3) return { dx: 0, dy: 0, reliable: false };
  const dx = median([...votesX]), dy = median([...votesY]);
  const agrees = votesX.filter((x, i) => Math.abs(x - dx) <= 1 && Math.abs(votesY[i] - dy) <= 1).length;
  return { dx, dy, reliable: agrees >= Math.max(3, Math.ceil(votesX.length * 0.55)) };
}

function sceneCut(a: Uint8Array, b: Uint8Array): boolean {
  let large = 0, total = 0;
  for (let i = 0; i < a.length; i += 4) {
    const difference = Math.abs(a[i] - b[i]);
    if (difference > 70) large++;
    total++;
  }
  return large > total * 0.55;
}

export type MotionAnchor = { capturedAtMs: number; sequence: number; tracks: Array<{ id: string; box: Rect }>; maskIds: string[] };

export class FrameMotionEngine {
  private readonly canvas = new OffscreenCanvas(SIDE, SIDE);
  private readonly context: OffscreenCanvasRenderingContext2D;
  private history: Sample[] = [];
  private moving = new Map<string, MovingTrack>();
  private reference?: Sample;
  private referenceOffsets = new Map<string, { x: number; y: number }>();
  failed = false;
  lastObservedAt = 0;
  alignedSequence = -1;
  frames = 0;

  constructor() {
    const context = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Motion canvas unavailable');
    this.context = context;
  }
  observe(frame: ImageBitmap, at: number): boolean {
    if (this.failed || !frame.width || !frame.height) { frame.close(); return false; }
    try {
      const scale = Math.min(SIDE / frame.width, SIDE / frame.height);
      const w = frame.width * scale, h = frame.height * scale;
      this.context.fillStyle = '#000';
      this.context.fillRect(0, 0, SIDE, SIDE);
      this.context.drawImage(frame, (SIDE - w) / 2, (SIDE - h) / 2, w, h);
      const rgba = this.context.getImageData(0, 0, SIDE, SIDE).data;
      const gray = new Uint8Array(SIDE * SIDE);
      for (let i = 0; i < gray.length; i++) gray[i] = (rgba[4 * i] * 77 + rgba[4 * i + 1] * 150 + rgba[4 * i + 2] * 29) >> 8;
      const previous = this.history.at(-1);
      if (previous && sceneCut(previous.gray, gray)) { this.reset(); this.history.push({ at, gray }); return true; }
      const sample = { at, gray };
      if (previous && this.reference) this.advance(this.reference.gray, gray);
      if (!this.reference || this.referenceShiftExceeded()) {
        this.reference = sample;
        this.referenceOffsets = this.snapshotOffsets();
      }
      this.history.push(sample);
      while (this.history.length > 1 && at - this.history[0].at > 2000) this.history.shift();
      this.lastObservedAt = at;
      this.frames++;
    } catch { this.failed = true; this.moving.clear(); }
    finally { frame.close(); }
    return false;
  }
  private snapshotOffsets(): Map<string, { x: number; y: number }> {
    return new Map([...this.moving].map(([id, track]) => [id, { x: track.x, y: track.y }]));
  }
  private advance(previous: Uint8Array, current: Uint8Array): void {
    for (const [id, track] of this.moving) {
      if (!track.reliable) continue;
      const base = this.referenceOffsets.get(id) ?? { x: 0, y: 0 };
      const motion = estimateTranslation(previous, current, SIDE, track.box, base.x, base.y);
      if (!motion.reliable) { if (++track.weakFrames > 3) track.reliable = false; continue; }
      track.weakFrames = 0;
      track.x = base.x + motion.dx / SIDE;
      track.y = base.y + motion.dy / SIDE;
      if (Math.abs(track.x) > 0.35 || Math.abs(track.y) > 0.35) track.reliable = false;
    }
  }
  align(result: MotionAnchor): void {
    this.moving.clear();
    this.alignedSequence = result.sequence;
    for (const track of result.tracks) this.moving.set(track.id, { box: track.box, x: 0, y: 0, reliable: true, weakFrames: 0 });
    if (!this.history.length) { this.reference = undefined; this.referenceOffsets.clear(); return; }
    let index = 0, distance = Infinity;
    for (let i = 0; i < this.history.length; i++) {
      const delta = Math.abs(this.history[i].at - result.capturedAtMs);
      if (delta < distance) { distance = delta; index = i; }
    }
    if (distance > 120) { for (const track of this.moving.values()) track.reliable = false; return; }
    this.reference = this.history[index];
    this.referenceOffsets = this.snapshotOffsets();
    for (let i = index + 1; i < this.history.length; i++) {
      const sample = this.history[i];
      this.advance(this.reference.gray, sample.gray);
      if (this.referenceShiftExceeded()) {
        this.reference = sample;
        this.referenceOffsets = this.snapshotOffsets();
      }
    }
  }
  offsets(): Map<string, { x: number; y: number }> {
    return new Map([...this.moving.entries()].map(([id, track]) => [id, { x: track.x, y: track.y }]));
  }
  reliable(maskIds: string[]): boolean { return !this.failed && maskIds.every(id => this.moving.get(id)?.reliable); }
  reliableIds(): string[] { return [...this.moving].filter(([, track]) => track.reliable).map(([id]) => id); }
  private referenceShiftExceeded(): boolean {
    for (const [id, track] of this.moving) {
      const base = this.referenceOffsets.get(id);
      if (base && (Math.abs(track.x - base.x) >= 2 / SIDE || Math.abs(track.y - base.y) >= 2 / SIDE)) return true;
    }
    return false;
  }
  reset(): void { this.history = []; this.moving.clear(); this.reference = undefined; this.referenceOffsets.clear(); this.lastObservedAt = 0; this.alignedSequence = -1; }
}
