import type { AnalysisResult } from '../state/contracts';

export class Overlay {
  readonly canvas = document.createElement('canvas');
  private maskCanvas = document.createElement('canvas');
  private staticCanvas?: HTMLCanvasElement;
  private trackCanvases = new Map<string, HTMLCanvasElement>();
  private debugCanvases = new Map<string, HTMLCanvasElement>();
  private motion = new Map<string, { x: number; y: number }>();
  private bitmap?: CanvasRenderingContext2D;
  private frame?: AnalysisResult;
  private raf = 0;
  private parent: HTMLElement;
  private readonly anchorName: string;
  private readonly originalAnchorName: string;
  private readonly originalAnchorPriority: string;
  constructor(private readonly media: HTMLImageElement | HTMLVideoElement) {
    this.parent = media.parentElement || document.body || document.documentElement;
    this.anchorName = `--local-media-censor-${crypto.randomUUID().replaceAll('-', '')}`;
    this.originalAnchorName = media.style.getPropertyValue('anchor-name');
    this.originalAnchorPriority = media.style.getPropertyPriority('anchor-name');
    const inheritedNames = getComputedStyle(media).getPropertyValue('anchor-name').trim();
    media.style.setProperty('anchor-name', `${inheritedNames && inheritedNames !== 'none' ? `${inheritedNames}, ` : ''}${this.anchorName}`);
    Object.assign(this.canvas.style, {
      position: 'absolute', positionAnchor: this.anchorName, left: 'anchor(left)', top: 'anchor(top)',
      width: 'anchor-size(width)', height: 'anchor-size(height)',
      zIndex: '2147483647', pointerEvents: 'none',
      background: 'transparent', margin: '0', padding: '0', border: '0',
    });
    this.canvas.dataset.localMediaCensorOverlay = 'true';
    if (media.id) this.canvas.dataset.localMediaCensorFor = media.id;
    this.parent.appendChild(this.canvas);
    this.bitmap = this.maskCanvas.getContext('2d') || undefined;
    this.draw();
  }
  setPointerInput(on: boolean): void { this.canvas.style.pointerEvents = on ? 'auto' : 'none'; }
  analysisPosition(clientX: number, clientY: number): { x: number; y: number } | undefined {
    if (!this.frame) return;
    const rect = this.media.getBoundingClientRect();
    const intrinsicW = this.media instanceof HTMLVideoElement ? this.media.videoWidth : this.media.naturalWidth;
    const intrinsicH = this.media instanceof HTMLVideoElement ? this.media.videoHeight : this.media.naturalHeight;
    if (!rect.width || !rect.height || !intrinsicW || !intrinsicH) return;
    const style = getComputedStyle(this.media);
    const fit = style.objectFit || 'fill';
    let renderedW = rect.width, renderedH = rect.height;
    if (fit === 'contain' || fit === 'cover' || fit === 'scale-down' || fit === 'none') {
      const factor = fit === 'cover' ? Math.max(rect.width / intrinsicW, rect.height / intrinsicH)
        : fit === 'none' ? 1 : Math.min(rect.width / intrinsicW, rect.height / intrinsicH);
      renderedW = intrinsicW * factor; renderedH = intrinsicH * factor;
    }
    const position = style.objectPosition.split(' ');
    const px = position[0]?.endsWith('%') ? Number.parseFloat(position[0]) / 100 : 0.5;
    const py = position[1]?.endsWith('%') ? Number.parseFloat(position[1]) / 100 : 0.5;
    const u = (clientX - rect.left - (rect.width - renderedW) * px) / renderedW;
    const v = (clientY - rect.top - (rect.height - renderedH) * py) / renderedH;
    if (u < 0 || u > 1 || v < 0 || v > 1) return;
    const side = this.frame.width;
    const scale = Math.min(side / intrinsicW, side / intrinsicH);
    const sourceW = intrinsicW * scale, sourceH = intrinsicH * scale;
    return { x: ((side - sourceW) / 2 + u * sourceW) / side, y: ((side - sourceH) / 2 + v * sourceH) / side };
  }
  getFrame(): AnalysisResult | undefined { return this.frame; }
  clear(): void {
    this.frame = undefined;
    this.staticCanvas = undefined;
    this.trackCanvases.clear();
    this.debugCanvases.clear();
    this.motion.clear();
    this.canvas.getContext('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
  syncParent(): void {
    const parent = this.media.parentElement || document.body || document.documentElement;
    if (parent !== this.parent) { this.parent = parent; parent.appendChild(this.canvas); }
  }
  set(result: AnalysisResult): void {
    this.frame = result;
    this.maskCanvas.width = result.width;
    this.maskCanvas.height = result.height;
    const ctx = this.bitmap ?? this.maskCanvas.getContext('2d');
    if (!ctx) throw new Error('Overlay canvas unavailable');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(result.rgbaMask), result.width, result.height), 0, 0);
    this.staticCanvas = result.staticMask ? this.layerCanvas(result.staticMask, result.width, result.height) : undefined;
    this.trackCanvases.clear();
    for (const mask of result.trackMasks || []) this.trackCanvases.set(mask.id, this.layerCanvas(mask.alpha, result.width, result.height));
    this.debugCanvases.clear();
    for (const item of result.debugPersonMasks || []) this.debugCanvases.set(item.id, this.outlineCanvas(item.mask, item.width, item.height, this.trackColor(item.labelUsable ? item.label : 'unknown')));
    this.draw();
  }
  private trackColor(label: string): string {
    return label === 'female' ? '#ff4dd2' : label === 'male' ? '#39e6ff' : '#ffc247';
  }
  private outlineCanvas(mask: Uint8Array, width: number, height: number, color: string): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const rgba = new Uint8ClampedArray(mask.length * 4);
    const match = color.match(/[\da-f]{2}/gi)?.map(value => Number.parseInt(value, 16)) ?? [255, 194, 71];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (!mask[index]) continue;
      if ((x > 0 && mask[index - 1]) && (x + 1 < width && mask[index + 1]) &&
          (y > 0 && mask[index - width]) && (y + 1 < height && mask[index + width])) continue;
      rgba[index * 4] = match[0]; rgba[index * 4 + 1] = match[1]; rgba[index * 4 + 2] = match[2]; rgba[index * 4 + 3] = 255;
    }
    canvas.getContext('2d')?.putImageData(new ImageData(rgba, width, height), 0, 0);
    return canvas;
  }
  private layerCanvas(alpha: Uint8Array, width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const pixels = new Uint8ClampedArray(alpha.length * 4);
    for (let i = 0; i < alpha.length; i++) pixels[4 * i + 3] = alpha[i];
    canvas.getContext('2d')?.putImageData(new ImageData(pixels, width, height), 0, 0);
    return canvas;
  }
  setMotion(offsets: Map<string, { x: number; y: number }>): void { this.motion = offsets; this.draw(); }
  draw(): void {
    this.syncParent();
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (!this.media.isConnected) return;
      const rect = this.media.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) { this.canvas.style.display = 'none'; return; }
      this.canvas.style.display = 'block';
      const scale = Math.min(devicePixelRatio || 1, 2);
      const cw = Math.ceil(rect.width * scale), ch = Math.ceil(rect.height * scale);
      if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
      const ctx = this.canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, cw, ch);
      if (!this.frame || this.frame.black) return;
      const intrinsicW = this.media instanceof HTMLVideoElement ? this.media.videoWidth : this.media.naturalWidth;
      const intrinsicH = this.media instanceof HTMLVideoElement ? this.media.videoHeight : this.media.naturalHeight;
      if (!intrinsicW || !intrinsicH) return;
      const style = getComputedStyle(this.media);
      const fit = style.objectFit || 'fill';
      let renderedW = cw, renderedH = ch;
      if (fit === 'contain' || fit === 'cover' || fit === 'scale-down' || fit === 'none') {
        const factor = fit === 'cover' ? Math.max(cw / intrinsicW, ch / intrinsicH)
          : fit === 'none' ? scale : Math.min(cw / intrinsicW, ch / intrinsicH);
        renderedW = intrinsicW * factor; renderedH = intrinsicH * factor;
      }
      const position = style.objectPosition.split(' ');
      const posX = position[0]?.endsWith('%') ? Number.parseFloat(position[0]) / 100 : 0.5;
      const posY = position[1]?.endsWith('%') ? Number.parseFloat(position[1]) / 100 : 0.5;
      const dx = (cw - renderedW) * (Number.isFinite(posX) ? posX : 0.5);
      const dy = (ch - renderedH) * (Number.isFinite(posY) ? posY : 0.5);
      const s = this.frame.width;
      const letterboxScale = Math.min(s / intrinsicW, s / intrinsicH);
      const sourceW = intrinsicW * letterboxScale, sourceH = intrinsicH * letterboxScale;
      const sx = (s - sourceW) / 2, sy = (s - sourceH) / 2;
      if (this.frame.trackMasks) {
        if (this.staticCanvas) ctx.drawImage(this.staticCanvas, sx, sy, sourceW, sourceH, dx, dy, renderedW, renderedH);
        for (const mask of this.frame.trackMasks) {
          const layer = this.trackCanvases.get(mask.id);
          if (!layer) continue;
          const shift = this.motion.get(mask.id);
          const mx = (shift?.x ?? 0) * s * renderedW / sourceW;
          const my = (shift?.y ?? 0) * s * renderedH / sourceH;
          ctx.drawImage(layer, sx, sy, sourceW, sourceH, dx + mx, dy + my, renderedW, renderedH);
        }
      } else ctx.drawImage(this.maskCanvas, sx, sy, sourceW, sourceH, dx, dy, renderedW, renderedH);
      if (this.frame.debugPersonMasks?.length) {
        const debugScale = this.frame.debugPersonMasks[0].width / s;
        for (const person of this.frame.debugPersonMasks) {
          const layer = this.debugCanvases.get(person.id);
          if (layer) {
            const shift = this.motion.get(person.id);
            const mx = (shift?.x ?? 0) * s * renderedW / sourceW;
            const my = (shift?.y ?? 0) * s * renderedH / sourceH;
            ctx.drawImage(layer, sx * debugScale, sy * debugScale, sourceW * debugScale, sourceH * debugScale,
              dx + mx, dy + my, renderedW, renderedH);
            const color = this.trackColor(person.labelUsable ? person.label : 'unknown');
            const text = `${person.id.split(':').at(-1)} ${person.labelUsable ? person.label : 'unclassified'}${person.labelSource === 'automatic' ? ` ${Math.round(person.genderConfidence * 100)}%` : ''}`;
            const x = dx + (person.box.x * s - sx) * renderedW / sourceW + mx;
            const y = dy + (person.box.y * s - sy) * renderedH / sourceH + my;
            ctx.font = `${Math.max(11, 12 * scale)}px system-ui, sans-serif`;
            const width = ctx.measureText(text).width + 8;
            ctx.fillStyle = 'rgba(0,0,0,.78)'; ctx.fillRect(x, Math.max(dy, y - 19 * scale), width, 18 * scale);
            ctx.fillStyle = color; ctx.fillText(text, x + 4, Math.max(dy + 13 * scale, y - 5 * scale));
          }
        }
        for (const face of this.frame.debugFaces || []) {
          const track = this.frame.debugPersonMasks.find(person => person.id === face.trackId);
          const color = track ? this.trackColor(track.labelUsable ? track.label : 'unknown') : '#ff5a5a';
          const shift = face.trackId ? this.motion.get(face.trackId) : undefined;
          const mx = (shift?.x ?? 0) * s * renderedW / sourceW;
          const my = (shift?.y ?? 0) * s * renderedH / sourceH;
          const x = dx + (face.box.x * s - sx) * renderedW / sourceW + mx;
          const y = dy + (face.box.y * s - sy) * renderedH / sourceH + my;
          const w = face.box.width * s * renderedW / sourceW;
          const h = face.box.height * s * renderedH / sourceH;
          ctx.save();
          ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.5, 2 * scale); ctx.setLineDash(face.ambiguous ? [5 * scale, 3 * scale] : []);
          ctx.strokeRect(x, y, w, h);
          const label = `face ${Math.round(face.score * 100)}% → ${track?.labelUsable ? `${track.label} ${Math.round(track.genderConfidence * 100)}%` : 'unclassified'}`;
          ctx.font = `${Math.max(10, 11 * scale)}px system-ui, sans-serif`;
          const labelWidth = ctx.measureText(label).width + 8;
          const labelY = y + h + 2;
          ctx.fillStyle = 'rgba(0,0,0,.78)'; ctx.fillRect(x, labelY, labelWidth, 16 * scale);
          ctx.fillStyle = color; ctx.fillText(label, x + 4, labelY + 12 * scale);
          ctx.restore();
        }
      }
    });
  }
  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.canvas.remove();
    if (this.originalAnchorName) this.media.style.setProperty('anchor-name', this.originalAnchorName, this.originalAnchorPriority);
    else this.media.style.removeProperty('anchor-name');
    this.maskCanvas.width = this.maskCanvas.height = 0;
    this.staticCanvas = undefined;
    this.trackCanvases.clear();
    this.debugCanvases.clear();
  }
}
