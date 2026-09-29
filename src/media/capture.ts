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
  return new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer);
}

export async function sourceIsStatic(blob: Blob): Promise<boolean> {
  if (blob.type === 'image/jpeg') return true;
  if (blob.type === 'image/gif') return false;
  if (blob.type === 'image/png') {
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
