// SPDX-License-Identifier: AGPL-3.0-only
import {applyBlackPixels} from './hairMask';
import {dilate} from './compositor';
import {uniqueId} from '../state/id';
// Copyright (C) 2026 Sitr contributors
import { applyGarmentTone, type GarmentTone } from './videoFabric';
import type { AnalysisResult } from '../state/contracts';
import { applyFabric, applyClothing, softenFabricEdges, shadeFabricRuns } from './fabric';

export class Overlay {
  readonly canvas = document.createElement('canvas');
  private maskCanvas = document.createElement('canvas');
  private checkerCanvas = document.createElement('canvas');
  private blurCanvas = document.createElement('canvas');
  private staticCanvas?: HTMLCanvasElement;
  private faceCanvas?: HTMLCanvasElement;
  private faceCanvases: Array<{ canvas: HTMLCanvasElement; effect: NonNullable<AnalysisResult['faceEffect']> }> = [];
  private smartCanvas?: HTMLCanvasElement;
  private blackCanvas?: HTMLCanvasElement;
  private faceLayerCanvas = document.createElement('canvas');
  private trackCanvases = new Map<string, HTMLCanvasElement>();
  private videoPadding=0;
  private continuityCanvases=new Map<string,{radius:number;canvas:HTMLCanvasElement}>();
  private debugCanvases = new Map<string, HTMLCanvasElement>();
  private bodyRegionCanvas?: HTMLCanvasElement;
  private motion = new Map<string, { x: number; y: number }>();
  private bitmap?: CanvasRenderingContext2D;
  private frame?: AnalysisResult;
  private raf = 0;
  private parent: HTMLElement | ShadowRoot;
  private readonly anchorName: string;
  private readonly originalAnchorName: string;
  private readonly originalAnchorPriority: string;
  constructor(private readonly media: HTMLImageElement | HTMLVideoElement, private readonly frameSource?: HTMLCanvasElement) {
    this.parent = media.parentNode instanceof ShadowRoot ? media.parentNode : media.parentElement || document.body || document.documentElement;
    this.anchorName = `--local-media-censor-${uniqueId().replaceAll('-', '')}`;
    this.originalAnchorName = media.style.getPropertyValue('anchor-name');
    this.originalAnchorPriority = media.style.getPropertyPriority('anchor-name');
    const inheritedNames = getComputedStyle(media).getPropertyValue('anchor-name').trim();
    media.style.setProperty('anchor-name', `${inheritedNames && inheritedNames !== 'none' ? `${inheritedNames}, ` : ''}${this.anchorName}`);
    Object.assign(this.canvas.style, {
      position: 'absolute', positionAnchor: this.anchorName, left: 'anchor(left)', top: 'anchor(top)',
      width: 'anchor-size(width)', height: 'anchor-size(height)',
      zIndex: getComputedStyle(media).zIndex, pointerEvents: 'none',
      background: 'transparent', margin: '0', padding: '0', border: '0',
    });
    this.canvas.dataset.localMediaCensorOverlay = 'true';
    if (media.id) this.canvas.dataset.localMediaCensorFor = media.id;
    media.after(this.canvas);
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
    this.bodyRegionCanvas = undefined;
    this.staticCanvas = undefined;
    this.faceCanvas = undefined;
    this.faceCanvases = [];
    this.blackCanvas = undefined;this.smartCanvas=undefined;
    this.trackCanvases.clear();
    this.continuityCanvases.clear();this.videoPadding=0;
    this.debugCanvases.clear();
    this.motion.clear();
    this.canvas.getContext('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
  syncParent(): void {
    const parent = this.media.parentNode;
    if (!this.media.isConnected || !(parent instanceof HTMLElement || parent instanceof ShadowRoot)) {
      this.canvas.style.display = 'none';
      return;
    }
    if (parent !== this.parent || this.media.nextSibling !== this.canvas) {
      this.parent = parent;
      this.media.after(this.canvas);
    }
    this.canvas.style.zIndex = getComputedStyle(this.media).zIndex;
  }
  set(result: AnalysisResult): void {
    this.frame = result;
    this.continuityCanvases.clear();
    this.bodyRegionCanvas = undefined;
    if (result.debugBodyRegions) {
      const { labels, width, height } = result.debugBodyRegions;
      const layer = document.createElement('canvas'); layer.width = width; layer.height = height;
      const ctx = layer.getContext('2d');
      if (ctx) {
        const image = ctx.createImageData(width, height);
        const colors = [[0, 0, 0], [240, 55, 65], [60, 140, 255], [155, 90, 235], [245, 210, 60], [225, 65, 190], [45, 195, 95], [45, 205, 215], [235, 155, 45], [255, 125, 100], [240, 55, 65], [220, 130, 50]];
        for (let p = 0; p < labels.length; p++) if (labels[p] > 0 && labels[p] < colors.length)
          image.data.set([...colors[labels[p]], 105], p * 4);
        ctx.putImageData(image, 0, 0);
        this.bodyRegionCanvas = layer;
      }
    }
    if (!result.trackMasks) {
      if (this.maskCanvas.width !== result.width) this.maskCanvas.width = result.width;
      if (this.maskCanvas.height !== result.height) this.maskCanvas.height = result.height;
      const ctx = this.bitmap ?? this.maskCanvas.getContext('2d');
      if (!ctx) throw new Error('Overlay canvas unavailable');
      const pixels = result.fabricFill ? new Uint8ClampedArray(result.rgbaMask)
        : new Uint8ClampedArray(result.rgbaMask.buffer as ArrayBuffer, result.rgbaMask.byteOffset, result.rgbaMask.byteLength);
      if (result.fabricFill && result.clothingRgb) applyClothing(pixels, result.clothingRgb);
      else if (result.fabricFill) applyFabric(pixels, result.width, result.height);
      if (result.fabricFill) {shadeFabricRuns(pixels,result.width,result.height);softenFabricEdges(pixels, result.width, result.height);}
      ctx.putImageData(new ImageData(pixels, result.width, result.height), 0, 0);
    }
    this.staticCanvas = result.staticMask ? this.layerCanvas(result.staticMask, result.width, result.height, this.staticCanvas) : undefined;
    this.faceCanvas = result.faceMask ? this.layerCanvas(result.faceMask, result.width, result.height, this.faceCanvas) : undefined;
    this.faceCanvases = (result.faceLayers ?? []).map((layer, index) => ({ canvas: this.layerCanvas(layer.alpha, result.width, result.height, this.faceCanvases[index]?.canvas), effect: layer.effect }));
    this.blackCanvas = result.blackMask ? this.layerCanvas(result.blackMask, result.width, result.height, this.blackCanvas,undefined,undefined,undefined,false) : undefined;
    this.smartCanvas=result.smartCoverMask?this.layerCanvas(result.smartCoverMask,result.width,result.height,this.smartCanvas,undefined,undefined,undefined,true):undefined;
    const active = new Set<string>();
    for (const mask of result.trackMasks || []) {
      active.add(mask.id);
      this.trackCanvases.set(mask.id, this.layerCanvas(mask.alpha, result.width, result.height, this.trackCanvases.get(mask.id), mask.fabricColor, mask.fabricLight, mask.fabricBox,undefined,mask.blackAlpha));
    }
    for (const id of this.trackCanvases.keys()) if (!active.has(id)) this.trackCanvases.delete(id);
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
  private fabricLayers = new WeakSet<HTMLCanvasElement>();
  private layerImages = new WeakMap<HTMLCanvasElement, ImageData>();
  private layerCanvas(alpha: Uint8Array, width: number, height: number, reusable?: HTMLCanvasElement, garmentColor?: GarmentTone, garmentLight?:[number,number,number,number], garmentBox?:{x:number;y:number;width:number;height:number},fabric=this.frame?.fabricFill,blackAlpha?:Uint8Array): HTMLCanvasElement {
    const canvas = reusable ?? document.createElement('canvas');
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    let image = this.layerImages.get(canvas);
    if (!image || image.width !== width || image.height !== height) {
      image = new ImageData(width, height);
      this.layerImages.set(canvas, image);
    }
    const pixels = image.data;
    for (let i = 0; i < alpha.length; i++) pixels[4 * i + 3] = alpha[i];
    if (fabric) {
      if (garmentColor) applyGarmentTone(pixels, garmentColor);
      else if (this.frame?.clothingRgb) applyClothing(pixels, this.frame.clothingRgb);
      else applyFabric(pixels, width, height);
      this.fabricLayers.add(canvas);
    } else if (this.fabricLayers.has(canvas)) {
      for (let i = 0; i < alpha.length; i++) pixels[4 * i] = pixels[4 * i + 1] = pixels[4 * i + 2] = 0;
      this.fabricLayers.delete(canvas);
    }
    if (fabric) shadeFabricRuns(pixels,width,height,garmentLight,garmentBox);
    if(blackAlpha)applyBlackPixels(pixels,blackAlpha);
    if (fabric) softenFabricEdges(pixels, width, height);
    canvas.getContext('2d')?.putImageData(image, 0, 0);
    return canvas;
  }
  private drawEffect(ctx: CanvasRenderingContext2D, dx: number, dy: number, width: number, height: number,
    effect?: AnalysisResult['effect']): void {
    if (!effect || effect.kind === 'black') return;
    try {
      const divisor = effect.kind === 'blur' ? this.media instanceof HTMLVideoElement ? 4 : 2 : effect.intensity;
      const source = effect.kind === 'blur' ? this.blurCanvas : this.checkerCanvas;
      const smallWidth = Math.max(1, Math.ceil(width / divisor));
      const smallHeight = Math.max(1, Math.ceil(height / divisor));
      if (source.width !== smallWidth) source.width = smallWidth;
      if (source.height !== smallHeight) source.height = smallHeight;
      const small = source.getContext('2d');
      if (!small) return;
      small.clearRect(0, 0, smallWidth, smallHeight);
      small.imageSmoothingEnabled = true;
      const filters = [effect.kind === 'blur' ? `blur(${Math.max(1, effect.intensity / divisor)}px)` : '',
        effect.grayscale ? 'grayscale(1)' : ''].filter(Boolean);
      small.filter = filters.length ? filters.join(' ') : 'none';
      if ((effect.kind === 'blur' && !small.filter.includes('blur(')) ||
          (effect.grayscale && !small.filter.includes('grayscale('))) return;
      small.drawImage(this.frameSource ?? this.media, 0, 0, smallWidth, smallHeight);
      small.filter = 'none';
      ctx.save();
      try {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.imageSmoothingEnabled = effect.kind !== 'checkerboard';
        ctx.drawImage(source, dx, dy, width, height);
      } finally { ctx.restore(); }
    } catch { /* Keep the already-drawn black mask if this media cannot be copied. */ }
  }
  setVideoPadding(bodyFraction:number):void{this.videoPadding=Math.max(0,Math.min(.04,bodyFraction));}
  setMotion(offsets: Map<string, { x: number; y: number }>, immediate=false): void { this.motion = offsets; if(immediate)this.drawNow();else this.draw(); }
  draw(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }
  /** Commit the first mask before the controller removes its blackout. */
  drawNow(): boolean {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    return this.render();
  }
  private render(): boolean {
      this.syncParent();
      if (!this.media.isConnected) return false;
      const rect = this.media.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) { this.canvas.style.display = 'none'; return false; }
      this.canvas.style.display = 'block';
      const scale = Math.min(devicePixelRatio || 1, 2);
      const cw = Math.ceil(rect.width * scale), ch = Math.ceil(rect.height * scale);
      if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
      const ctx = this.canvas.getContext('2d');
      if (!ctx) return false;
      ctx.clearRect(0, 0, cw, ch);
      if (!this.frame || this.frame.black) return false;
      const intrinsicW = this.media instanceof HTMLVideoElement ? this.media.videoWidth : this.media.naturalWidth;
      const intrinsicH = this.media instanceof HTMLVideoElement ? this.media.videoHeight : this.media.naturalHeight;
      if (!intrinsicW || !intrinsicH) return false;
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
          let layer = this.trackCanvases.get(mask.id);
          if (!layer) continue;
          if(this.videoPadding&&this.media instanceof HTMLVideoElement){
            const box=this.frame.tracks.find(track=>track.id===mask.id)?.box;
            if(box){
              const radius=Math.max(1,Math.round(this.videoPadding*Math.max(box.width,box.height)*s));
              let cached=this.continuityCanvases.get(mask.id);
              if(!cached||cached.radius!==radius){
                const alpha=dilate(mask.alpha,s,s,radius),black=mask.blackAlpha?dilate(mask.blackAlpha,s,s,radius):undefined;
                const canvas=this.layerCanvas(alpha,s,s,undefined,mask.fabricColor,mask.fabricLight,mask.fabricBox,undefined,black);
                cached={radius,canvas};this.continuityCanvases.set(mask.id,cached);
              }
              layer=cached.canvas;
            }
          }
          const shift = this.motion.get(mask.id);
          const mx = (shift?.x ?? 0) * s * renderedW / sourceW;
          const my = (shift?.y ?? 0) * s * renderedH / sourceH;
          if (mask.effect && mask.effect.kind !== 'black') {
            this.faceLayerCanvas.width = cw; this.faceLayerCanvas.height = ch;
            const temporary = this.faceLayerCanvas.getContext('2d')!;
            temporary.drawImage(layer, sx, sy, sourceW, sourceH, dx + mx, dy + my, renderedW, renderedH);
            this.drawEffect(temporary, dx, dy, renderedW, renderedH, mask.effect);
            ctx.drawImage(this.faceLayerCanvas, 0, 0);
          } else ctx.drawImage(layer, sx, sy, sourceW, sourceH, dx + mx, dy + my, renderedW, renderedH);
        }
      } else ctx.drawImage(this.maskCanvas, sx, sy, sourceW, sourceH, dx, dy, renderedW, renderedH);
      this.drawEffect(ctx, dx, dy, renderedW, renderedH, this.frame.effect);
      if (this.faceCanvas) {
        if (this.faceLayerCanvas.width !== cw || this.faceLayerCanvas.height !== ch) {
          this.faceLayerCanvas.width = cw; this.faceLayerCanvas.height = ch;
        }
        const faceContext = this.faceLayerCanvas.getContext('2d');
        if (faceContext) {
          faceContext.clearRect(0, 0, cw, ch);
          faceContext.drawImage(this.faceCanvas, sx, sy, sourceW, sourceH, dx, dy, renderedW, renderedH);
          this.drawEffect(faceContext, dx, dy, renderedW, renderedH, this.frame.faceEffect);
          ctx.drawImage(this.faceLayerCanvas, 0, 0);
        }
      }
      for (const layer of this.faceCanvases) {
        this.faceLayerCanvas.width = cw; this.faceLayerCanvas.height = ch;
        const temporary = this.faceLayerCanvas.getContext('2d')!;
        temporary.drawImage(layer.canvas, sx, sy, sourceW, sourceH, dx, dy, renderedW, renderedH);
        this.drawEffect(temporary, dx, dy, renderedW, renderedH, layer.effect);
        ctx.drawImage(this.faceLayerCanvas, 0, 0);
      }
      if(this.smartCanvas)ctx.drawImage(this.smartCanvas,sx,sy,sourceW,sourceH,dx,dy,renderedW,renderedH);
      if (this.blackCanvas) ctx.drawImage(this.blackCanvas, sx, sy, sourceW, sourceH, dx, dy, renderedW, renderedH);
      if (this.frame.debugPersonMasks) {
        if (this.bodyRegionCanvas) {
          const debugScale = this.bodyRegionCanvas.width / s;
          ctx.drawImage(this.bodyRegionCanvas, sx * debugScale, sy * debugScale, sourceW * debugScale, sourceH * debugScale,
            dx, dy, renderedW, renderedH);
        }
        if (this.frame.bodyRegionDiagnostics && this.frame.bodyRegionDiagnostics.model !== 'off' && !(this.media instanceof HTMLVideoElement)) {
          const diagnostic = this.frame.bodyRegionDiagnostics;
          const text = `Advanced segmentation ${diagnostic.model === 'finer' ? 'Quality' : 'Fast'} · ${diagnostic.status} · ${diagnostic.backend ?? 'no inference'} · ${Math.round(this.frame.timingsMs?.bodyRegions ?? 0)} ms`;
          ctx.font = `${Math.max(10, 11 * scale)}px system-ui, sans-serif`;
          ctx.fillStyle = 'rgba(0,0,0,.82)'; ctx.fillRect(dx, dy, Math.min(renderedW, ctx.measureText(text).width + 8), 18 * scale);
          ctx.fillStyle = '#fff'; ctx.fillText(text, dx + 4, dy + 13 * scale, Math.max(1, renderedW - 8));
        }
        const debugScale = (this.frame.debugPersonMasks[0]?.width ?? 128) / s;
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
          const bodyOnly = this.frame.genderDiagnostics?.model.startsWith('body-');
          const label = bodyOnly
            ? `face location ${Math.round(face.score * 100)}% · gender from body`
            : `face ${Math.round(face.score * 100)}% → ${track?.labelUsable ? `${track.label} ${Math.round(track.genderConfidence * 100)}%` : 'unclassified'}`;
          ctx.font = `${Math.max(10, 11 * scale)}px system-ui, sans-serif`;
          const labelWidth = ctx.measureText(label).width + 8;
          const labelY = y + h + 2;
          ctx.fillStyle = 'rgba(0,0,0,.78)'; ctx.fillRect(x, labelY, labelWidth, 16 * scale);
          ctx.fillStyle = color; ctx.fillText(label, x + 4, labelY + 12 * scale);
          ctx.restore();
        }
      }
    if (this.frameSource) {
      ctx.save();ctx.globalCompositeOperation='destination-over';
      ctx.drawImage(this.frameSource,0,0,this.frameSource.width,this.frameSource.height,dx,dy,renderedW,renderedH);ctx.restore();
    }
    return true;
  }
  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.canvas.remove();
    if (this.originalAnchorName) this.media.style.setProperty('anchor-name', this.originalAnchorName, this.originalAnchorPriority);
    else this.media.style.removeProperty('anchor-name');
    this.maskCanvas.width = this.maskCanvas.height = 0;
    this.checkerCanvas.width = this.checkerCanvas.height = 0;
    this.blurCanvas.width = this.blurCanvas.height = 0;
    this.faceLayerCanvas.width = this.faceLayerCanvas.height = 0;
    this.staticCanvas = undefined;
    this.faceCanvas = undefined;
    this.faceCanvases = [];
    this.trackCanvases.clear();
    this.continuityCanvases.clear();this.videoPadding=0;
    this.debugCanvases.clear();
    this.bodyRegionCanvas = undefined;
  }
}
