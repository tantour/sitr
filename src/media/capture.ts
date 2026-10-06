// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
const captureContexts = new Map<number, CanvasRenderingContext2D>();

export function captureSquare(source: CanvasImageSource, width: number, height: number, size: number): Uint8Array {
  let ctx = captureContexts.get(size);
  if (!ctx) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    ctx = canvas.getContext('2d', { willReadFrequently: true }) ?? undefined;
    if (!ctx) throw new Error('Canvas capture unavailable');
    captureContexts.set(size, ctx);
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  const scale = Math.min(size / width, size / height);
  const w = width * scale, h = height * scale;
  ctx.drawImage(source, (size - w) / 2, (size - h) / 2, w, h);
  try {
    return new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer);
  } catch (error) {
    // Painting over a tainted canvas does not restore origin cleanliness.
    // Reset it so one cross-origin image cannot poison later captures.
    ctx.canvas.width = size;
    throw error;
  }
}

export async function sourceIsStatic(blob: Blob): Promise<boolean> {
  const type = blob.type.split(';')[0].trim().toLowerCase();
  if (type === 'image/jpeg') return true;
  if (type === 'image/gif') return false;
  if (type === 'image/svg+xml') return svgIsStatic(await blob.text());
  if (type === 'image/png') {
    const bytes = new Uint8Array(await blob.slice(0, Math.min(blob.size, 1_000_000)).arrayBuffer());
    for (let p = 8; p + 8 < bytes.length;) {
      const length = ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
      const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
      if (type === 'acTL') return false;
      if (type === 'IDAT') return true;
      p += 12 + length;
    }
    return false;
  }
  if ('ImageDecoder' in window) {
    const Decoder = (window as unknown as { ImageDecoder: new (options: { data: ArrayBuffer; type: string }) => { tracks: { ready: Promise<void>; selectedTrack?: { frameCount: number } }; close(): void } }).ImageDecoder;
    const decoder = new Decoder({ data: await blob.arrayBuffer(), type: blob.type });
    try { await decoder.tracks.ready; return decoder.tracks.selectedTrack?.frameCount === 1; }
    finally { decoder.close(); }
  }
  return false;
}

function svgIsStatic(text: string): boolean {
  const xml = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (xml.querySelector('parsererror') || xml.documentElement.localName !== 'svg' ||
      xml.documentElement.namespaceURI !== 'http://www.w3.org/2000/svg') return false;
  // A still mask cannot follow SVG's SMIL or CSS animations. External style
  // sheets and scripts also prevent us from verifying a fixed image.
  if (/<\?xml-stylesheet\b/i.test(text)) return false;
  const dynamic = new Set(['animate', 'animatemotion', 'animatetransform', 'set', 'discard', 'script']);
  const staticRules = (rules: CSSRuleList): boolean => Array.from(rules).every(rule => {
    if (rule.type === CSSRule.KEYFRAMES_RULE || rule.type === CSSRule.IMPORT_RULE) return false;
    if ('style' in rule) {
      const style = (rule as CSSStyleRule).style;
      if (style.animationName && style.animationName !== 'none' || style.transitionProperty && style.transitionProperty !== 'none') return false;
    }
    return !('cssRules' in rule) || staticRules((rule as CSSGroupingRule).cssRules);
  });
  for (const element of Array.from(xml.getElementsByTagName('*'))) {
    if (dynamic.has(element.localName.toLowerCase())) return false;
    const style = element.localName === 'style' ? element.textContent ?? '' : '';
    const inline = element.getAttribute('style');
    if (!style && !inline) continue;
    // replaceSync discards @import, so reject it before parsing (including CSS escapes).
    const decodedStyle = style.replace(/\\([\da-f]{1,6})\s?|\\([^\r\n])/gi,
      (_match, hex: string, character: string) => hex ? String.fromCodePoint(Math.min(Number.parseInt(hex, 16) || 0xfffd, 0x10ffff)) : character);
    if (/@import\b/i.test(decodedStyle)) return false;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`${style}\nsvg { ${inline ?? ''} }`);
    if (!staticRules(sheet.cssRules)) return false;
  }
  return true;
}

export interface DecodedImage { source: CanvasImageSource; width: number; height: number; close(): void }

/** Chrome's bitmap decoder does not support SVG blobs. Decode those using the
 * browser's image renderer, which also handles SVGs with only a viewBox. */
export async function decodeImageBlob(blob: Blob): Promise<DecodedImage> {
  if (blob.type.split(';')[0].trim().toLowerCase() !== 'image/svg+xml') {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('SVG image has no drawable size');
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}
