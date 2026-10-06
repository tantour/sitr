// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { expect, it } from 'vitest';
import { normalizeRgb } from '../src/vision/normalization';

it('preserves original Float32 normalization for every RGB byte, offset and alpha value', () => {
  const rgba = new Uint8ClampedArray(256 * 4);
  for (let p = 0; p < 256; p++) rgba.set([p, 255 - p, p * 37 % 256, p * 13 % 256], p * 4);
  const input = new Float32Array(3 * 256 + 17).fill(42), expected = input.slice();
  const mean = [.485, .456, .406], std = [.229, .224, .225];
  for (let p = 0; p < 256; p++) for (let channel = 0; channel < 3; channel++)
    expected[7 + channel * 256 + p] = (rgba[p * 4 + channel] / 255 - mean[channel]) / std[channel];
  normalizeRgb(rgba, input, 7);
  expect(input).toEqual(expected);
});
