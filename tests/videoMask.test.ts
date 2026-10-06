// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { describe, expect, it } from 'vitest';
import { openAssociatedFaces, videoPersonMask } from '../src/rendering/videoMask';
import { dilate } from '../src/rendering/compositor';

describe('video silhouette', () => {
  it('preserves every alpha byte of the original blur, including single-pixel grids and boundaries', () => {
    for (const side of [1, 2, 9, 32]) for (const expansion of [0, 1, 4, 24]) {
      const mask = Float32Array.from({ length: side * side }, (_, p) => (Math.sin(p * .73) + 1) / 2);
      const binary = Uint8Array.from(mask, value => value >= .5 ? 255 : 0);
      const expanded = dilate(binary, side, side, expansion), expected = new Uint8Array(mask.length);
      for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
        if (!expanded[y * side + x]) continue;
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
          sum += expanded[Math.max(0, Math.min(side - 1, y + dy)) * side + Math.max(0, Math.min(side - 1, x + dx))] *
            (dy === 0 ? 2 : 1) * (dx === 0 ? 2 : 1);
        expected[y * side + x] = Math.round(sum / 16);
      }
      expect(videoPersonMask(mask, side, expansion)).toEqual(expected);
    }
  });
  it('covers the entire person, including the face, with a feathered expanded edge', () => {
    const side = 64;
    const person = new Float32Array(side * side);
    for (let y = 8; y < 56; y++) for (let x = 16; x < 48; x++) person[y * side + x] = 0.9;
    const mask = videoPersonMask(person, side);
    expect(mask[42 * side + 32]).toBe(255);
    expect(mask[20 * side + 32]).toBe(255);
    expect(mask[42 * side + 12]).toBeGreaterThan(0);
    expect(mask[42 * side + 12]).toBeLessThan(255);
    expect(mask[42 * side + 11]).toBe(0);
    expect(mask[42 * side + 5]).toBe(0);
  });
  it('retains small detached silhouette parts so motion coverage is not reduced', () => {
    const person = new Float32Array(32 * 32).fill(1);
    expect(videoPersonMask(person, 32)[16 * 32 + 16]).toBe(255);
    const tiny = new Float32Array(32 * 32);
    tiny[16 * 32 + 16] = 1;
    expect(videoPersonMask(tiny, 32)[16 * 32 + 16]).toBe(255);
  });
  it('uses the requested expansion while keeping zero expansion inside the original mask', () => {
    const side = 32;
    const person = new Float32Array(side * side);
    for (let y = 8; y < 24; y++) for (let x = 8; x < 24; x++) person[y * side + x] = 1;
    const none = videoPersonMask(person, side, 0);
    const wide = videoPersonMask(person, side, 8);
    expect(none[16 * side + 7]).toBe(0);
    expect(wide[16 * side + 7]).toBeGreaterThan(0);
    expect(wide[16 * side + 0]).toBeGreaterThan(0);
    expect(wide[16 * side + 25]).toBeGreaterThan(none[16 * side + 25]);
  });
  it('opens only a reliably associated face in a whole-person image mask', () => {
    const side = 64;
    const person = new Float32Array(side * side).fill(1);
    const covered = videoPersonMask(person, side, 0);
    const opened = covered.slice();
    openAssociatedFaces(opened, side, [{ x: 24 / side, y: 8 / side, width: 16 / side, height: 16 / side }]);
    expect(opened[16 * side + 32]).toBe(0);
    expect(opened[16 * side + 42]).toBeGreaterThan(0);
    expect(opened[48 * side + 32]).toBe(255);
    expect(covered[16 * side + 32]).toBe(255);
  });
});
