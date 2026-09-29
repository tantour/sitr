import { createOnnxSession, ort, type OnnxBackend } from './ortRuntime';
import type { FaceBox } from './semantic';

type Candidate = { x: number; y: number; width: number; height: number; score: number; noseX: number; noseY: number };
const STRIDES = [8, 16, 32] as const;
const OUTPUTS = ['cls_8', 'cls_16', 'cls_32', 'obj_8', 'obj_16', 'obj_32', 'bbox_8', 'bbox_16', 'bbox_32', 'kps_8', 'kps_16', 'kps_32'];

function overlap(a: Candidate, b: Candidate): number {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width), y1 = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return intersection / Math.max(1, a.width * a.height + b.width * b.height - intersection);
}

/** OpenCV YuNet output contract, including the five-point nose landmark. */
export function decodeYuNet(outputs: Record<string, ort.Tensor>, size: number, floor = 0.1): FaceBox[] {
  const candidates: Candidate[] = [];
  for (const stride of STRIDES) {
    const cells = size / stride;
    if (!Number.isInteger(cells)) throw new Error('YuNet input side must be divisible by 32');
    const read = (name: string, width: number): Float32Array => {
      const tensor = outputs[`${name}_${stride}`];
      if (!tensor || !(tensor.data instanceof Float32Array) || tensor.data.length !== cells * cells * width) {
        throw new Error(`YuNet output contract mismatch: ${name}_${stride}`);
      }
      return tensor.data;
    };
    const cls = read('cls', 1), obj = read('obj', 1), bbox = read('bbox', 4), kps = read('kps', 10);
    for (let index = 0; index < cells * cells; index++) {
      const score = Math.sqrt(Math.max(0, Math.min(1, cls[index])) * Math.max(0, Math.min(1, obj[index])));
      if (!Number.isFinite(score) || score < floor) continue;
      const row = Math.floor(index / cells), column = index % cells;
      const centerX = (column + bbox[index * 4]) * stride;
      const centerY = (row + bbox[index * 4 + 1]) * stride;
      const width = Math.exp(bbox[index * 4 + 2]) * stride;
      const height = Math.exp(bbox[index * 4 + 3]) * stride;
      if (![centerX, centerY, width, height].every(Number.isFinite) || width < 2 || height < 2 || width > size * 2 || height > size * 2) continue;
      candidates.push({ x: centerX - width / 2, y: centerY - height / 2, width, height, score,
        noseX: (column + kps[index * 10 + 4]) * stride, noseY: (row + kps[index * 10 + 5]) * stride });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const kept: Candidate[] = [];
  for (const candidate of candidates.slice(0, 300)) {
    if (kept.some(prior => overlap(prior, candidate) > 0.3)) continue;
    kept.push(candidate);
    if (kept.length === 100) break;
  }
  return kept.map(face => ({
    box: { x: face.x / size, y: face.y / size, width: face.width / size, height: face.height / size },
    score: face.score,
    nose: { x: face.noseX / size, y: face.noseY / size },
  }));
}

export class OptionalFaceDetector {
  private session?: ort.InferenceSession;
  private backend: OnnxBackend = 'wasm';
  private source = new OffscreenCanvas(1, 1);
  private resized: OffscreenCanvas;
  private lastTimings = { preprocess: 0, run: 0, decode: 0 };
  constructor(private readonly preferredBackend: OnnxBackend = 'wasm', private readonly threads?: number,
    private readonly detectorSide: 256 | 320 | 416 = 320) {
    this.resized = new OffscreenCanvas(detectorSide, detectorSide);
  }

  async initialize(): Promise<void> {
    const loaded = await createOnnxSession(`${self.location.origin}/models/yunet-2026may.onnx`, this.preferredBackend, this.threads);
    const session = loaded.session;
    this.backend = loaded.backend;
    if (session.inputNames.length !== 1 || session.inputNames[0] !== 'input' || OUTPUTS.some(name => !session.outputNames.includes(name))) {
      await session.release();
      throw new Error('YuNet model contract mismatch');
    }
    this.session = session;
  }
  getBackend(): string { return this.backend; }
  getLastTimings(): { preprocess: number; run: number; decode: number } { return this.lastTimings; }

  async detect(rgba: Uint8Array, size: number): Promise<FaceBox[]> {
    if (!this.session || rgba.length !== size * size * 4 || size <= 0 || size > 640) throw new Error('YuNet input invalid');
    const started = performance.now();
    let detectorRgba = rgba;
    if (size !== this.detectorSide) {
      if (this.source.width !== size) this.source.width = this.source.height = size;
      const source = this.source.getContext('2d');
      const target = this.resized.getContext('2d', { willReadFrequently: true });
      if (!source || !target) throw new Error('YuNet resize canvas unavailable');
      source.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), size, size), 0, 0);
      target.clearRect(0, 0, this.detectorSide, this.detectorSide);
      target.drawImage(this.source, 0, 0, this.detectorSide, this.detectorSide);
      detectorRgba = new Uint8Array(target.getImageData(0, 0, this.detectorSide, this.detectorSide).data);
    }
    const pixels = this.detectorSide * this.detectorSide;
    const input = new Float32Array(pixels * 3);
    // OpenCV FaceDetectorYN uses blobFromImage defaults: unscaled BGR, NCHW.
    for (let index = 0; index < pixels; index++) {
      input[index] = detectorRgba[index * 4 + 2];
      input[pixels + index] = detectorRgba[index * 4 + 1];
      input[pixels * 2 + index] = detectorRgba[index * 4];
    }
    const runAt = performance.now();
    const output = await this.session.run({ input: new ort.Tensor('float32', input, [1, 3, this.detectorSide, this.detectorSide]) });
    const decodeAt = performance.now();
    const boxes = decodeYuNet(output, this.detectorSide);
    this.lastTimings = { preprocess: runAt - started, run: decodeAt - runAt, decode: performance.now() - decodeAt };
    return boxes;
  }

  async dispose(): Promise<void> { await this.session?.release(); this.session = undefined; }
}
