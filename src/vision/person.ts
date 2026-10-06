// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { createOnnxSession, ort, type OnnxBackend } from './ortRuntime';
import { ENGINE } from '../config/settings';
import type { PersonDetection, Rect } from '../state/contracts';
import { YoloMaskDecoder } from './maskDecode';
import { selectYoloRecords } from './yoloRecords';
const extensionAsset = (path: string): string => `${self.location.origin}/${path}`;

function boxFrom(values: Float32Array, offset: number, size: number): Rect {
  return { x: values[offset] / size, y: values[offset + 1] / size,
    width: (values[offset + 2] - values[offset]) / size,
    height: (values[offset + 3] - values[offset + 1]) / size };
}

export class YoloPersonSegmenter {
  private session?: ort.InferenceSession;
  private backend: OnnxBackend = 'wasm';
  private input: Float32Array<ArrayBuffer>;
  private gpuInput?: ort.Tensor;
  private gpuBuffer?: GPUBuffer;
  private gpuDevice?: GPUDevice;
  private lastTimings = { preprocess: 0, run: 0, decode: 0 };
  constructor(private readonly size: number, private readonly preferredBackend: OnnxBackend = 'webgpu', private readonly threads?: number) {
    this.input = new Float32Array(3 * size * size);
  }

  async initialize(): Promise<void> {
    if (this.preferredBackend === 'webgpu' && 'gpu' in navigator) {
      try {
        ort.env.wasm.wasmPaths = `${self.location.origin}/wasm/`;
        ort.env.wasm.numThreads = self.crossOriginIsolated ? this.threads ?? 2 : 1;
        ort.env.webgpu.powerPreference = 'high-performance';
        // TopK is not supported by this WebGPU runtime. The derived graph exposes
        // its unselected head, allowing all compute to stay on GPU and be replayed.
        this.session = await ort.InferenceSession.create(extensionAsset(`models/yolo26n-seg-${this.size}-gpu.onnx`), {
          executionProviders: ['webgpu'], enableGraphCapture: true, graphOptimizationLevel: 'all',
        });
        this.gpuDevice = await ort.env.webgpu.device;
        const buffer = this.gpuDevice.createBuffer({ size: this.input.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.gpuBuffer = buffer;
        this.gpuInput = ort.Tensor.fromGpuBuffer(buffer, { dataType: 'float32', dims: [1, 3, this.size, this.size] });
        this.backend = 'webgpu';
        return;
      } catch (error) {
        console.warn('Captured YOLO WebGPU unavailable, using WASM:', error);
        await this.dispose();
      }
    }
    const model = extensionAsset(`models/yolo26n-seg-${this.size}.onnx`);
    const loaded = await createOnnxSession(model, 'wasm', this.threads);
    this.session = loaded.session;
    this.backend = loaded.backend;
    if (this.session.inputNames.length !== 1 || this.session.outputNames.length < 2) throw new Error('YOLO export contract mismatch');
  }

  async segment(rgba: Uint8Array, confidenceThreshold = 0.1): Promise<PersonDetection[]> {
    if (!this.session) throw new Error('YOLO session is unavailable');
    if (rgba.length !== this.size * this.size * 4) throw new Error('YOLO input shape mismatch');
    const pixels = this.size * this.size;
    const started = performance.now();
    const input = this.input;
    for (let i = 0; i < pixels; i++) {
      input[i] = rgba[4 * i] / 255;
      input[pixels + i] = rgba[4 * i + 1] / 255;
      input[2 * pixels + i] = rgba[4 * i + 2] / 255;
    }
    const preparedAt = performance.now();
    if (this.gpuBuffer) this.gpuDevice!.queue.writeBuffer(this.gpuBuffer, 0, input);
    const outputs = await this.session.run({ [this.session.inputNames[0]]: this.gpuInput ?? new ort.Tensor('float32', input, [1, 3, this.size, this.size]) });
    try {
      // Include GPU completion/readback in run timing, not just command submission.
      if (this.gpuInput) await Promise.all(Object.values(outputs).map(tensor => tensor.getData()));
      const ranAt = performance.now();
      const tensors = this.session.outputNames.map(name => outputs[name]);
      const detection = tensors.find(t => t.dims.length === 3);
      const prototypes = tensors.find(t => t.dims.length === 4);
      if (!detection || !prototypes || !(detection.data instanceof Float32Array) || !(prototypes.data instanceof Float32Array)) throw new Error('YOLO output tensor contract mismatch');
      const channels = Number(prototypes.dims[1]);
      const protoHeight = Number(prototypes.dims[2]);
      const protoWidth = Number(prototypes.dims[3]);
      const raw = this.backend === 'webgpu';
      const fields = raw ? 6 + channels : Number(detection.dims[2]);
      const rows = raw ? 300 : Number(detection.dims[1]);
      if (fields !== 6 + channels || rows > 1000 || channels > 64) throw new Error(`Unexpected YOLO record shape: ${detection.dims}`);
      const records = raw ? selectYoloRecords(detection.data, Number(detection.dims[1]), Number(detection.dims[2])) : detection.data;
      const proto = prototypes.data;
      const results: PersonDetection[] = [];
      const decoder = new YoloMaskDecoder(proto, channels, protoWidth, protoHeight, this.size);
      for (let r = 0; r < rows; r++) {
        const offset = r * fields;
        if (records[offset + 5] !== 0 || records[offset + 4] < confidenceThreshold) continue;
        const box = boxFrom(records, offset, this.size);
        if (box.width <= 0 || box.height <= 0) continue;
        const mask = decoder.decode(records, offset, box);
        results.push({ box, score: records[offset + 4], mask, maskWidth: this.size, maskHeight: this.size });
      }
      if (results.length > ENGINE.maxPersonsPerFrame) throw new Error('Person capacity exceeded');
      this.lastTimings = { preprocess: preparedAt - started, run: ranAt - preparedAt, decode: performance.now() - ranAt };
      return results;
    } finally {
      // Release per-run ORT tensor handles; the session retains captured buffers.
      for (const tensor of Object.values(outputs)) tensor.dispose();
    }
  }

  getBackend(): string { return this.backend; }
  getLastTimings(): { preprocess: number; run: number; decode: number } { return this.lastTimings; }
  async dispose(): Promise<void> {
    try { await this.session?.release(); }
    finally { this.session = undefined; this.gpuInput = undefined; this.gpuBuffer?.destroy(); this.gpuBuffer = undefined; }
  }
}
