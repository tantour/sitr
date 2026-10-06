// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
// Evaluate the original expression once per byte value. Writing into Float32
// here rounds exactly as writing each normalized pixel into the model input.
const mean = [0.485, 0.456, 0.406];
const std = [0.229, 0.224, 0.225];
const tables = mean.map((value, channel) => Float32Array.from({ length: 256 },
  (_, byte) => (byte / 255 - value) / std[channel]));

export function normalizeRgb(rgba: Uint8Array | Uint8ClampedArray, input: Float32Array, offset = 0): void {
  const pixels = rgba.length / 4;
  const [red, green, blue] = tables;
  for (let p = 0; p < pixels; p++) {
    input[offset + p] = red[rgba[p * 4]];
    input[offset + pixels + p] = green[rgba[p * 4 + 1]];
    input[offset + 2 * pixels + p] = blue[rgba[p * 4 + 2]];
  }
}
