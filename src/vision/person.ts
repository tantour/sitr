import { createOnnxSession, ort, type OnnxBackend } from './ortRuntime';
import { ENGINE } from '../config/settings';
import type { PersonDetection, Rect } from '../state/contracts';
import { YoloMaskDecoder } from './maskDecode';
const extensionAsset = (path: string): string => `${self.location.origin}/${path}`;

function boxFrom(values: Float32Array, offset: number, size: number): Rect {
  return { x: values[offset] / size, y: values[offset + 1] / size,
    width: (values[offset + 2] - values[offset]) / size,
    height: (values[offset + 3] - values[offset + 1]) / size };
}

export class YoloPersonSegmenter {
  private session?: ort.InferenceSession;
  private backend: OnnxBackend = 'wasm';
  private input: Float32Array;
  private lastTimings = { preprocess: 0, run: 0, decode: 0 };
  constructor(private readonly size: number, private readonly preferredBackend: OnnxBackend = 'wasm', private readonly threads?: number) {
    this.input = new Float32Array(3 * size * size);
  }

  async initialize(): Promise<void> {
    const model = extensionAsset(`models/yolo26n-seg-${this.size}.onnx`);
    const loaded = await createOnnxSession(model, this.preferredBackend, this.threads);
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
    const outputs = await this.session.run({ [this.session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, this.size, this.size]) });
    const ranAt = performance.now();
    const tensors = this.session.outputNames.map(name => outputs[name]);
    const detection = tensors.find(t => t.dims.length === 3);
    const prototypes = tensors.find(t => t.dims.length === 4);
    if (!detection || !prototypes || !(detection.data instanceof Float32Array) || !(prototypes.data instanceof Float32Array)) throw new Error('YOLO output tensor contract mismatch');
    const channels = Number(prototypes.dims[1]);
    const protoHeight = Number(prototypes.dims[2]);
    const protoWidth = Number(prototypes.dims[3]);
    const fields = Number(detection.dims[2]);
    const rows = Number(detection.dims[1]);
    if (fields !== 6 + channels || rows > 1000 || channels > 64) throw new Error(`Unexpected YOLO record shape: ${detection.dims}`);
    const records = detection.data;
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
  }

  getBackend(): string { return this.backend; }
  getLastTimings(): { preprocess: number; run: number; decode: number } { return this.lastTimings; }
  async dispose(): Promise<void> { await this.session?.release(); this.session = undefined; }
}
