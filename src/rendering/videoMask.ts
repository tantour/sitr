// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { dilate } from './compositor';
import type { Rect } from '../state/contracts';

/** Expand a YOLO silhouette, then soften its outermost edge without opening gaps. */
export function videoPersonMask(mask: Float32Array, side: number, expansion = 4): Uint8Array {
  if (mask.length !== side * side) throw new Error('Video person mask shape mismatch');
  const binary = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) if (mask[i] >= 0.5) binary[i] = 255;
  const expanded = dilate(binary, side, side, expansion);
  const horizontal = new Uint16Array(mask.length);
  const soft = new Uint8Array(mask.length);
  for (let y = 0; y < side; y++) {
    const row = y * side, last = row + side - 1;
    horizontal[row] = 3 * expanded[row] + expanded[Math.min(row + 1, last)];
    for (let index = row + 1; index < last; index++)
      horizontal[index] = expanded[index - 1] + 2 * expanded[index] + expanded[index + 1];
    horizontal[last] = expanded[Math.max(row, last - 1)] + 3 * expanded[last];
  }
  for (let y = 0; y < side; y++) {
    const row = y * side, above = Math.max(0, y - 1) * side, below = Math.min(side - 1, y + 1) * side;
    for (let x = 0; x < side; x++) {
      const index = row + x;
      // The sum is a nonnegative integer <= 4080; this is exactly round(sum/16).
      if (expanded[index]) soft[index] = (horizontal[above + x] + 2 * horizontal[index] + horizontal[below + x] + 8) >> 4;
    }
  }
  return soft;
}

/** Reveal only a face whose detector box has a unique owner. */
export function openAssociatedFaces(mask: Uint8Array, side: number, faces: Rect[]): void {
  const opening = faceEllipseMask(side, faces);
  for (let i = 0; i < mask.length; i++) if (opening[i])
    mask[i] = Math.round(mask[i] * (1 - opening[i] / 255));
}

/** The same feathered shape used to open a body mask can carry a face effect. */
export function faceEllipseMask(side: number, faces: Rect[]): Uint8Array {
  const mask = new Uint8Array(side * side);
  for (const face of faces) {
    if (face.width <= 0 || face.height <= 0) continue;
    const cx = (face.x + face.width / 2) * side;
    const cy = (face.y + face.height / 2) * side;
    const rx = face.width * side * 0.62;
    const ry = face.height * side * 0.62;
    if (rx <= 0 || ry <= 0) continue;
    const x0 = Math.max(0, Math.floor(cx - rx)), x1 = Math.min(side, Math.ceil(cx + rx));
    const y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(side, Math.ceil(cy + ry));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const distance = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
      if (distance >= 1) continue;
      const edge = Math.max(0, Math.min(1, (distance - 0.82) / 0.18));
      mask[y * side + x] = Math.max(mask[y * side + x], Math.round(255 * (1 - edge)));
    }
  }
  return mask;
}
