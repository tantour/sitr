// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import type { AnalysisResult } from '../state/contracts';
import { decodeImageBlob } from '../media/capture';

/** Bake a mask into the source image, letting CSS handle its layout and repetition. */
export async function renderBackground(blob: Blob, result: AnalysisResult): Promise<Blob> {
  const source = await decodeImageBlob(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = source.width; canvas.height = source.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Background canvas unavailable');
    ctx.drawImage(source.source, 0, 0);
    const side = result.width;
    const scale = Math.min(side / source.width, side / source.height);
    const sw = source.width * scale, sh = source.height * scale;
    const sx = (side - sw) / 2, sy = (side - sh) / 2;
    const paint = (alpha: Uint8Array, effect?: AnalysisResult['effect']) => {
      const mask = document.createElement('canvas'); mask.width = side; mask.height = side;
      const pixels = new Uint8ClampedArray(side * side * 4);
      for (let i = 0; i < alpha.length; i++) pixels[4 * i + 3] = alpha[i];
      mask.getContext('2d')!.putImageData(new ImageData(pixels, side, side), 0, 0);
      const layer = document.createElement('canvas'); layer.width = source.width; layer.height = source.height;
      const layerCtx = layer.getContext('2d')!;
      layerCtx.drawImage(mask, sx, sy, sw, sh, 0, 0, source.width, source.height);
      if (effect && effect.kind !== 'black') {
        const divisor = effect.kind === 'blur' ? 2 : effect.intensity;
        const small = document.createElement('canvas');
        small.width = Math.max(1, Math.ceil(source.width / divisor));
        small.height = Math.max(1, Math.ceil(source.height / divisor));
        const smallCtx = small.getContext('2d')!;
        smallCtx.filter = [effect.kind === 'blur' ? `blur(${Math.max(1, effect.intensity / divisor)}px)` : '',
          effect.grayscale ? 'grayscale(1)' : ''].filter(Boolean).join(' ') || 'none';
        smallCtx.drawImage(source.source, 0, 0, small.width, small.height);
        layerCtx.globalCompositeOperation = 'source-atop';
        layerCtx.imageSmoothingEnabled = effect.kind !== 'checkerboard';
        layerCtx.drawImage(small, 0, 0, source.width, source.height);
      }
      ctx.drawImage(layer, 0, 0);
    };
    const alpha = new Uint8Array(side * side);
    if (result.trackMasks) {
      if (result.staticMask) alpha.set(result.staticMask);
      for (const track of result.trackMasks) for (let i = 0; i < alpha.length; i++) alpha[i] = Math.max(alpha[i], track.alpha[i]);
    } else for (let i = 0; i < alpha.length; i++) alpha[i] = result.rgbaMask[i * 4 + 3];
    paint(alpha, result.effect);
    if (result.faceMask) paint(result.faceMask, result.faceEffect);
    if (result.blackMask) paint(result.blackMask);
    // Debug graphics must be baked into the same source as the mask so CSS
    // cover/contain, cropping and repeated tiles transform them together.
    const color = (label: string) => label === 'female' ? '#ff4dd2' : label === 'male' ? '#39e6ff' : '#ffc247';
    const x = (value: number) => (value * side - sx) / scale;
    const y = (value: number) => (value * side - sy) / scale;
    const uiScale = Math.max(1, Math.min(source.width, source.height) / 320);
    const label = (text: string, left: number, top: number, tint: string) => {
      ctx.font = `${12 * uiScale}px system-ui, sans-serif`;
      const height = 18 * uiScale, width = ctx.measureText(text).width + 8 * uiScale;
      left = Math.max(0, Math.min(source.width - width, left));
      top = Math.max(0, Math.min(source.height - height, top));
      ctx.fillStyle = 'rgba(0,0,0,.78)'; ctx.fillRect(left, top, width, height);
      ctx.fillStyle = tint; ctx.fillText(text, left + 4 * uiScale, top + 13 * uiScale);
    };
    for (const person of result.debugPersonMasks ?? []) {
      const tint = color(person.labelUsable ? person.label : 'unknown');
      const outline = document.createElement('canvas'); outline.width = person.width; outline.height = person.height;
      const data = new Uint8ClampedArray(person.width * person.height * 4);
      const rgb = tint.match(/[\da-f]{2}/gi)!.map(value => Number.parseInt(value, 16));
      for (let py = 0; py < person.height; py++) for (let px = 0; px < person.width; px++) {
        const p = py * person.width + px;
        if (!person.mask[p] || (px > 0 && px + 1 < person.width && py > 0 && py + 1 < person.height &&
          person.mask[p - 1] && person.mask[p + 1] && person.mask[p - person.width] && person.mask[p + person.width])) continue;
        data[p * 4] = rgb[0]; data[p * 4 + 1] = rgb[1]; data[p * 4 + 2] = rgb[2]; data[p * 4 + 3] = 255;
      }
      outline.getContext('2d')!.putImageData(new ImageData(data, person.width, person.height), 0, 0);
      ctx.drawImage(outline, sx * person.width / side, sy * person.height / side,
        sw * person.width / side, sh * person.height / side, 0, 0, source.width, source.height);
      label(`${person.id.split(':').at(-1)} ${person.labelUsable ? person.label : 'unclassified'}${person.labelSource === 'automatic' ? ` ${Math.round(person.genderConfidence * 100)}%` : ''}`,
        x(person.box.x), y(person.box.y) - 19 * uiScale, tint);
    }
    for (const face of result.debugFaces ?? []) {
      const person = result.debugPersonMasks?.find(person => person.id === face.trackId);
      const tint = person ? color(person.labelUsable ? person.label : 'unknown') : '#ff5a5a';
      ctx.save(); ctx.strokeStyle = tint; ctx.lineWidth = 2 * uiScale;
      ctx.setLineDash(face.ambiguous ? [5 * uiScale, 3 * uiScale] : []);
      ctx.strokeRect(x(face.box.x), y(face.box.y), face.box.width * side / scale, face.box.height * side / scale);
      ctx.restore();
      const text = result.genderDiagnostics?.model.startsWith('body-')
        ? `face ${Math.round(face.score * 100)}% · gender from body`
        : `face ${Math.round(face.score * 100)}% → ${person?.labelUsable ? person.label : 'unclassified'}`;
      label(text, x(face.box.x), y(face.box.y + face.box.height) + 2 * uiScale, tint);
    }
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Background encoding failed')), 'image/png'));
  } finally { source.close(); }
}
