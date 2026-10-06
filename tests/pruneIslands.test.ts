// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { describe, expect, it } from 'vitest';
import { pruneIslands } from '../src/rendering/compositor';

// Independent pixel flood-fill oracle; diagonal pixels are connected.
function reference(source: Uint8Array, width: number, height: number, minimum: number): Uint8Array {
  const out = source.slice(), seen = new Set<number>();
  for (let p = 0; p < source.length; p++) {
    if (!source[p] || seen.has(p)) continue;
    const component = [p];
    seen.add(p);
    for (let head = 0; head < component.length; head++) {
      const current = component[head], x = current % width, y = Math.floor(current / width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || !source[next] || seen.has(next)) continue;
        seen.add(next); component.push(next);
      }
    }
    if (component.length < minimum) for (const pixel of component) out[pixel] = 0;
  }
  return out;
}

describe('island cleanup equivalence', () => {
  it('preserves diagonal links, edges, holes, alpha values and the exact area cutoff', () => {
    let seed = 1729;
    const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);
    for (const [width, height] of [[1, 1], [1, 23], [31, 1], [17, 29], [64, 64]]) {
      for (const density of [0, .03, .2, .5, .9, 1]) {
        const source = Uint8Array.from({ length: width * height }, () => random() < density ? 1 + Math.floor(random() * 255) : 0);
        for (const minimum of [1, 4, 12, width * height + 1]) {
          const original = source.slice();
          expect(pruneIslands(source, width, height, minimum)).toEqual(reference(source, width, height, minimum));
          expect(source).toEqual(original);
        }
      }
    }
  });
});
