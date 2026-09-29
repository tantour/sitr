import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import type { Rect } from '../state/contracts';
const extensionAsset = (path: string): string => `${self.location.origin}/${path}`;

export class SelfieSemanticSegmenter {
  private segmenter?: ImageSegmenter;
  private backend: 'gpu' | 'cpu' = 'cpu';
  private canvas = new OffscreenCanvas(1, 1);
  private lastTimings = { preprocess: 0, run: 0, decode: 0 };
  constructor(private readonly tryGpu = true) {}
  async initialize(): Promise<void> {
    const files = await FilesetResolver.forVisionTasks(extensionAsset('wasm'));
    const modelAssetPath = extensionAsset('models/selfie_multiclass_256x256.tflite');
    if (this.tryGpu) {
      try {
        this.segmenter = await ImageSegmenter.createFromOptions(files, {
          baseOptions: { modelAssetPath, delegate: 'GPU' },
          runningMode: 'IMAGE', outputCategoryMask: true, outputConfidenceMasks: false,
        });
        this.backend = 'gpu';
      } catch { this.segmenter = undefined; }
    }
    if (!this.segmenter) {
      this.segmenter = await ImageSegmenter.createFromOptions(files, {
        baseOptions: { modelAssetPath, delegate: 'CPU' },
        runningMode: 'IMAGE', outputCategoryMask: true, outputConfidenceMasks: false,
      });
      this.backend = 'cpu';
    }
  }
  segment(rgba: Uint8Array, size: number): Uint8Array {
    if (!this.segmenter) throw new Error('Semantic model unavailable');
    const started = performance.now();
    if (this.canvas.width !== size) this.canvas.width = this.canvas.height = size;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), size, size), 0, 0);
    let raw: Uint8Array | undefined;
    const runAt = performance.now();
    this.segmenter.segment(this.canvas, result => { raw = result.categoryMask?.getAsUint8Array().slice(); });
    const decodeAt = performance.now();
    if (!raw) throw new Error('Semantic category mask missing');
    const side = Math.sqrt(raw.length);
    if (!Number.isInteger(side)) throw new Error('Semantic category mask shape mismatch');
    const mask = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) mask[y * size + x] = raw[Math.min(side - 1, Math.floor(y * side / size)) * side + Math.min(side - 1, Math.floor(x * side / size))];
    this.lastTimings = { preprocess: runAt - started, run: decodeAt - runAt, decode: performance.now() - decodeAt };
    return mask;
  }
  dispose(): void { this.segmenter?.close(); this.segmenter = undefined; }
  getBackend(): string { return this.backend; }
  getLastTimings(): { preprocess: number; run: number; decode: number } { return this.lastTimings; }
}

export interface FaceBox { box: Rect; score: number; nose?: { x: number; y: number } }
