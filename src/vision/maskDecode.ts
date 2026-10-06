// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import type { Rect } from '../state/contracts';

function sigmoid(value: number): number { return 1 / (1 + Math.exp(-value)); }

export class YoloMaskDecoder {
  private readonly protoPixels: number;
  private readonly decoded: Float32Array;
  private readonly decodedGeneration: Uint32Array;
  private generation = 0;

  constructor(private readonly proto: Float32Array, private readonly channels: number,
    private readonly protoWidth: number, private readonly protoHeight: number, private readonly size: number) {
    this.protoPixels = protoWidth * protoHeight;
    this.decoded = new Float32Array(this.protoPixels);
    this.decodedGeneration = new Uint32Array(this.protoPixels);
  }

  decode(records: Float32Array, offset: number, box: Rect): Float32Array {
    const mask = new Float32Array(this.size * this.size);
    const x0 = Math.max(0, Math.floor(box.x * this.size));
    const y0 = Math.max(0, Math.floor(box.y * this.size));
    const x1 = Math.min(this.size, Math.ceil((box.x + box.width) * this.size));
    const y1 = Math.min(this.size, Math.ceil((box.y + box.height) * this.size));
    this.generation = (this.generation + 1) >>> 0;
    if (this.generation === 0) { this.decodedGeneration.fill(0); this.generation = 1; }
    let previousPy = -1;
    for (let y = y0; y < y1; y++) {
      const py = Math.min(this.protoHeight - 1, Math.floor(y * this.protoHeight / this.size));
      const row = y * this.size;
      if (py === previousPy) {
        mask.copyWithin(row + x0, row - this.size + x0, row - this.size + x1);
        continue;
      }
      previousPy = py;
      for (let x = x0; x < x1;) {
        const px = Math.min(this.protoWidth - 1, Math.floor(x * this.protoWidth / this.size));
        const planePixel = py * this.protoWidth + px;
        if (this.decodedGeneration[planePixel] !== this.generation) {
          let logit = 0;
          for (let c = 0; c < this.channels; c++) logit += records[offset + 6 + c] * this.proto[c * this.protoPixels + planePixel];
          this.decoded[planePixel] = sigmoid(logit);
          this.decodedGeneration[planePixel] = this.generation;
        }
        const end = Math.min(x1, Math.ceil((px + 1) * this.size / this.protoWidth));
        mask.fill(this.decoded[planePixel], row + x, row + end);
        x = end;
      }
    }
    return mask;
  }
}
