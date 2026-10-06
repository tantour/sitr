// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { describe, expect, it } from 'vitest';
import { dilate } from '../src/rendering/compositor';

describe('motion margin dilation', () => {
  it('expands binary masks to a clipped square at edges and through the center', () => {
    const width = 9, height = 7;
    const source = new Uint8Array(width * height);
    source[0] = 255;
    source[3 * width + 4] = 255;
    const result = dilate(source, width, height, 2);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const expected = (x <= 2 && y <= 2) || (Math.abs(x - 4) <= 2 && Math.abs(y - 3) <= 2);
      expect(result[y * width + x]).toBe(expected ? 255 : 0);
    }
  });
  it('matches a direct neighborhood search on narrow grids and all supported radii', () => {
    for (const [width, height] of [[1, 9], [13, 1], [7, 11], [31, 17]]) {
      const source = Uint8Array.from({ length: width * height }, (_, i) => i % 19 === 0 ? 37 : 0);
      for (const radius of [0, 1, 2, 4, 8, 24]) {
        const expected = new Uint8Array(source.length);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          if (!radius) { expected[y * width + x] = source[y * width + x]; continue; }
          for (let ny = Math.max(0, y - radius); ny <= Math.min(height - 1, y + radius); ny++)
            for (let nx = Math.max(0, x - radius); nx <= Math.min(width - 1, x + radius); nx++)
              if (source[ny * width + nx]) expected[y * width + x] = 255;
        }
        expect(dilate(source, width, height, radius)).toEqual(expected);
      }
    }
  });
});
