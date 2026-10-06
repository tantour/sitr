// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { createOnnxSession, ort, type OnnxBackend } from './ortRuntime';
import type { Rect } from '../state/contracts';
import type { GenderEstimate } from './gender';
import { ENGINE } from '../config/settings';
import { normalizeRgb } from './normalization';

export type BodyGenderModel = 'intel' | 'paddle';

const MODELS = {
  intel: { file: 'body-intel-0230.onnx', width: 80, height: 160, input: '0', output: '453/sink_port_0' },
  paddle: { file: 'body-paddle-pplcnet.onnx', width: 192, height: 256, input: 'x', output: 'sigmoid_2.tmp_0' },
} as const;

/** Classifies a detected person's full crop without requiring a face. */
export class BodyGenderClassifier {
  private session?: ort.InferenceSession;
  private backend: OnnxBackend = 'wasm';
  private source = new OffscreenCanvas(1, 1);
  private crop: OffscreenCanvas;
  private input = new Float32Array(0);
  private lastTimings = { preprocess: 0, run: 0, decode: 0 };

  constructor(private readonly model: BodyGenderModel, private readonly preferredBackend: OnnxBackend = 'wasm',
    private readonly threads?: number) {
    const spec = MODELS[model];
    this.crop = new OffscreenCanvas(spec.width, spec.height);
  }

  async initialize(): Promise<void> {
    const spec = MODELS[this.model];
    const loaded = await createOnnxSession(`${self.location.origin}/models/${spec.file}`, this.preferredBackend, this.threads);
    if (loaded.session.inputNames.length !== 1 || loaded.session.inputNames[0] !== spec.input ||
      !loaded.session.outputNames.includes(spec.output)) {
      await loaded.session.release();
      throw new Error('Body gender model contract mismatch');
    }
    this.session = loaded.session;
    this.backend = loaded.backend;
  }

  getBackend(): string { return this.backend; }
  getLastTimings(): { preprocess: number; run: number; decode: number } { return this.lastTimings; }

  async classify(rgba: Uint8Array, size: number, boxes: Rect[]): Promise<GenderEstimate[]> {
    if (!this.session) throw new Error('Body gender model unavailable');
    if (!boxes.length) return [];
    if (boxes.length > ENGINE.maxPersonsPerFrame || rgba.length !== size * size * 4) throw new Error('Body gender input invalid');
    const started = performance.now();
    const spec = MODELS[this.model];
    if (this.source.width !== size) this.source.width = this.source.height = size;
    const sourceContext = this.source.getContext('2d');
    const cropContext = this.crop.getContext('2d', { willReadFrequently: true });
    if (!sourceContext || !cropContext) throw new Error('Body gender crop canvas unavailable');
    sourceContext.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer,
      rgba.byteOffset, rgba.byteLength), size, size), 0, 0);
    const pixels = spec.width * spec.height;
    const inputLength = boxes.length * 3 * pixels;
    if (this.input.length < inputLength) this.input = new Float32Array(inputLength);
    const valid: number[] = [];
    for (let index = 0; index < boxes.length; index++) {
      const box = boxes[index];
      if (box.width <= 0 || box.height <= 0) continue;
      cropContext.fillStyle = '#000';
      cropContext.fillRect(0, 0, spec.width, spec.height);
      cropContext.drawImage(this.source, box.x * size, box.y * size, box.width * size, box.height * size,
        0, 0, spec.width, spec.height);
      const crop = cropContext.getImageData(0, 0, spec.width, spec.height).data;
      const input = this.input.subarray(valid.length * 3 * pixels, (valid.length + 1) * 3 * pixels);
      if (this.model === 'intel') {
        for (let pixel = 0; pixel < pixels; pixel++) {
          const r = crop[pixel * 4], g = crop[pixel * 4 + 1], b = crop[pixel * 4 + 2];
          input[pixel] = b;
          input[pixels + pixel] = g;
          input[2 * pixels + pixel] = r;
        }
      } else normalizeRgb(crop, input);
      valid.push(index);
    }
    const runAt = performance.now();
    const probabilities = new Array<number | undefined>(boxes.length).fill(undefined);
    if (this.model === 'paddle') {
      if (valid.length) {
        const batch = this.input.subarray(0, valid.length * 3 * pixels);
        const output = await this.session.run({ [spec.input]: new ort.Tensor('float32', batch,
          [valid.length, 3, spec.height, spec.width]) }, [spec.output]);
        try {
          const data = output[spec.output].data;
          if (!(data instanceof Float32Array) || data.length !== valid.length * 26)
            throw new Error('Paddle body gender output invalid');
          valid.forEach((originalIndex, index) => { probabilities[originalIndex] = data[index * 26 + 22]; });
        } finally { for (const tensor of Object.values(output)) tensor.dispose(); }
      }
    } else {
      for (const [position, index] of valid.entries()) {
        const input = this.input.subarray(position * 3 * pixels, (position + 1) * 3 * pixels);
        const output = await this.session.run({ [spec.input]: new ort.Tensor('float32', input,
          [1, 3, spec.height, spec.width]) }, [spec.output]);
        try {
          const data = output[spec.output].data;
          if (!(data instanceof Float32Array) || data.length !== 8)
            throw new Error('Intel body gender output invalid');
          probabilities[index] = 1 - data[0];
        } finally { for (const tensor of Object.values(output)) tensor.dispose(); }
      }
    }
    const decodeAt = performance.now();
    const estimates = probabilities.map((female): GenderEstimate => {
      if (female === undefined || !Number.isFinite(female) || female < 0 || female > 1) return undefined;
      return { label: female >= 0.5 ? 'female' : 'male', confidence: Math.max(female, 1 - female) };
    });
    this.lastTimings = { preprocess: runAt - started, run: decodeAt - runAt, decode: performance.now() - decodeAt };
    return estimates;
  }

  async dispose(): Promise<void> { await this.session?.release(); this.session = undefined; }
}
