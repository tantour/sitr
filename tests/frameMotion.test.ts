import { describe, expect, it } from 'vitest';
import { estimateTranslation } from '../src/media/frameMotion';

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
});
