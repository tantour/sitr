// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { expect, it, vi } from 'vitest';
import { captureSquare } from '../src/media/capture';

it('restores a reusable capture canvas after cross-origin taint', () => {
  let tainted = false;
  const canvas = { get width() { return 13; }, set width(_value: number) { tainted = false; }, height: 13 };
  const context = { canvas, fillStyle: '', fillRect() {},
    drawImage(source: unknown) { if (source === 'cross-origin') tainted = true; },
    getImageData() {
      if (tainted) throw new DOMException('Tainted', 'SecurityError');
      return { data: new Uint8ClampedArray(13 * 13 * 4) };
    } };
  vi.stubGlobal('document', { createElement: () => Object.assign(canvas, { getContext: () => context }) });
  try {
    expect(() => captureSquare('cross-origin' as unknown as CanvasImageSource, 20, 20, 13)).toThrow('Tainted');
    expect(captureSquare('clean' as unknown as CanvasImageSource, 20, 20, 13)).toHaveLength(13 * 13 * 4);
  } finally { vi.unstubAllGlobals(); }
});
