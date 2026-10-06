// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { createOnnxSession, ort, type OnnxBackend } from './ortRuntime';
import { ENGINE } from '../config/settings';
import type { Rect } from '../state/contracts';
import { normalizeRgb } from './normalization';

const FACE_SIDE = 128;
export type GenderEstimate = { label: 'male' | 'female'; confidence: number } | undefined;

/** FastFace Large RGB face crops. Age outputs are deliberately ignored. */
export class AppearanceGenderClassifier {
  private session?: ort.InferenceSession;
  private backend: OnnxBackend = 'wasm';
  private source = new OffscreenCanvas(1, 1);
  private crop = new OffscreenCanvas(FACE_SIDE, FACE_SIDE);
  private input = new Float32Array(0);
  private lastTimings = { preprocess: 0, run: 0, decode: 0 };
  constructor(private readonly preferredBackend: OnnxBackend = 'wasm', private readonly threads?: number) {}

  async initialize(): Promise<void> {
    const loaded = await createOnnxSession(`${self.location.origin}/models/fastface-large-128.onnx`, this.preferredBackend, this.threads);
    const session = loaded.session;
    this.backend = loaded.backend;
    if (session.inputNames.length !== 1 || session.inputNames[0] !== 'image' || !session.outputNames.includes('gender_logits')) {
      await session.release();
      throw new Error('Gender model contract mismatch');
    }
    this.session = session;
  }
  getBackend(): string { return this.backend; }
  getLastTimings(): { preprocess: number; run: number; decode: number } { return this.lastTimings; }

  async classify(rgba: Uint8Array, size: number, boxes: Rect[]): Promise<GenderEstimate[]> {
    if (!this.session) throw new Error('Gender model unavailable');
    if (!boxes.length) return [];
    if (boxes.length > ENGINE.maxPersonsPerFrame || rgba.length !== size * size * 4) throw new Error('Gender input invalid');
    const started = performance.now();
    if (this.source.width !== size) this.source.width = this.source.height = size;
    const sourceContext = this.source.getContext('2d');
    const cropContext = this.crop.getContext('2d', { willReadFrequently: true });
    if (!sourceContext || !cropContext) throw new Error('Gender crop canvas unavailable');
    sourceContext.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), size, size), 0, 0);
    const pixels = FACE_SIDE * FACE_SIDE;
    const inputLength = boxes.length * 3 * pixels;
    if (this.input.length < inputLength) this.input = new Float32Array(inputLength);
    const input = this.input.subarray(0, inputLength);
    for (const [faceIndex, box] of boxes.entries()) {
      // Match FastFace's 20% face-crop margin. A wider crop can make profile
      // faces mostly hair/background and produced wrong labels in our fixtures.
      const side = Math.max(box.width, box.height) * size * 1.2;
      const centerX = (box.x + box.width / 2) * size;
      const centerY = (box.y + box.height / 2) * size;
      cropContext.fillStyle = '#000';
      cropContext.fillRect(0, 0, FACE_SIDE, FACE_SIDE);
      cropContext.drawImage(this.source, centerX - side / 2, centerY - side / 2, side, side, 0, 0, FACE_SIDE, FACE_SIDE);
      const crop = cropContext.getImageData(0, 0, FACE_SIDE, FACE_SIDE).data;
      const start = faceIndex * 3 * pixels;
      normalizeRgb(crop, input, start);
    }
    const runAt = performance.now();
    const output = await this.session.run({ [this.session.inputNames[0]]: new ort.Tensor('float32', input, [boxes.length, 3, FACE_SIDE, FACE_SIDE]) }, ['gender_logits']);
    try {
      const decodeAt = performance.now();
      const tensor = output.gender_logits;
      const data = tensor.data;
      if (!(data instanceof Float32Array) || data.length !== boxes.length * 2) throw new Error('Gender output contract mismatch');
      const estimates = boxes.map((_, index): GenderEstimate => {
        const female = data[index * 2];
        const male = data[index * 2 + 1];
        if (!Number.isFinite(female) || !Number.isFinite(male)) return undefined;
        const confidence = 1 / (1 + Math.exp(-Math.abs(male - female)));
        return { label: male > female ? 'male' : 'female', confidence };
      });
      this.lastTimings = { preprocess: runAt - started, run: decodeAt - runAt, decode: performance.now() - decodeAt };
      return estimates;
    } finally { for (const tensor of Object.values(output)) tensor.dispose(); }
  }

  async dispose(): Promise<void> { await this.session?.release(); this.session = undefined; }
}
