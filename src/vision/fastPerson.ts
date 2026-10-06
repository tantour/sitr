// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { createOnnxSession, ort, type OnnxBackend } from './ortRuntime';
import { ENGINE } from '../config/settings';
import type { PersonDetection, Rect } from '../state/contracts';

const SIZE = 256;
const asset = (name: string) => `${self.location.origin}/models/${name}`;
type Candidate = { box: Rect; score: number };

function overlap(a: Rect, b: Rect): number {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width), y1 = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return intersection / Math.max(1e-6, a.width * a.height + b.width * b.height - intersection);
}

/** Person-only nonmax suppression on the detection model's pre-TopK head. */
export function decodeFastPersons(data: Float32Array, fields: number, raw: boolean, confidence: number): Candidate[] {
  if (fields !== (raw ? 84 : 6) || data.length % fields) throw new Error('Fast detector output shape mismatch');
  const candidates: Candidate[] = [];
  for (let offset = 0; offset < data.length; offset += fields) {
    if (!raw && data[offset + 5] !== 0) continue;
    const score = data[offset + 4];
    if (!Number.isFinite(score) || score < confidence) continue;
    const x0 = Math.max(0, Math.min(1, data[offset] / SIZE));
    const y0 = Math.max(0, Math.min(1, data[offset + 1] / SIZE));
    const x1 = Math.max(0, Math.min(1, data[offset + 2] / SIZE));
    const y1 = Math.max(0, Math.min(1, data[offset + 3] / SIZE));
    if (x1 - x0 < 0.005 || y1 - y0 < 0.005) continue;
    candidates.push({ box: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const kept: Candidate[] = [];
  for (const candidate of candidates) {
    if (kept.some(item => overlap(item.box, candidate.box) > 0.5)) continue;
    kept.push(candidate);
    if (kept.length >= ENGINE.maxPersonsPerFrame) break;
  }
  return kept;
}

function boxMask(box: Rect): Float32Array {
  const mask = new Float32Array(SIZE * SIZE);
  // A small safety margin covers detector quantization; the video expansion
  // slider supplies the user's additional margin during rendering.
  const margin = 2;
  const x0 = Math.max(0, Math.floor(box.x * SIZE) - margin);
  const y0 = Math.max(0, Math.floor(box.y * SIZE) - margin);
  const x1 = Math.min(SIZE, Math.ceil((box.x + box.width) * SIZE) + margin);
  const y1 = Math.min(SIZE, Math.ceil((box.y + box.height) * SIZE) + margin);
  for (let y = y0; y < y1; y++) mask.fill(1, y * SIZE + x0, y * SIZE + x1);
  return mask;
}

export class FastPersonDetector {
  private session?: ort.InferenceSession;
  private backend: OnnxBackend = 'wasm';
  private readonly input = new Float32Array(3 * SIZE * SIZE);
  private gpuInput?: ort.Tensor;
  private gpuBuffer?: GPUBuffer;
  private gpuDevice?: GPUDevice;
  private lastTimings = { preprocess: 0, run: 0, decode: 0 };
  constructor(private readonly preferredBackend: OnnxBackend = 'webgpu', private readonly threads?: number) {}

  async initialize(): Promise<void> {
    if (this.preferredBackend === 'webgpu' && 'gpu' in navigator) {
      try {
        ort.env.wasm.wasmPaths = `${self.location.origin}/wasm/`;
        ort.env.wasm.numThreads = self.crossOriginIsolated ? this.threads ?? 2 : 1;
        ort.env.webgpu.powerPreference = 'high-performance';
        this.session = await ort.InferenceSession.create(asset('yolo26n-det-256-gpu.onnx'), {
          executionProviders: ['webgpu'], enableGraphCapture: true, graphOptimizationLevel: 'all',
        });
        this.gpuDevice = await ort.env.webgpu.device;
        this.gpuBuffer = this.gpuDevice.createBuffer({ size: this.input.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.gpuInput = ort.Tensor.fromGpuBuffer(this.gpuBuffer, { dataType: 'float32', dims: [1, 3, SIZE, SIZE] });
        this.backend = 'webgpu';
        return;
      } catch (error) {
        console.warn('Fast person WebGPU unavailable, using WASM:', error);
        await this.dispose();
      }
    }
    const loaded = await createOnnxSession(asset('yolo26n-det-256.onnx'), 'wasm', this.threads);
    this.session = loaded.session;
    this.backend = loaded.backend;
  }

  async segment(rgba: Uint8Array, confidence = 0.1): Promise<PersonDetection[]> {
    if (!this.session || rgba.length !== SIZE * SIZE * 4) throw new Error('Fast detector unavailable or input shape mismatch');
    const started = performance.now();
    const pixels = SIZE * SIZE;
    for (let i = 0; i < pixels; i++) {
      this.input[i] = rgba[i * 4] / 255;
      this.input[i + pixels] = rgba[i * 4 + 1] / 255;
      this.input[i + 2 * pixels] = rgba[i * 4 + 2] / 255;
    }
    const prepared = performance.now();
    if (this.gpuBuffer) this.gpuDevice!.queue.writeBuffer(this.gpuBuffer, 0, this.input);
    const outputs = await this.session.run({ [this.session.inputNames[0]]: this.gpuInput ??
      new ort.Tensor('float32', this.input, [1, 3, SIZE, SIZE]) });
    try {
      const tensor = outputs[this.session.outputNames[0]];
      const data = this.gpuInput ? await tensor.getData() : tensor.data;
      const ran = performance.now();
      if (!(data instanceof Float32Array) || tensor.dims.length !== 3 || Number(tensor.dims[2]) !== (this.gpuInput ? 84 : 6))
        throw new Error('Fast detector output contract mismatch');
      const boxes = decodeFastPersons(data, Number(tensor.dims[2]), !!this.gpuInput, confidence);
      const result = boxes.map(({ box, score }) => ({ box, score, mask: boxMask(box), maskWidth: SIZE, maskHeight: SIZE }));
      this.lastTimings = { preprocess: prepared - started, run: ran - prepared, decode: performance.now() - ran };
      return result;
    } finally { for (const tensor of Object.values(outputs)) tensor.dispose(); }
  }

  getBackend(): string { return `${this.backend}-fast-box`; }
  getLastTimings(): { preprocess: number; run: number; decode: number } { return this.lastTimings; }
  async dispose(): Promise<void> {
    try { await this.session?.release(); }
    finally { this.session = undefined; this.gpuInput = undefined; this.gpuBuffer?.destroy(); this.gpuBuffer = undefined; }
  }
}
