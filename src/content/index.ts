// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { DEFAULT_SETTINGS, ENGINE, normalizeSettings, resolveOnnxThreads, resolvePersonSize, resolveYoloSize, siteIsExcepted, type Label, type Settings } from '../config/settings';
import type { AnalysisResult, FrameKey, FramePacket } from '../state/contracts';
import { captureSquare, decodeImageBlob, sourceIsStatic } from '../media/capture';
import { FrameMotion } from '../media/frameMotionClient';
import { Overlay } from '../rendering/overlay';
import { imageAnalysisKey } from '../config/imageAnalysis';
import { BackgroundImages, type BackgroundSurface } from '../media/backgroundImages';
import { SharedImageWork } from '../media/sharedImageWork';
import { imageLookAheadPx, imageWorkRange } from '../media/imageWorkRange';
import { MediaDiscovery } from '../media/mediaDiscovery';
import { recoverVideoCors, videoNeedsCors } from '../media/videoCors';

const tag = 'data-local-media-censor-pending';
const pendingCss = `img[${tag}],video[${tag}]{filter:brightness(0)!important}`;

let settings: Settings = DEFAULT_SETTINGS;
let topLevelHost: string | undefined;
try { topLevelHost = window.top?.location.hostname.toLowerCase(); }
catch { /* Cross-origin frames ask the background script for the tab host. */ }
let labelMode = false;
let ensuringOffscreen: Promise<void> | undefined;
let preparingEngine: Promise<void> | undefined;
let preparingKey = '';
const controllers = new Set<MediaController>();
const byNode = new WeakMap<HTMLImageElement | HTMLVideoElement, MediaController>();

function protectedSite(): boolean {
  // An exception belongs to the page the user opened, not the host of a
  // third-party iframe. Cross-origin frames remain protected until the tab
  // hostname arrives from the background script.
  return settings.enabled && !(topLevelHost && siteIsExcepted(topLevelHost, settings.siteExceptions));
}
function eligible(node: HTMLImageElement | HTMLVideoElement): boolean {
  return protectedSite() && (node instanceof HTMLImageElement ? settings.images : settings.videos);
}
async function send<T>(message: unknown): Promise<T> { return await chrome.runtime.sendMessage(message) as T; }
async function ensureOffscreen(): Promise<void> {
  if (!ensuringOffscreen) ensuringOffscreen = send<{ ok: boolean; error?: string }>({ type: 'ensure-offscreen' })
    .then(response => { if (response?.ok === false) throw new Error(response.error || 'Offscreen host unavailable'); })
    .catch(error => { ensuringOffscreen = undefined; throw error; });
  await ensuringOffscreen;
}
function prepareEngine(kind: 'image' | 'video' = 'image'): void {
  if (!protectedSite()) return;
  const threads = resolveOnnxThreads(settings.onnxThreads, navigator.hardwareConcurrency);
  const size = resolvePersonSize(settings, kind);
  const key = `${threads}:${kind}:${size}:${kind === 'image' ? settings.imageCoverage : settings.videoDetector}`;
  if (preparingEngine && preparingKey === key) return;
  const prior = preparingEngine;
  preparingKey = key;
  preparingEngine = (prior?.catch(() => {}) ?? Promise.resolve()).then(async () => {
    await ensureOffscreen();
    await send({ type: 'prepare-engine', size, kind, detector: kind === 'video' ? settings.videoDetector : 'segment',
      semantic: kind === 'image',
      faces: (settings.automaticGender && (kind === 'image' ? settings.imageGenderModel : settings.videoGenderModel).startsWith('face')) ||
        settings.faceAssociation || settings.debugOverlay ||
        (kind === 'image' && (['face', 'either', 'both'].includes(settings.imageDetectionGate) ||
          (settings.imageSkinThresholdEnabled && !settings.imageSkinThresholdIncludeFace) ||
          settings.imageCoverage === 'whole-body' ||
          (settings.imageCoverage === 'regions' && settings.imageRegionFaceEffect !== 'show'))),
      gender: settings.automaticGender, threads });
  }).catch(() => { preparingEngine = undefined; });
}
async function imageBlob(url: string): Promise<Blob> {
  if (/^(blob:|data:)/.test(url)) return await (await fetch(url, { signal: AbortSignal.timeout(8000) })).blob();
  // Try the page's network context first, including CORS-enabled CDNs.
  try {
    const sameOrigin = new URL(url, location.href).origin === location.origin;
    const response = await fetch(url, { credentials: sameOrigin ? 'include' : 'omit', mode: 'cors', signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const blob = await response.blob();
      if (blob.type.startsWith('image/') && blob.size <= 20_000_000) return blob;
    }
  } catch { /* Page CSP, CORS, or a slow CDN may block this path. */ }
  const response = await send<{ ok: boolean; blob?: Blob; error?: string }>({ type: 'fetch-image', url });
  if (!response?.ok || !response.blob) throw new Error(response?.error || 'Image fetch unavailable');
  return response.blob;
}

type SharedImage = { blob: Blob; key: FrameKey; width: number; height: number; timingsMs?: AnalysisResult['timingsMs'] };
const sharedImages = new SharedImageWork<SharedImage>(24 * 1024 * 1024,
  value => value.blob.size + 1024,
  value => { void send({ type: 'reset-session', mediaSessionId: value.key.mediaSessionId, epoch: value.key.epoch }).catch(() => {}); });

async function analyzeImageSource(node: HTMLImageElement, source: string, current: Settings): Promise<SharedImage> {
  if ((node.currentSrc || node.src) !== source) throw new Error('source-change');
  const acquisitionStartedAtMs = Date.now();
  const width = node.naturalWidth, height = node.naturalHeight;
  const size = resolveYoloSize(current, 'image');
  const faceSize = (current.automaticGender && current.imageGenderModel.startsWith('face')) ||
    (current.imageSkinThresholdEnabled && !current.imageSkinThresholdIncludeFace) ||
    current.faceAssociation || current.debugOverlay ||
    ['face', 'either', 'both'].includes(current.imageDetectionGate) ||
    current.imageCoverage === 'whole-body' ||
    (current.imageCoverage === 'regions' && current.imageRegionFaceEffect !== 'show')
    ? current.faceCaptureSize : undefined;
  let rgba: Uint8Array | undefined;
  let faceRgba: Uint8Array | undefined;
  try {
    rgba = captureSquare(node, width, height, size);
    faceRgba = faceSize ? captureSquare(node, width, height, faceSize) : undefined;
  } catch { /* Cross-origin media needs the fetched, origin-clean bitmap. */ }
  const blob = await imageBlob(source);
  if (!await sourceIsStatic(blob)) throw new Error('Animated or unverified image');
  if (!rgba) {
    const bitmap = await decodeImageBlob(blob);
    try {
      const aspectDifference = Math.abs(bitmap.width * height - bitmap.height * width);
      if (aspectDifference > Math.max(bitmap.width, bitmap.height)) throw new Error('Fetched image differs in aspect ratio');
      rgba = captureSquare(bitmap.source, bitmap.width, bitmap.height, size);
      faceRgba = faceSize ? captureSquare(bitmap.source, bitmap.width, bitmap.height, faceSize) : undefined;
    } finally { bitmap.close(); }
  }
  // The source owns this session, so removing/resetting the first element does
  // not cancel the result that another identical image is still awaiting.
  const key: FrameKey = { mediaSessionId: crypto.randomUUID(), epoch: 1, sequence: 1 };
  try {
    await ensureOffscreen();
    const response = await send<{ ok: boolean; result?: AnalysisResult; error?: string }>({ type: 'analyze',
      frame: { key, kind: 'image', acquisitionStartedAtMs, capturedAtMs: Date.now(),
        width: size, height: size, rgba, faceRgba, faceSize } satisfies FramePacket, settings: current });
    if (!response?.ok || !response.result) throw new Error(response?.error || 'not-ready');
    return { blob, key, width, height, timingsMs: response.result.timingsMs };
  } catch (error) {
    void send({ type: 'reset-session', mediaSessionId: key.mediaSessionId, epoch: key.epoch }).catch(() => {});
    throw error;
  }
}

class MediaController {
  private readonly sessionId = crypto.randomUUID();
  private epoch = 1;
  private sequence = 0;
  private result?: AnalysisResult;
  private source = '';
  private inFlight = false;
  private refreshPending = false;
  private nextCaptureAt = 0;
  private videoErrors = 0;
  private sceneCuts = 0;
  private motion?: FrameMotion;
  private frameCallback = 0;
  private disposed = false;
  private overlay?: Overlay;
  private resize?: ResizeObserver;
  private watchdog?: number;
  private readonly listeners: Array<() => void> = [];
  private lastLabelUi?: HTMLElement;
  private originalFilter: string;
  private originalFilterPriority: string;
  private blacked = true;
  private imageRetryDelayMs = 400;
  private imageRetryTimer = 0;
  private imageRetryCount = 0;
  private imageBlocked = false;
  private originalLoading?: HTMLImageElement['loading'];
  private loadingAheadTimer = 0;
  private lazyAheadStarted = false;
  private labelPending = false;
  private corsRecovery?: Promise<void>;
  private corsRecoverySource = '';
  private readonly corsAbort = new AbortController();
  private videoRetryTimer = 0;
  private videoRetryDelayMs = 500;

  get viewportNode(): HTMLElement { return this.background?.element ?? this.node; }
  constructor(readonly node: HTMLImageElement | HTMLVideoElement, private background?: BackgroundSurface) {
    node.dataset.localMediaCensorBuild = 'media-lifecycle-3';
    this.originalFilter = node.style.getPropertyValue('filter');
    this.originalFilterPriority = node.style.getPropertyPriority('filter');
    if (node instanceof HTMLImageElement) {
      registerImage(this);
      this.listen(node, 'load', () => { this.finishImageLoad(); this.reset('image-load'); this.sourceChanged(); });
      this.listen(node, 'error', () => {
        this.finishImageLoad(); this.imageBlocked = true;
        node.dataset.localMediaCensorStatus = 'image-load-error'; this.protect(); requestImageWork();
      });
    } else {
      this.watchdog = window.setInterval(() => this.checkFreshness(), 100);
      this.listen(document, 'fullscreenchange', () => this.fullscreenChanged());
      this.listen(document, 'visibilitychange', () => this.overlay?.draw());
      for (const name of ['loadedmetadata', 'resize', 'emptied']) this.listen(node, name, () => { this.reset(); this.sourceChanged(); });
      this.listen(node, 'loadeddata', () => this.sourceChanged());
      for (const name of ['seeking', 'ratechange']) this.listen(node, name, () => this.reset());
      this.listen(node, 'seeked', () => void this.captureVideo());
      this.listen(node, 'play', () => { this.reset('video-play'); this.startVideo(); });
      this.listen(node, 'pause', () => {
        if (!this.result || this.result.black) this.protect();
        else { this.overlay?.setMotion(this.motion?.offsets() ?? new Map()); this.reveal(); }
        this.refreshPending = true; this.maybeRefresh();
      });
      this.listen(node, 'enterpictureinpicture', () => { node.pause(); this.protect(); });
      this.listen(node, 'leavepictureinpicture', () => this.reset());
      this.listen(node, 'ended', () => this.protect());
    }
    this.protect();
    this.sourceChanged();
    if (eligible(node)) prepareEngine(node instanceof HTMLVideoElement ? 'video' : 'image');
  }
  private ensureOverlay(): Overlay {
    if (!this.overlay) {
      this.overlay = new Overlay(this.node);
      this.resize = new ResizeObserver(() => this.overlay?.draw());
      this.resize.observe(this.node);
      this.overlay.canvas.addEventListener('click', event => this.selectTrack(event));
      this.overlay.setPointerInput(labelMode);
    }
    return this.overlay;
  }
  private ensureMotion(): FrameMotion | undefined {
    if (this.motion || !(this.node instanceof HTMLVideoElement)) return this.motion;
    const video = this.node;
    try {
      this.motion = new FrameMotion(cut => {
        if (this.disposed) return;
        if (cut && this.result) {
          this.sceneCuts++;
          video.dataset.localMediaCensorSceneCuts = String(this.sceneCuts);
          this.reset();
          video.dataset.localMediaCensorStatus = 'scene-cut';
        }
        if (this.motion) {
          video.dataset.localMediaCensorMotionFrames = String(this.motion.frames);
          video.dataset.localMediaCensorMotionWorkerMs = String(Math.round(this.motion.processingMs * 10) / 10);
        }
      });
      if (this.result && !this.result.black) this.motion.align(this.result);
    } catch (error) { video.dataset.localMediaCensorMotionError = String(error); }
    return this.motion;
  }
  private listen(target: EventTarget, type: string, callback: EventListener, capture = false): void {
    target.addEventListener(type, callback, capture);
    this.listeners.push(() => target.removeEventListener(type, callback, capture));
  }
  private protect(): void {
    if (!eligible(this.node)) return;
    if (this.background) { this.blacked = true; this.background.protect(); return; }
    this.blacked = true;
    this.node.style.setProperty('filter', 'brightness(0)', 'important');
    this.node.setAttribute(tag, '');
    if (!this.node.dataset.localMediaCensorStatus) this.node.dataset.localMediaCensorStatus = 'pending';
  }
  private reveal(): void {
    this.blacked = false;
    if (this.background) { if (!eligible(this.node)) this.background.release(); return; }
    this.node.removeAttribute(tag);
    if (this.originalFilter) this.node.style.setProperty('filter', this.originalFilter, this.originalFilterPriority);
    else this.node.style.removeProperty('filter');
  }
  private holdVideoMaskOrProtect(): void {
    if (this.node instanceof HTMLVideoElement && settings.videoPlayback === 'smooth' && this.result && !this.result.black) {
      this.node.dataset.localMediaCensorStatus = 'propagated';
      this.overlay?.setMotion(this.motion?.offsets() ?? new Map());
      if (this.blacked) this.reveal();
      return;
    }
    if (this.node instanceof HTMLVideoElement && this.result && !this.result.black && this.motion?.canPropagate(this.result, Date.now())) {
      this.node.dataset.localMediaCensorStatus = 'propagated';
      this.overlay?.setMotion(this.motion.offsets());
      if (this.blacked) this.reveal();
    } else this.protect();
  }
  private currentSource(): string { return this.node instanceof HTMLImageElement ? this.node.currentSrc || this.node.src : this.node.currentSrc || this.node.src || this.node.querySelector('source')?.src || ''; }
  private key(): FrameKey { return { mediaSessionId: this.sessionId, epoch: this.epoch, sequence: ++this.sequence }; }
  private reset(reason = 'state-change'): void {
    this.finishImageLoad();
    this.lazyAheadStarted = false;
    this.node.dataset.localMediaCensorResetReason = reason;
    if (this.imageRetryTimer) { clearTimeout(this.imageRetryTimer); this.imageRetryTimer = 0; }
    this.imageRetryDelayMs = 400;
    this.imageRetryCount = 0;
    this.imageBlocked = false;
    if (this.videoRetryTimer) { clearTimeout(this.videoRetryTimer); this.videoRetryTimer = 0; }
    this.videoRetryDelayMs = 500;
    const priorEpoch = this.epoch;
    this.epoch++;
    this.sequence = 0;
    this.result = undefined;
    this.motion?.reset();
    this.overlay?.clear();
    if (this.inFlight) this.refreshPending = true;
    this.protect();
    void send({ type: 'reset-session', mediaSessionId: this.sessionId, epoch: priorEpoch }).catch(() => {});
    if (this.node instanceof HTMLVideoElement && this.node.readyState >= 2) void this.captureVideo();
  }
  private maybeRefresh(): void {
    if (!this.refreshPending || this.inFlight || this.disposed) return;
    this.refreshPending = false;
    if (this.node instanceof HTMLImageElement) requestImageWork();
    else void this.captureVideo();
  }
  retryPriority(): number { return this.imageRetryCount; }
  private retryImage(epoch: number): void {
    if (this.imageRetryTimer || this.disposed) return;
    this.imageRetryCount++;
    this.imageRetryTimer = window.setTimeout(() => {
      this.imageRetryTimer = 0;
      if (!this.disposed && epoch === this.epoch && !this.result) requestImageWork();
    }, this.imageRetryDelayMs);
    this.imageRetryDelayMs = Math.min(30000, this.imageRetryDelayMs * 2);
  }
  private retryPausedVideo(epoch: number): void {
    if (!(this.node instanceof HTMLVideoElement) || !this.node.paused || this.videoRetryTimer || this.disposed) return;
    this.videoRetryTimer = window.setTimeout(() => {
      this.videoRetryTimer = 0;
      if (!this.disposed && epoch === this.epoch && this.node instanceof HTMLVideoElement && this.node.paused && eligible(this.node))
        void this.captureVideo();
    }, this.videoRetryDelayMs);
    this.videoRetryDelayMs = Math.min(30000, this.videoRetryDelayMs * 2);
  }
  sourceChanged(): void {
    if (this.disposed) return;
    this.overlay?.syncParent();
    const source = this.currentSource();
    if (source !== this.source) { this.source = source; this.reset('source-change'); }
    if (this.node instanceof HTMLImageElement) {
      requestImageWork();
    } else if (this.node.readyState >= 2) {
      if (this.node.paused) void this.captureVideo();
      else this.startVideo();
    }
  }
  navigationChanged(force = false): void {
    // Preview panels can change browser history without changing the grid.
    // Keep still-image results unless the source changed or Retry was requested.
    if (force) this.corsRecoverySource = '';
    if (force || this.node instanceof HTMLVideoElement) this.reset(force ? 'retry' : 'navigation');
    this.sourceChanged();
    this.overlay?.draw();
  }
  reprocessFaces(): void {
    if (this.disposed) return;
    this.reset();
    if (this.node instanceof HTMLImageElement) requestImageWork();
    else if (!this.node.paused) this.startVideo();
  }
  private async dispatch(packet: FramePacket): Promise<void> {
    this.inFlight = true;
    try {
      await ensureOffscreen();
      const response = await send<{ ok: boolean; result?: AnalysisResult; error?: string }>({ type: 'analyze', frame: packet, settings });
      // A source/load reset can retire a queued request while it is waiting.
      // Its failure must not block the replacement image's fresh epoch.
      if (this.disposed || packet.key.epoch !== this.epoch) return;
      if (!response?.ok) {
        this.node.dataset.localMediaCensorStatus = response?.error || 'not-ready';
        if (packet.kind === 'video') {
          this.videoErrors++;
          this.node.dataset.localMediaCensorVideoErrors = String(this.videoErrors);
          this.node.dataset.localMediaCensorLastError = response?.error || 'not-ready';
        }
        const retryable = ['busy', 'not-ready', 'backend-retry', 'capacity', 'replaced'].includes(response?.error || 'not-ready');
        if (packet.kind === 'video' && (retryable || ['stale', 'engine-unavailable'].includes(response?.error || '')))
          this.retryPausedVideo(packet.key.epoch);
        if (packet.kind === 'image' && retryable && !this.imageRetryTimer) {
          this.imageRetryCount++;
          this.imageRetryTimer = window.setTimeout(() => {
            this.imageRetryTimer = 0;
            if (!this.disposed && packet.key.epoch === this.epoch && !this.result) requestImageWork();
          }, this.imageRetryDelayMs);
          this.imageRetryDelayMs = Math.min(30000, this.imageRetryDelayMs * 2);
        }
        if (packet.kind === 'image' && !retryable) this.imageBlocked = true;
        this.holdVideoMaskOrProtect();
        return;
      }
      this.imageRetryDelayMs = 400;
      this.imageRetryCount = 0;
      this.videoRetryDelayMs = 500;
      if (response.result) this.accept(response.result);
    } catch (error) {
      if (this.disposed || packet.key.epoch !== this.epoch) return;
      this.node.dataset.localMediaCensorStatus = error instanceof Error ? error.message : 'transport-error';
      if (packet.kind === 'image') this.imageBlocked = true;
      else {
        this.videoErrors++; this.node.dataset.localMediaCensorVideoErrors = String(this.videoErrors);
        this.node.dataset.localMediaCensorLastError = this.node.dataset.localMediaCensorStatus;
        this.retryPausedVideo(packet.key.epoch);
      }
      this.holdVideoMaskOrProtect();
    }
    finally { this.inFlight = false; this.maybeRefresh(); }
  }
  private accept(result: AnalysisResult): void {
    if (this.disposed || !eligible(this.node) || result.key.mediaSessionId !== this.sessionId || result.key.epoch !== this.epoch) return;
    if (this.result && result.key.sequence < this.result.key.sequence) return;
    if (result.settingsRevision < settings.revision) return;
    this.result = result;
    if (this.node instanceof HTMLVideoElement && !result.black) this.motion?.align(result);
    this.imageBlocked = false;
    this.node.dataset.localMediaCensorLatencyMs = String(result.analyzedAtMs - result.capturedAtMs);
    if (result.acquisitionStartedAtMs) {
      this.node.dataset.localMediaCensorRevealMs = String(Date.now() - result.acquisitionStartedAtMs);
      this.node.dataset.localMediaCensorTransportMs = String(Date.now() - result.analyzedAtMs);
    }
    this.node.dataset.localMediaCensorSequence = String(result.key.sequence);
    if (result.timingsMs) this.node.dataset.localMediaCensorTimingsMs = JSON.stringify(result.timingsMs);
    if (result.genderDiagnostics) this.node.dataset.localMediaCensorGender = JSON.stringify(result.genderDiagnostics);
    const lateVideo = this.node instanceof HTMLVideoElement && !this.node.paused &&
      (Date.now() - result.capturedAtMs > ENGINE.maxResultAgeMs ||
        (result.mediaTimeSec !== undefined && Math.abs(this.node.currentTime - result.mediaTimeSec) > ENGINE.maxResultAgeMs / 1000));
    if (lateVideo && settings.videoPlayback === 'strict' && !this.motion?.canPropagate(result, Date.now())) {
      this.node.dataset.localMediaCensorStatus = 'stale';
      this.protect();
      return;
    }
    this.node.dataset.localMediaCensorStatus = lateVideo ? 'propagated' : result.reason;
    if (result.black) { this.overlay?.clear(); this.protect(); }
    else if (this.background) {
      this.background.accept(result);
      this.blacked = false;
    } else {
      const overlay = this.ensureOverlay();
      overlay.set(result);
      if (this.node instanceof HTMLVideoElement) overlay.setMotion(this.motion?.offsets() ?? new Map());
      if (overlay.drawNow()) this.reveal();
      else this.protect();
    }
    this.overlay?.draw();
  }
  imageReadyForWork(): boolean {
    return this.node instanceof HTMLImageElement && this.viewportNode.isConnected && !this.disposed && !this.inFlight && !this.imageBlocked && !this.imageRetryTimer &&
      eligible(this.node) && this.node.complete && this.node.naturalWidth > 0 && !!this.currentSource() &&
      (!this.result || this.result.settingsRevision < settings.revision);
  }
  imageHasPendingWork(): boolean {
    return this.node instanceof HTMLImageElement && this.viewportNode.isConnected && !this.disposed && !this.imageBlocked &&
      eligible(this.node) && !!this.currentSource() && (!this.node.complete || this.node.naturalWidth > 0) &&
      (!this.result || this.result.settingsRevision < settings.revision);
  }
  imageCanLoadAhead(): boolean {
    return this.node instanceof HTMLImageElement && this.imageHasPendingWork() && !this.lazyAheadStarted &&
      this.node.loading === 'lazy' && !this.node.complete;
  }
  loadImageAhead(): void {
    if (!(this.node instanceof HTMLImageElement) || !this.imageCanLoadAhead()) return;
    this.lazyAheadStarted = true;
    this.originalLoading = this.node.loading;
    loadingAheadImages.add(this);
    this.node.dataset.localMediaCensorStatus = 'preloading';
    this.node.loading = 'eager';
    // A stalled lazy resource must not hold up the entire look-ahead queue.
    this.loadingAheadTimer = window.setTimeout(() => { this.finishImageLoad(); requestImageWork(); }, 10000);
  }
  private finishImageLoad(): void {
    if (this.loadingAheadTimer) { clearTimeout(this.loadingAheadTimer); this.loadingAheadTimer = 0; }
    loadingAheadImages.delete(this);
    if (this.node instanceof HTMLImageElement && this.originalLoading !== undefined) {
      if (this.node.loading === 'eager') this.node.loading = this.originalLoading;
      this.originalLoading = undefined;
    }
  }
  async processImage(): Promise<void> {
    if (!this.imageReadyForWork() || !imageWorkRange(this.viewportNode.getBoundingClientRect(), innerWidth, innerHeight)) return;
    this.node.dataset.localMediaCensorStatus = 'analyzing';
    if (this.result) { await this.reevaluateCached(); return; }
    await this.captureImage();
  }
  markWaitingViewport(): void {
    if (this.node instanceof HTMLImageElement && !this.result && !this.imageBlocked && !this.inFlight) this.node.dataset.localMediaCensorStatus = 'waiting-viewport';
  }
  private async captureImage(): Promise<void> {
    if (!eligible(this.node) || !(this.node instanceof HTMLImageElement) || this.inFlight || !this.node.naturalWidth) return;
    this.inFlight = true;
    const acquireStarted = performance.now();
    const captureEpoch = this.epoch;
    const current = settings;
    const source = this.currentSource();
    const sharedKey = JSON.stringify([source, imageAnalysisKey(current)]);
    try {
      if (!source) return;
      const work = sharedImages.get(sharedKey, () => analyzeImageSource(this.node as HTMLImageElement, source, current));
      this.node.dataset.localMediaCensorImageReuse = String(work.reused);
      const shared = await work.promise;
      if (!imageWorkRange(this.viewportNode.getBoundingClientRect(), innerWidth, innerHeight) ||
          this.currentSource() !== source || this.epoch !== captureEpoch || this.disposed ||
          imageAnalysisKey(settings) !== imageAnalysisKey(current)) return;
      const aspectDifference = Math.abs(shared.width * this.node.naturalHeight - shared.height * this.node.naturalWidth);
      if (aspectDifference > Math.max(shared.width, shared.height)) throw new Error('Fetched image differs in aspect ratio');
      this.background?.source(shared.blob);
      this.node.dataset.localMediaCensorAcquireMs = String(Math.round(performance.now() - acquireStarted));
      // Each element adopts its own mutable session for masks and manual labels.
      // Adoption only copies detections and renders; it never runs image models.
      const response = await send<{ ok: boolean; result?: AnalysisResult; error?: string }>({ type: 'reuse-image',
        key: this.key(), fromKey: shared.key, settings });
      if (this.epoch !== captureEpoch || this.disposed) return;
      if (!response?.ok || !response.result) {
        if (response?.error === 'Cached analysis unavailable') sharedImages.remove(sharedKey);
        throw new Error(response?.error || 'not-ready');
      }
      if (!work.reused && shared.timingsMs) response.result.timingsMs = shared.timingsMs;
      this.imageRetryDelayMs = 400;
      this.imageRetryCount = 0;
      this.accept(response.result);
    } catch (error) {
      if (this.epoch !== captureEpoch || this.disposed) return;
      const message = error instanceof Error ? error.message : 'image-error';
      this.node.dataset.localMediaCensorStatus = message;
      if (message === 'Animated or unverified image' || message === 'Fetched image differs in aspect ratio') this.imageBlocked = true;
      else this.retryImage(this.epoch);
      this.protect();
    }
    finally { this.inFlight = false; this.maybeRefresh(); }
  }
  private startVideo(): void {
    if (!(this.node instanceof HTMLVideoElement) || this.frameCallback) return;
    const video = this.node;
    const loop = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      this.frameCallback = 0;
      if (this.disposed || video.paused || !eligible(video)) return;
      if (!videoAdmitted(video)) { video.dataset.localMediaCensorStatus = 'capacity'; this.protect(); }
      else if (!this.corsRecovery) {
        const motion = this.ensureMotion();
        const motionStarted = performance.now();
        motion?.observe(video, Date.now());
        if (motion?.error) video.dataset.localMediaCensorMotionError = motion.error;
        video.dataset.localMediaCensorMotionMs = String(Math.round((performance.now() - motionStarted) * 10) / 10);
        this.overlay?.setMotion(motion?.offsets() ?? new Map());
        if (Date.now() >= this.nextCaptureAt && !this.inFlight) void this.captureVideo(metadata.mediaTime);
      }
      this.frameCallback = video.requestVideoFrameCallback(loop);
      this.overlay?.draw();
    };
    this.frameCallback = video.requestVideoFrameCallback(loop);
  }
  private async captureVideo(mediaTime?: number): Promise<void> {
    if (!eligible(this.node) || !(this.node instanceof HTMLVideoElement) || this.inFlight || this.corsRecovery || this.labelPending || this.node.readyState < 2) return;
    if (!videoAdmitted(this.node)) { this.node.dataset.localMediaCensorStatus = 'capacity'; this.protect(); return; }
    const video = this.node;
    const rate = settings.videoDetector === 'fast-box' ? 12 : ENGINE.modes[settings.performance].initialHz;
    this.nextCaptureAt = Date.now() + 1000 / rate;
    try {
      // Some decoders initially return a blank frame before reporting taint.
      // Do not accept that as an analyzed, safe cross-origin video.
      if (videoNeedsCors(video)) throw new DOMException('Cross-origin video needs CORS for frame capture', 'SecurityError');
      const captureStarted = performance.now();
      const size = resolvePersonSize(settings, 'video');
      const rgba = captureSquare(video, video.videoWidth, video.videoHeight, size);
      video.dataset.localMediaCensorCaptureAccess = video.crossOrigin === null ? 'direct' : 'cors';
      const faceRgba = (settings.automaticGender && settings.videoGenderModel.startsWith('face')) ||
        settings.faceAssociation || settings.debugOverlay
        ? captureSquare(video, video.videoWidth, video.videoHeight, settings.faceCaptureSize) : undefined;
      const key = this.key();
      video.dataset.localMediaCensorCaptureSequence = String(key.sequence);
      video.dataset.localMediaCensorCaptureMs = String(Math.round(performance.now() - captureStarted));
      await this.dispatch({ key, kind: 'video', mediaTimeSec: mediaTime ?? video.currentTime,
        paused: video.paused,
        capturedAtMs: Date.now(), width: size, height: size, rgba, faceRgba, faceSize: faceRgba ? settings.faceCaptureSize : undefined,
        motionTracks: this.motion?.predictedTracks() });
    } catch (error) {
      this.node.dataset.localMediaCensorStatus = error instanceof Error ? error.message : 'capture-error';
      if (error instanceof DOMException && error.name === 'SecurityError') {
        // An old mask cannot safely cover an unreadable replacement stream.
        this.result = undefined; this.overlay?.clear(); this.protect();
        video.dataset.localMediaCensorCaptureAccess = 'unreadable';
        video.dataset.localMediaCensorStatus = 'video-capture-unavailable';
        const source = this.currentSource();
        if (source && source !== this.corsRecoverySource) {
          this.corsRecoverySource = source;
          this.node.dataset.localMediaCensorStatus = 'video-cors-recovery';
          this.corsRecovery = recoverVideoCors(video, this.corsAbort.signal, () => !this.disposed && eligible(video))
            .then(recovered => {
              video.dataset.localMediaCensorCaptureAccess = recovered ? 'cors' : 'unreadable';
              if (!recovered) video.dataset.localMediaCensorStatus = 'video-capture-unavailable';
              this.motion?.dispose(); this.motion = undefined;
            }).finally(() => {
              this.corsRecovery = undefined;
              if (!this.disposed) this.sourceChanged();
            });
        }
      } else this.holdVideoMaskOrProtect();
    }
  }
  private checkFreshness(): void {
    if (this.disposed || !this.node.isConnected) { this.dispose(); return; }
    if (!eligible(this.node)) { this.overlay?.clear(); if (this.blacked) this.reveal(); return; }
    if (this.blacked && (!this.node.hasAttribute(tag) || getComputedStyle(this.node).filter !== 'brightness(0)')) this.protect();
    if (!(this.node instanceof HTMLVideoElement) || this.node.paused) return;
    if (!this.result) {
      if (!this.corsRecovery) this.node.dataset.localMediaCensorStatus = this.node.dataset.localMediaCensorCaptureAccess === 'unreadable' ? 'video-capture-unavailable' : 'stale';
      this.protect(); return;
    }
    if (settings.videoPlayback === 'strict' && (Date.now() - this.result.capturedAtMs > ENGINE.maxResultAgeMs ||
        (this.result.mediaTimeSec !== undefined && Math.abs(this.node.currentTime - this.result.mediaTimeSec) > ENGINE.maxResultAgeMs / 1000))) {
      if (!this.result.black && this.motion?.canPropagate(this.result, Date.now())) {
        this.node.dataset.localMediaCensorStatus = 'propagated';
        if (this.blacked) { this.ensureOverlay().set(this.result); this.reveal(); }
        this.overlay?.setMotion(this.motion.offsets());
        return;
      }
      this.node.dataset.localMediaCensorStatus = 'stale';
      this.protect();
    }
  }
  private fullscreenChanged(): void {
    if (this.node instanceof HTMLVideoElement && document.fullscreenElement === this.node) {
      this.node.pause(); this.protect();
    }
    this.overlay?.draw();
  }
  async reevaluate(): Promise<void> {
    if (!eligible(this.node)) {
      this.overlay?.clear(); this.reveal();
      this.node.dataset.localMediaCensorStatus = protectedSite() ? 'off' : settings.enabled ? 'site-exception' : 'off';
      return;
    }
    if (this.node instanceof HTMLImageElement) {
      if (!this.result || this.result.settingsRevision < settings.revision) { this.protect(); requestImageWork(); }
      return;
    }
    if (!this.result) { this.protect(); this.refreshPending = true; this.maybeRefresh(); this.sourceChanged(); return; }
    await this.reevaluateCached();
  }
  siteAccessChanged(): void {
    if (this.disposed) return;
    if (!eligible(this.node) && this.node instanceof HTMLVideoElement && this.frameCallback) {
      this.node.cancelVideoFrameCallback(this.frameCallback);
      this.frameCallback = 0;
    }
    this.reset();
    if (!eligible(this.node)) {
      this.refreshPending = false;
      this.resize?.disconnect(); this.resize = undefined;
      this.overlay?.dispose(); this.overlay = undefined;
      this.motion?.dispose(); this.motion = undefined;
      this.lastLabelUi?.remove(); this.lastLabelUi = undefined;
      this.reveal();
      this.node.dataset.localMediaCensorStatus = settings.enabled ? 'site-exception' : 'off';
    } else this.sourceChanged();
  }
  private async reevaluateCached(): Promise<void> {
    if (!this.result || this.inFlight) return;
    this.inFlight = true;
    if (this.node instanceof HTMLImageElement) this.protect();
    try {
      const response = await send<{ ok: boolean; result?: AnalysisResult }>({ type: 'reevaluate', key: this.result.key, settings });
      if (response.ok && response.result) this.accept(response.result);
      else if (this.node instanceof HTMLImageElement) {
        this.result = undefined;
        this.imageBlocked = false;
      }
    } catch { if (this.node instanceof HTMLImageElement) this.imageBlocked = true; this.protect(); }
    finally { this.inFlight = false; this.maybeRefresh(); }
  }
  private selectTrack(event: MouseEvent): void {
    if (!labelMode || !this.result) return;
    const position = this.overlay?.analysisPosition(event.clientX, event.clientY);
    if (!position) { this.node.dataset.localMediaCensorStatus = 'label-outside'; return; }
    const { x, y } = position;
    const pad = 4 / this.result.width;
    const candidates = this.result.tracks.filter(t => x >= t.box.x - pad && x <= t.box.x + t.box.width + pad && y >= t.box.y - pad && y <= t.box.y + t.box.height + pad);
    if (!candidates.length) {
      this.node.dataset.localMediaCensorStatus = 'label-no-candidate';
      return;
    }
    this.lastLabelUi?.remove();
    const menu = document.createElement('div');
    menu.dataset.localMediaCensorLabelMenu = 'true';
    menu.style.cssText = `position:fixed;left:${event.clientX}px;top:${event.clientY}px;z-index:2147483647;background:#171717;color:white;padding:8px;border:1px solid white;font:13px system-ui`;
    const choose = document.createElement('select');
    for (const [index, track] of candidates.entries()) {
      const option = document.createElement('option');
      option.value = track.id;
      option.textContent = `Person ${index + 1} — ${track.labelUsable ? track.label : 'unlabelled'} (${track.id})`;
      choose.appendChild(option);
    }
    const label = document.createElement('select');
    for (const value of ['female', 'male', 'unknown']) { const option = document.createElement('option'); option.value = value; option.textContent = value; label.appendChild(option); }
    const button = document.createElement('button'); button.textContent = 'Assign';
    const feedback = document.createElement('span');
    button.onclick = async () => {
      button.disabled = true; button.textContent = 'Assigning…'; feedback.textContent = '';
      const applied = await this.assign(choose.value, label.value as Label);
      if (applied) menu.remove();
      else { button.disabled = false; button.textContent = 'Retry'; feedback.textContent = ' Track changed or is uncertain. Pause and select it again.'; }
    };
    menu.append(choose, label, button, feedback);
    (document.body || document.documentElement).appendChild(menu);
    this.lastLabelUi = menu;
  }
  private async assign(trackId: string, label: Label): Promise<boolean> {
    if (!this.result) return false;
    this.labelPending = true;
    this.node.dataset.localMediaCensorLabelOutcome = 'pending';
    let applied = false;
    try {
      const response = await send<{ ok: boolean; result?: AnalysisResult; error?: string }>({ type: 'label-track', key: this.result.key, trackId, label, settings });
      if (response.ok && response.result) { this.accept(response.result); this.node.dataset.localMediaCensorLabelOutcome = 'applied'; applied = true; }
      else { this.node.dataset.localMediaCensorStatus = response.error || 'label-unavailable'; this.node.dataset.localMediaCensorLabelOutcome = 'failed'; }
    } catch { this.node.dataset.localMediaCensorStatus = 'label-unavailable'; this.node.dataset.localMediaCensorLabelOutcome = 'failed'; }
    finally { this.labelPending = false; }
    if (applied) {
      labelMode = false;
      for (const controller of controllers) controller.overlay?.setPointerInput(false);
    }
    return applied;
  }
  setLabelMode(on: boolean): void { this.overlay?.setPointerInput(on); }
  visibleStatus(): { analyzed: number; detected: number; labelled: number; automatic: number; male: number; female: number; unlabelled: number } | undefined {
    if (this.disposed || !this.viewportNode.isConnected || !eligible(this.node)) return;
    const rect = this.viewportNode.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) return;
    const tracks = this.result?.tracks ?? [];
    const labelled = tracks.filter(track => track.labelUsable && track.label !== 'unknown').length;
    const automatic = tracks.filter(track => track.labelUsable && track.labelSource === 'automatic').length;
    const male = tracks.filter(track => track.labelUsable && track.label === 'male').length;
    const female = tracks.filter(track => track.labelUsable && track.label === 'female').length;
    return { analyzed: Number(Boolean(this.result)), detected: tracks.length, labelled, automatic, male, female, unlabelled: tracks.length - labelled };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.corsAbort.abort();
    this.finishImageLoad();
    if (this.node instanceof HTMLVideoElement && this.frameCallback) this.node.cancelVideoFrameCallback(this.frameCallback);
    if (this.watchdog !== undefined) clearInterval(this.watchdog);
    this.motion?.dispose();
    if (this.imageRetryTimer) clearTimeout(this.imageRetryTimer);
    if (this.videoRetryTimer) clearTimeout(this.videoRetryTimer);
    this.resize?.disconnect();
    for (const release of this.listeners) release();
    if (this.node instanceof HTMLImageElement) unregisterImage(this);
    this.overlay?.dispose();
    this.lastLabelUi?.remove();
    this.reveal();
    controllers.delete(this);
    byNode.delete(this.node);
    void send({ type: 'reset-session', mediaSessionId: this.sessionId, epoch: this.epoch }).catch(() => {});
  }
}

const visibleImages = new Set<MediaController>();
const nearbyImages = new Set<MediaController>();
const loadingAheadImages = new Set<MediaController>();
const imageTargets = new Map<Element, Set<MediaController>>();
const maxImageWork = 2;
let activeImageWork = 0;
let imagePumpScheduled = false;
const imageObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    for (const controller of imageTargets.get(entry.target) ?? []) {
      if (entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0) {
        visibleImages.add(controller);
        if (controller.imageReadyForWork()) controller.node.dataset.localMediaCensorStatus = 'queued';
      } else {
        visibleImages.delete(controller);
        controller.markWaitingViewport();
      }
    }
  }
  requestImageWork();
}, { threshold: 0 });

function createLookAheadObserver(): IntersectionObserver {
  return new IntersectionObserver(entries => {
    for (const entry of entries) for (const controller of imageTargets.get(entry.target) ?? []) {
      if (entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0) nearbyImages.add(controller);
      else nearbyImages.delete(controller);
    }
    requestImageWork();
  }, { threshold: 0, rootMargin: `0px 0px ${imageLookAheadPx(innerHeight)}px 0px` });
}
let lookAheadObserver = createLookAheadObserver();
window.addEventListener('resize', () => {
  lookAheadObserver.disconnect(); nearbyImages.clear();
  lookAheadObserver = createLookAheadObserver();
  for (const target of imageTargets.keys()) lookAheadObserver.observe(target);
  requestImageWork();
});

function registerImage(controller: MediaController): void {
  const target = controller.viewportNode;
  let group = imageTargets.get(target);
  if (!group) {
    group = new Set(); imageTargets.set(target, group);
    imageObserver.observe(target); lookAheadObserver.observe(target);
  }
  // A new layer on an already observed, visible background shares its visibility.
  if ([...group].some(item => visibleImages.has(item))) visibleImages.add(controller);
  if ([...group].some(item => nearbyImages.has(item))) nearbyImages.add(controller);
  group.add(controller);
}
function unregisterImage(controller: MediaController): void {
  const group = imageTargets.get(controller.viewportNode);
  group?.delete(controller);
  if (!group?.size) {
    imageObserver.unobserve(controller.viewportNode); lookAheadObserver.unobserve(controller.viewportNode);
    imageTargets.delete(controller.viewportNode);
  }
  visibleImages.delete(controller);
  nearbyImages.delete(controller);
  requestImageWork();
}
function requestImageWork(): void {
  if (imagePumpScheduled) return;
  imagePumpScheduled = true;
  queueMicrotask(() => { imagePumpScheduled = false; pumpImages(); });
}
function pumpImages(): void {
  if (document.hidden || activeImageWork >= maxImageWork) return;
  const ready = [...visibleImages].filter(controller => controller.imageReadyForWork())
    .map(controller => ({ controller, rect: controller.viewportNode.getBoundingClientRect() }))
    .filter(item => imageWorkRange(item.rect, innerWidth, innerHeight) === 'visible')
    .sort((a, b) => a.controller.retryPriority() - b.controller.retryPriority() || a.rect.top - b.rect.top || a.rect.left - b.rect.left);
  while (activeImageWork < maxImageWork && ready.length) {
    const next = ready.shift()!.controller;
    activeImageWork++;
    void next.processImage().finally(() => { activeImageWork--; requestImageWork(); });
  }
  // Drain the current screen first. Speculative work uses just one slot so
  // newly visible images can immediately enter the foreground queue.
  if (activeImageWork || loadingAheadImages.size || [...visibleImages].some(controller => controller.imageHasPendingWork() &&
      imageWorkRange(controller.viewportNode.getBoundingClientRect(), innerWidth, innerHeight) === 'visible')) return;
  const ahead = [...nearbyImages].filter(controller => controller.imageReadyForWork() || controller.imageCanLoadAhead())
    .map(controller => ({ controller, rect: controller.viewportNode.getBoundingClientRect() }))
    .filter(item => imageWorkRange(item.rect, innerWidth, innerHeight) === 'ahead')
    .sort((a, b) => a.controller.retryPriority() - b.controller.retryPriority() || a.rect.top - b.rect.top || a.rect.left - b.rect.left)[0];
  if (ahead) {
    if (ahead.controller.imageCanLoadAhead()) { ahead.controller.loadImageAhead(); return; }
    activeImageWork++;
    void ahead.controller.processImage().finally(() => {
      activeImageWork--; requestImageWork();
    });
  }
}
function reconcileVisibleImages(): void {
  if (document.hidden) return;
  let added = false;
  for (const controller of controllers) {
    if (!(controller.node instanceof HTMLImageElement) || !controller.imageHasPendingWork()) continue;
    const rect = controller.viewportNode.getBoundingClientRect();
    const range = imageWorkRange(rect, innerWidth, innerHeight);
    if (range === 'visible' && !visibleImages.has(controller)) {
      visibleImages.add(controller); controller.node.dataset.localMediaCensorStatus = 'queued'; added = true;
    }
    if (range === 'ahead' && !nearbyImages.has(controller)) { nearbyImages.add(controller); added = true; }
  }
  if (added) requestImageWork();
}
window.setInterval(reconcileVisibleImages, 1500);
document.addEventListener('visibilitychange', requestImageWork);

function videoAdmitted(video: HTMLVideoElement): boolean {
  if (video.paused) return true;
  const ranked = [...controllers].map(controller => controller.node)
    .filter((node): node is HTMLVideoElement => node instanceof HTMLVideoElement && node.isConnected && !node.paused)
    .map(node => {
      const rect = node.getBoundingClientRect();
      const visibleWidth = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
      const visibleHeight = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
      const area = visibleWidth * visibleHeight;
      const score = (document.fullscreenElement?.contains(node) ? 1e12 : 0) + (document.activeElement === node ? 1e9 : 0) + area;
      return { node, score, area };
    }).filter(item => item.area > 0).sort((a, b) => b.score - a.score)
    .slice(0, ENGINE.maxActiveVideos);
  return ranked.some(item => item.node === video);
}

function add(node: HTMLImageElement | HTMLVideoElement): void {
  if (!byNode.has(node)) { const controller = new MediaController(node); byNode.set(node, controller); controllers.add(controller); }
  else byNode.get(node)?.sourceChanged();
}
const discovery = new MediaDiscovery(add, node => byNode.get(node)?.dispose(), pendingCss);
const backgrounds = new BackgroundImages(() => protectedSite() && settings.images, (image, surface) => {
  const controller = new MediaController(image, surface);
  controllers.add(controller);
  return controller;
});
document.addEventListener('DOMContentLoaded', () => discovery.inspect(document), { once: true });
for (const eventName of ['popstate', 'hashchange', 'pageshow', 'yt-navigate-finish']) {
  window.addEventListener(eventName, () => {
    for (const controller of controllers) controller.navigationChanged();
    discovery.inspect(document);
  });
}
chrome.storage.onChanged.addListener(changes => {
  if (!changes.settings) return;
  const previous = settings;
  const wasProtected = protectedSite();
  settings = normalizeSettings(changes.settings.newValue);
  backgrounds.refresh();
  if (wasProtected !== protectedSite()) {
    for (const controller of controllers) controller.siteAccessChanged();
    if (protectedSite()) for (const controller of controllers) if (eligible(controller.node))
      prepareEngine(controller.node instanceof HTMLVideoElement ? 'video' : 'image');
    return;
  }
  const faceSettingsChanged = (['imageCoverage', 'imageDetectionGate', 'imageRegionFaceEffect', 'faceAssociationMode', 'automaticGender', 'imageGenderModel', 'videoGenderModel',
    'faceAssociation', 'debugOverlay', 'onnxThreads',
    'yoloImageSize', 'yoloVideoSize', 'videoDetector', 'yunetSize', 'faceCaptureSize', 'performance',
    'faceDetectionConfidence', 'minFaceSizePx', 'genderConfidence', 'smallFaceCutoffPx', 'smallFaceConfidence',
    'faceCoverage', 'faceMargin', 'centerMaskConfidence', 'yoloConfidence'] as const).some(field => previous[field] !== settings[field]);
  const imageSettingsChanged = imageAnalysisKey(previous) !== imageAnalysisKey(settings);
  for (const controller of controllers) {
    if (controller.node instanceof HTMLImageElement ? imageSettingsChanged : faceSettingsChanged) controller.reprocessFaces();
    else void controller.reevaluate();
  }
  if (faceSettingsChanged) for (const controller of controllers) if (eligible(controller.node))
    prepareEngine(controller.node instanceof HTMLVideoElement ? 'video' : 'image');
});
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type === 'get-local-status') {
    const status = { version: chrome.runtime.getManifest().version, media: 0, analyzed: 0, detected: 0, labelled: 0, automatic: 0, male: 0, female: 0, unlabelled: 0 };
    for (const controller of controllers) {
      const visible = controller.visibleStatus();
      if (!visible) continue;
      status.media++;
      status.analyzed += visible.analyzed;
      status.detected += visible.detected;
      status.labelled += visible.labelled;
      status.automatic += visible.automatic;
      status.male += visible.male;
      status.female += visible.female;
      status.unlabelled += visible.unlabelled;
    }
    reply(status);
    return;
  }
  if (message?.type === 'start-label') { labelMode = true; for (const controller of controllers) controller.setLabelMode(true); }
  if (message?.type === 'retry-media') {
    sharedImages.clear();
    for (const controller of controllers) controller.navigationChanged(true);
  }
});
void send<Settings>({ type: 'get-settings' }).then(value => {
  const wasProtected = protectedSite();
  settings = normalizeSettings(value);
  backgrounds.refresh();
  if (wasProtected !== protectedSite()) {
    for (const controller of controllers) controller.siteAccessChanged();
    return;
  }
  for (const controller of controllers) if (eligible(controller.node))
    prepareEngine(controller.node instanceof HTMLVideoElement ? 'video' : 'image');
  for (const controller of controllers) void controller.reevaluate();
}).catch(() => {});
void send<{ host?: string }>({ type: 'get-top-level-host' }).then(response => {
  if (!response.host || response.host === topLevelHost) return;
  const wasProtected = protectedSite();
  topLevelHost = response.host;
  backgrounds.refresh();
  if (wasProtected !== protectedSite()) for (const controller of controllers) controller.siteAccessChanged();
}).catch(() => {});
