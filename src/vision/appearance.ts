// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import type { Rect } from '../state/contracts';

/** A tiny torso color histogram used only to disambiguate crossing tracks. */
export function personAppearance(rgba: Uint8Array, side: number, box: Rect): Float32Array {
  const bins = new Float32Array(12);
  let samples = 0;
  for (let row = 0; row < 12; row++) for (let column = 0; column < 8; column++) {
    const x = Math.floor((box.x + box.width * (0.2 + (column + 0.5) * 0.6 / 8)) * side);
    const y = Math.floor((box.y + box.height * (0.22 + (row + 0.5) * 0.48 / 12)) * side);
    if (x < 0 || x >= side || y < 0 || y >= side) continue;
    const offset = (y * side + x) * 4;
    for (let channel = 0; channel < 3; channel++) bins[channel * 4 + Math.min(3, rgba[offset + channel] >> 6)]++;
    samples++;
  }
  if (samples) for (let i = 0; i < bins.length; i++) bins[i] /= samples;
  return bins;
}

export function appearanceSimilarity(a?: Float32Array, b?: Float32Array): number {
  if (!a || !b || a.length !== b.length) return 0.5;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference += Math.abs(a[i] - b[i]);
  return Math.max(0, 1 - difference / 6);
}
