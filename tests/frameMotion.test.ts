// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { describe, expect, it, vi } from 'vitest';
import { estimateTranslation, FrameMotionEngine } from '../src/media/frameMotion';

describe('display-frame motion', () => {
  it('follows a textured person region by a few pixels between samples', () => {
    const side = 96;
    const old = new Uint8Array(side * side).fill(25);
    const next = new Uint8Array(side * side).fill(25);
    for (let y = 20; y < 70; y++) for (let x = 20; x < 70; x++) {
      const value = (x * 37 + y * 61 + x * y * 7) % 220 + 20;
      old[y * side + x] = value;
      next[(y + 2) * side + x + 3] = value;
    }
    const motion = estimateTranslation(old, next, side, { x: 20 / side, y: 20 / side, width: 50 / side, height: 50 / side });
    expect(motion).toEqual({ dx: 3, dy: 2, reliable: true });
  });
  it('recovers a slow pan after subpixel shifts accumulate', () => {
    const side = 96;
    const source = new Uint8Array(side * side).fill(25);
    for (let y = 14; y < 82; y++) for (let x = 14; x < 82; x++)
      source[y * side + x] = (x * 37 + y * 61 + x * y * 7) % 220 + 20;
    const shifted = (amount: number): Uint8Array => {
      const frame = new Uint8Array(side * side);
      for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
        const from = x - amount;
        const left = Math.floor(from), fraction = from - left;
        const a = left >= 0 && left < side ? source[y * side + left] : 25;
        const b = left + 1 >= 0 && left + 1 < side ? source[y * side + left + 1] : 25;
        frame[y * side + x] = Math.round(a * (1 - fraction) + b * fraction);
      }
      return frame;
    };
    const box = { x: 14 / side, y: 14 / side, width: 68 / side, height: 68 / side };
    expect(estimateTranslation(shifted(0), shifted(0.2), side, box).dx).toBe(0);
    expect(estimateTranslation(shifted(0), shifted(1.2), side, box)).toEqual({ dx: 1, dy: 0, reliable: true });
  });
  it('keeps an anchored mask moving through a long subpixel pan', () => {
    const side = 96;
    const source = new Uint8Array(side * side).fill(25);
    for (let y = 14; y < 82; y++) for (let x = 14; x < 82; x++)
      source[y * side + x] = (x * 37 + y * 61 + x * y * 7) % 220 + 20;
    const canvas = class {
      private frame?: { gray: Uint8Array };
      getContext() {
        return {
          fillRect: () => {},
          drawImage: (frame: { gray: Uint8Array }) => { this.frame = frame; },
          getImageData: () => {
            const data = new Uint8ClampedArray(side * side * 4);
            for (let i = 0; i < side * side; i++) data[4 * i] = data[4 * i + 1] = data[4 * i + 2] = this.frame!.gray[i];
            return { data };
          },
        };
      }
    };
    vi.stubGlobal('OffscreenCanvas', canvas);
    try {
      const engine = new FrameMotionEngine();
      const frame = (amount: number) => {
        const gray = new Uint8Array(side * side);
        for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
          const from = x - amount, left = Math.floor(from), fraction = from - left;
          const a = left >= 0 && left < side ? source[y * side + left] : 25;
          const b = left + 1 >= 0 && left + 1 < side ? source[y * side + left + 1] : 25;
          gray[y * side + x] = Math.round(a * (1 - fraction) + b * fraction);
        }
        return { width: side, height: side, gray, close: () => {} } as unknown as ImageBitmap;
      };
      engine.observe(frame(0), 1000);
      engine.align({ capturedAtMs: 1000, sequence: 1,
        tracks: [{ id: 'person', box: { x: 14 / side, y: 14 / side, width: 68 / side, height: 68 / side } }], maskIds: ['person'] });
      for (let i = 1; i <= 40; i++) engine.observe(frame(i * 0.2), 1000 + i * 33);
      expect(engine.reliable(['person'])).toBe(true);
      expect(engine.offsets().get('person')!.x * side).toBeGreaterThanOrEqual(6);
    } finally { vi.unstubAllGlobals(); }
  });
});
