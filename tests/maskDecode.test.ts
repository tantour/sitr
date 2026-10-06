// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { describe, expect, it } from 'vitest';
import { YoloMaskDecoder } from '../src/vision/maskDecode';
import type { Rect } from '../src/state/contracts';

function reference(records: Float32Array, offset: number, proto: Float32Array,
  channels: number, protoWidth: number, protoHeight: number, size: number, box: Rect): Float32Array {
  const mask = new Float32Array(size * size);
  const x0 = Math.max(0, Math.floor(box.x * size));
  const y0 = Math.max(0, Math.floor(box.y * size));
  const x1 = Math.min(size, Math.ceil((box.x + box.width) * size));
  const y1 = Math.min(size, Math.ceil((box.y + box.height) * size));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const px = Math.min(protoWidth - 1, Math.floor(x * protoWidth / size));
    const py = Math.min(protoHeight - 1, Math.floor(y * protoHeight / size));
    const planePixel = py * protoWidth + px;
    let logit = 0;
    for (let c = 0; c < channels; c++) logit += records[offset + 6 + c] * proto[c * protoWidth * protoHeight + planePixel];
    mask[y * size + x] = 1 / (1 + Math.exp(-logit));
  }
  return mask;
}

describe('YOLO mask decoding', () => {
  it.each([[256, 64, 64], [320, 80, 80], [416, 104, 104], [31, 9, 7], [9, 13, 11]])(
    'preserves every pixel at size %i with %i by %i prototypes', (size, protoWidth, protoHeight) => {
      const channels = 3;
      const proto = Float32Array.from({ length: channels * protoWidth * protoHeight }, (_, i) => Math.sin(i * .7));
      const records = Float32Array.from({ length: 6 + channels }, (_, i) => Math.cos(i));
      const decoder = new YoloMaskDecoder(proto, channels, protoWidth, protoHeight, size);
      for (const box of [
        { x: 0, y: 0, width: 1, height: 1 },
        { x: -.1, y: .153, width: .724, height: 1 },
        { x: .517, y: .213, width: .002, height: .003 },
        { x: .9, y: .8, width: .3, height: .4 },
      ]) {
        const actual = decoder.decode(records, 0, box);
        const expected = reference(records, 0, proto, channels, protoWidth, protoHeight, size, box);
        expect(actual.length).toBe(expected.length);
        expect(actual.every((pixel, index) => Object.is(pixel, expected[index]))).toBe(true);
      }
    });
  it('matches the original per-pixel calculation across boxes and detections', () => {
    const size = 32, protoWidth = 8, protoHeight = 8, channels = 5;
    const proto = Float32Array.from({ length: channels * protoWidth * protoHeight }, (_, i) => Math.sin(i * 1.7));
    const records = Float32Array.from({ length: 2 * (6 + channels) }, (_, i) => Math.cos(i * .39));
    const decoder = new YoloMaskDecoder(proto, channels, protoWidth, protoHeight, size);
    const boxes: Rect[] = [
      { x: 0.08, y: 0.14, width: .7, height: .63 },
      { x: -.15, y: .45, width: .62, height: .7 },
    ];
    for (const [index, box] of boxes.entries()) {
      const offset = index * (6 + channels);
      expect(decoder.decode(records, offset, box)).toEqual(reference(records, offset, proto, channels, protoWidth, protoHeight, size, box));
    }
  });
});
