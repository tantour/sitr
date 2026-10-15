// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
// Browser-only test entry, bundled in memory; never packaged in the extension.
import { BodyPixRegionSegmenter } from '../src/vision/bodyRegions';
import { YoloPersonSegmenter } from '../src/vision/person';
import { SelfieSemanticSegmenter } from '../src/vision/semantic';

const people = new YoloPersonSegmenter(320, 'wasm', 2);
const semantic = new SelfieSemanticSegmenter(false);
const ready = Promise.all([people.initialize(), semantic.initialize()]);
const models = new Map<string, BodyPixRegionSegmenter>();
Object.assign(globalThis, { async groinProbe({ bytes, mode, backend, crop, mirror, points }: {
  bytes: string; mode: 'faster' | 'finer'; backend: 'wasm' | 'webgpu'; crop?: number[]; mirror?: boolean; points: number[][];
}) {
  await ready;
  const key = mode + backend;
  let model = models.get(key);
  if (!model) { model = new BodyPixRegionSegmenter(mode, backend, 2); await model.initialize(); models.set(key, model); }
  const image = await createImageBitmap(new Blob([Uint8Array.from(atob(bytes), c => c.charCodeAt(0))]));
  const side = 320, canvas = new OffscreenCanvas(side, side), ctx = canvas.getContext('2d')!;
  const [sx, sy, sw, sh] = crop ?? [0, 0, image.width, image.height];
  const scale = side / Math.max(sw, sh), w = sw * scale, h = sh * scale, ox = (side - w) / 2, oy = (side - h) / 2;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, side, side);
  if (mirror) { ctx.translate(side, 0); ctx.scale(-1, 1); }
  ctx.drawImage(image, sx, sy, sw, sh, ox, oy, w, h); ctx.resetTransform(); image.close();
  const rgba = new Uint8Array(ctx.getImageData(0, 0, side, side).data.buffer);
  const detections = await people.segment(rgba, .25);
  const categories = semantic.segment(rgba, side);
  const actual = await model.segment(rgba, side, categories, detections);
  const timing = model.getLastTimings();
  // Diagnostic only: probe the existing dense predictions on fully clothed
  // pixels, without changing the photograph or asserting skin is exposed.
  const anatomy = await model.segment(rgba, side, new Uint8Array(side * side).fill(2), detections);
  const sample = points.map(([x, y]) => {
    let px = Math.round(ox + (x - sx) * scale), py = Math.round(oy + (y - sy) * scale);
    if (mirror) px = side - 1 - px;
    const counts: Record<number, number> = {};
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const label = anatomy[(py + dy) * side + px + dx]; counts[label] = (counts[label] ?? 0) + 1;
    }
    return { x: px, y: py, label: anatomy[py * side + px], counts };
  });
  let clothingPixels = 0, clothingLabelled = 0, actualGroin = 0;
  for (let p = 0; p < actual.length; p++) {
    if (categories[p] === 4) { clothingPixels++; if (actual[p]) clothingLabelled++; }
    if (actual[p] === 9) actualGroin++;
  }
  // Photograph + predicted pelvis/raised upper thighs for visual inspection.
  const diagnostic = new OffscreenCanvas(side, side), output = diagnostic.getContext('2d')!;
  output.drawImage(canvas, 0, 0);
  const pixels = output.getImageData(0, 0, side, side);
  for (let p = 0; p < anatomy.length; p++) if (anatomy[p] === 9 || anatomy[p] === 5) {
    const color = anatomy[p] === 9 ? [255, 125, 100] : [225, 65, 190];
    for (let ch = 0; ch < 3; ch++) pixels.data[p * 4 + ch] = .5 * pixels.data[p * 4 + ch] + .5 * color[ch];
  }
  output.putImageData(pixels, 0, 0);
  const png = new Uint8Array(await (await diagnostic.convertToBlob({ type: 'image/png' })).arrayBuffer());
  return { people: detections.length, backend: model.getBackend(), timing, sample, clothingPixels, clothingLabelled, actualGroin,
    geometry: model.getLastPelvisEstimates(),
    groinPixels: anatomy.filter(v => v === 9).length, png: Array.from(png) };
} });
