// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { createOnnxSession, ort, type OnnxBackend } from './ortRuntime';
import type { BodyRegionMode } from '../config/settings';
import { decodeBodyRegions } from './bodyRegionMap';

export class BodyPixRegionSegmenter {
  private session?: ort.InferenceSession;
  private backend: OnnxBackend = 'wasm';
  private readonly side: number;
  private readonly grid: number;
  private readonly input: Float32Array<ArrayBuffer>;
  private readonly canvas: OffscreenCanvas;
  private source = new OffscreenCanvas(1, 1);
  private gpuBuffer?: GPUBuffer;
  private gpuInput?: ort.Tensor;
  private device?: GPUDevice;
  private lastTimings = { preprocess: 0, run: 0, decode: 0 };
  constructor(readonly mode: Exclude<BodyRegionMode, 'off'>, private readonly preference: OnnxBackend = 'webgpu', private readonly threads?: number) {
    this.side = mode === 'faster' ? 257 : 321;
    this.grid = mode === 'faster' ? 17 : 41;
    this.input = new Float32Array(3 * this.side * this.side);
    this.canvas = new OffscreenCanvas(this.side, this.side);
  }
  async initialize(): Promise<void> {
    const name = this.mode === 'faster' ? 'bodypix-mobilenet075-stride16-257.onnx' : 'bodypix-mobilenet075-stride8-321.onnx';
    const url = `${self.location.origin}/models/${name}`;
    if (this.preference === 'webgpu' && 'gpu' in navigator) {
      try {
        ort.env.wasm.wasmPaths = `${self.location.origin}/wasm/`;
        ort.env.wasm.numThreads = self.crossOriginIsolated ? this.threads ?? 2 : 1;
        ort.env.webgpu.powerPreference = 'high-performance';
        this.session = await ort.InferenceSession.create(url, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all', enableGraphCapture: true });
        const device = await ort.env.webgpu.device;
        this.device = device;
        this.gpuBuffer = device.createBuffer({ size: this.input.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.gpuInput = ort.Tensor.fromGpuBuffer(this.gpuBuffer, { dataType: 'float32', dims: [1, 3, this.side, this.side] });
        this.backend = 'webgpu';
        return;
      } catch (error) {
        console.warn('BodyPix WebGPU unavailable, using WASM:', error);
        await this.dispose();
      }
    }
    const loaded = await createOnnxSession(url, 'wasm', this.threads);
    this.session = loaded.session;
    this.backend = loaded.backend;
  }
  async segment(rgba: Uint8Array, side: number, semantic: Uint8Array): Promise<Uint8Array> {
    if (!this.session || rgba.length !== side * side * 4 || semantic.length !== side * side) throw new Error('BodyPix input grid mismatch');
    const started = performance.now();
    if (this.source.width !== side) this.source.width = this.source.height = side;
    const src = this.source.getContext('2d'), ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!src || !ctx) throw new Error('BodyPix canvas unavailable');
    src.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), side, side), 0, 0);
    ctx.drawImage(this.source, 0, 0, this.side, this.side);
    const pixels = ctx.getImageData(0, 0, this.side, this.side).data, count = this.side * this.side;
    for (let p = 0; p < count; p++) for (let ch = 0; ch < 3; ch++) this.input[ch * count + p] = pixels[p * 4 + ch] / 127.5 - 1;
    if (this.gpuBuffer) this.device!.queue.writeBuffer(this.gpuBuffer, 0, this.input);
    const runAt = performance.now();
    const outputs = await this.session.run({ sub_2: this.gpuInput ?? new ort.Tensor('float32', this.input, [1, 3, this.side, this.side]) });
    try {
      const partTensor = outputs.float_part_heatmaps, foregroundTensor = outputs.float_segments;
      if (!partTensor || !foregroundTensor || partTensor.dims.join(',') !== `1,24,${this.grid},${this.grid}` ||
          foregroundTensor.dims.join(',') !== `1,1,${this.grid},${this.grid}`) throw new Error('BodyPix output contract mismatch');
      const [parts, foreground] = await Promise.all([partTensor.getData(), foregroundTensor.getData()]);
      if (!(parts instanceof Float32Array) || !(foreground instanceof Float32Array)) throw new Error('BodyPix output precision mismatch');
      const decodeAt = performance.now();
      const map = decodeBodyRegions(parts, foreground, this.grid, semantic, side);
      this.lastTimings = { preprocess: runAt - started, run: decodeAt - runAt, decode: performance.now() - decodeAt };
      return map;
    } finally { for (const tensor of Object.values(outputs)) tensor.dispose(); }
  }
  getBackend(): string { return this.backend; }
  getInputSize(): number { return this.side; }
  getLastTimings(): { preprocess: number; run: number; decode: number } { return this.lastTimings; }
  async dispose(): Promise<void> {
    try { await this.session?.release(); }
    finally { this.session = undefined; this.gpuInput = undefined; this.gpuBuffer?.destroy(); this.gpuBuffer = undefined; this.device = undefined; }
  }
}
