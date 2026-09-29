import type { Rect } from '../state/contracts';

const SIDE = 96;
type Sample = { at: number; gray: Uint8Array };
type MovingTrack = { box: Rect; x: number; y: number; reliable: boolean; weakFrames: number };

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

/** Sparse, bounded block matching between adjacent displayed video frames. */
export function estimateTranslation(previous: Uint8Array, current: Uint8Array, side: number, box: Rect, offsetX = 0, offsetY = 0): { dx: number; dy: number; reliable: boolean } {
  const votesX: number[] = [], votesY: number[] = [];
  for (let gy = 1; gy <= 3; gy++) for (let gx = 1; gx <= 3; gx++) {
    const x = Math.round((box.x + offsetX + box.width * gx / 4) * side);
    const y = Math.round((box.y + offsetY + box.height * gy / 4) * side);
    if (x < 5 || y < 5 || x >= side - 5 || y >= side - 5) continue;
    const texture = Math.abs(previous[y * side + x - 1] - previous[y * side + x + 1]) +
      Math.abs(previous[(y - 1) * side + x] - previous[(y + 1) * side + x]);
    if (texture < 22) continue;
    let best = Infinity, next = Infinity, bestX = 0, bestY = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const source = y * side + x;
      const target = (y + dy) * side + x + dx;
      const error = Math.abs(previous[source] - current[target]) +
        Math.abs(previous[source - 1] - current[target - 1]) +
        Math.abs(previous[source + 1] - current[target + 1]) +
        Math.abs(previous[source - side] - current[target - side]) +
        Math.abs(previous[source + side] - current[target + side]);
      if (error < best) { next = best; best = error; bestX = dx; bestY = dy; }
      else if (error < next) next = error;
    }
    if (best < 110 && (next - best > 5 || best < 12)) { votesX.push(bestX); votesY.push(bestY); }
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
      if (previous) this.advance(previous.gray, gray);
      this.history.push({ at, gray });
      if (this.history.length > 90) this.history.shift();
      this.lastObservedAt = at;
      this.frames++;
    } catch { this.failed = true; this.moving.clear(); }
    finally { frame.close(); }
    return false;
  }
  private advance(previous: Uint8Array, current: Uint8Array): void {
    for (const track of this.moving.values()) {
      if (!track.reliable) continue;
      const motion = estimateTranslation(previous, current, SIDE, track.box, track.x, track.y);
      if (!motion.reliable) { if (++track.weakFrames > 10) track.reliable = false; continue; }
      track.weakFrames = 0;
      track.x += motion.dx / SIDE;
      track.y += motion.dy / SIDE;
      if (Math.abs(track.x) > 0.35 || Math.abs(track.y) > 0.35) track.reliable = false;
    }
  }
  align(result: MotionAnchor): void {
    this.moving.clear();
    this.alignedSequence = result.sequence;
    const ids = new Set(result.maskIds);
    for (const track of result.tracks) if (ids.has(track.id)) this.moving.set(track.id, { box: track.box, x: 0, y: 0, reliable: true, weakFrames: 0 });
    if (!this.history.length) return;
    let index = 0, distance = Infinity;
    for (let i = 0; i < this.history.length; i++) {
      const delta = Math.abs(this.history[i].at - result.capturedAtMs);
      if (delta < distance) { distance = delta; index = i; }
    }
    if (distance > 120) { for (const track of this.moving.values()) track.reliable = false; return; }
    for (let i = index + 1; i < this.history.length; i++) this.advance(this.history[i - 1].gray, this.history[i].gray);
  }
  offsets(): Map<string, { x: number; y: number }> {
    return new Map([...this.moving.entries()].map(([id, track]) => [id, { x: track.x, y: track.y }]));
  }
  reliable(maskIds: string[]): boolean { return !this.failed && maskIds.every(id => this.moving.get(id)?.reliable); }
  reset(): void { this.history = []; this.moving.clear(); this.lastObservedAt = 0; this.alignedSequence = -1; }
}
