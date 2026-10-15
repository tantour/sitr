// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
export const MODEL_SIZES = [256, 320, 416] as const;
export const BODY_REGION_MODES = ['faster', 'finer'] as const;
export const BODY_GENDER_MODELS = ['intel', 'paddle'] as const;

/** Opaque neutral pixels: no photographs, detections or user data enter warmup. */
export function warmupPixels(side: number): Uint8Array {
  const pixels = new Uint8Array(side * side * 4);
  for (let p = 0; p < pixels.length; p += 4) {
    pixels[p] = pixels[p + 1] = pixels[p + 2] = 127;
    pixels[p + 3] = 255;
  }
  return pixels;
}

/** Serial runs avoid competing GPU compilation. The second run captures GPU graphs. */
export async function warmModels(tasks: Array<{ name: string; run: () => Promise<unknown> }>,
  progress?: (value: { completed: number; total: number }) => void): Promise<{
  models: string[]; failures: Record<string, string>; elapsedMs: number;
}> {
  const started = performance.now();
  const models: string[] = [], failures: Record<string, string> = {};
  progress?.({ completed: 0, total: tasks.length });
  for (const task of tasks) {
    try { await task.run(); await task.run(); models.push(task.name); }
    catch (error) { failures[task.name] = String(error).slice(0, 300); }
    progress?.({ completed: models.length + Object.keys(failures).length, total: tasks.length });
  }
  return { models, failures, elapsedMs: performance.now() - started };
}
