// SPDX-License-Identifier: AGPL-3.0-only
import {verifiedImageBlob} from '../media/imageBlob';
import {uniqueId} from '../state/id';
// Copyright (C) 2026 Sitr contributors
import { AnimatedGifSource } from '../media/gif';
import {inspectAnimation} from '../media/animatedImage';
import { GifPlayback } from '../media/gifPlayback';
import { LatestVideoFrame } from '../media/latestVideoFrame';
import { DEFAULT_SETTINGS, ENGINE, normalizeSettings, resolveOnnxThreads, resolvePersonSize, resolveYoloSize, siteIsExcepted, type Label, type Settings } from '../config/settings';
import type { AnalysisResult, FrameKey, FramePacket } from '../state/contracts';
import { captureSquare, decodeImageBlob, sourceIsStatic } from '../media/capture';
import { FrameMotion } from '../media/frameMotionClient';
import {videoMaskNeedsProtection,videoMaskPadding} from '../media/videoMaskFreshness';
import { Overlay } from '../rendering/overlay';
import { imageAnalysisKey } from '../config/imageAnalysis';
import { hasFaceEffects, hasThresholdFaceOpenings } from '../config/personPolicy';
import { BackgroundImages, type BackgroundSurface } from '../media/backgroundImages';
import { SharedImageWork } from '../media/sharedImageWork';
import { imageLookAheadPx, imageWorkRange } from '../media/imageWorkRange';
import { MediaDiscovery } from '../media/mediaDiscovery';
import { recoverVideoCors, videoNeedsCors } from '../media/videoCors';
import { videoHasLiveSource, videoSourceKey } from '../media/videoSource';
import { VideoWork } from '../media/videoWork';

const tag = 'data-local-media-censor-pending';
const pendingCss = `img[${tag}],video[${tag}]{filter:brightness(0)!important}img[${tag}][data-local-media-censor-opacity-shield]{opacity:0!important}`;

let settings: Settings = DEFAULT_SETTINGS;
let topLevelHost: string | undefined;
try { topLevelHost = window.top?.location.hostname.toLowerCase(); }
catch { /* Cross-origin frames ask the background script for the tab host. */ }
let labelMode = false;
let ensuringOffscreen: Promise<void> | undefined;
let preparingEngine: Promise<void> | undefined;
let preparingKey = '';
const controllers = new Set<MediaController>();
const animatedImages=new WeakSet<HTMLImageElement>();
const classifiedStaticImages=new WeakSet<HTMLImageElement>();
const byNode = new WeakMap<HTMLImageElement | HTMLVideoElement, MediaController>();
const meetingPage = location.hostname.toLowerCase() === 'meet.google.com';
const meetingVideoWork = new VideoWork<HTMLVideoElement>(ENGINE.maxActiveVideos);

function protectedSite(): boolean {
  // An exception belongs to the page the user opened, not the host of a
  // third-party iframe. Cross-origin frames remain protected until the tab
  // hostname arrives from the background script.
  return settings.enabled && !(topLevelHost && siteIsExcepted(topLevelHost, settings.siteExceptions));
}
function eligible(node: HTMLImageElement | HTMLVideoElement): boolean {
  return protectedSite() && (node instanceof HTMLImageElement ? animatedImages.has(node) ? settings.videos : settings.images || settings.videos && !classifiedStaticImages.has(node) : settings.videos);
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
  const key = `${threads}:${kind}:${size}:${kind === 'image' ? settings.imageCoverage : `${settings.videoDetector}:${settings.advancedVideoMode}`}`;
  if (preparingEngine && preparingKey === key) return;
  const prior = preparingEngine;
  preparingKey = key;
  preparingEngine = (prior?.catch(() => {}) ?? Promise.resolve()).then(async () => {
    await ensureOffscreen();
    await send({ type: 'prepare-engine', size, kind, detector: kind === 'video' ? settings.videoDetector : 'segment',
      semantic: kind === 'image' || settings.advancedVideoMode,
      faces: (settings.automaticGender && (kind === 'image' ? settings.imageGenderModel : settings.videoGenderModel).startsWith('face')) ||
        settings.faceAssociation || settings.debugOverlay ||
        (kind === 'image' && (['face', 'either', 'both'].includes(settings.imageDetectionGate) ||
          (settings.imageSkinThresholdEnabled && !settings.imageSkinThresholdIncludeFace) ||
          settings.imageCoverage === 'whole-body' ||
          (settings.imageCoverage === 'regions' && (hasFaceEffects(settings) || hasThresholdFaceOpenings(settings))))),
      gender: settings.automaticGender, threads });
  }).catch(() => { preparingEngine = undefined; });
}
async function imageBlob(url: string): Promise<Blob> {
  if (/^(blob:|data:)/.test(url)) return verifiedImageBlob(await (await fetch(url, { signal: AbortSignal.timeout(8000) })).blob());
  // Try the page's network context first, including CORS-enabled CDNs.
  try {
    const sameOrigin = new URL(url, location.href).origin === location.origin;
    const response = await fetch(url, { credentials: sameOrigin ? 'include' : 'omit', mode: 'cors', signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      return await verifiedImageBlob(await response.blob());
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
    (current.imageCoverage === 'regions' && (hasFaceEffects(current) || hasThresholdFaceOpenings(current)))
    ? current.faceCaptureSize : undefined;
  let rgba: Uint8Array | undefined;
  let faceRgba: Uint8Array | undefined;
  try {
    rgba = captureSquare(node, width, height, size);
    faceRgba = faceSize ? captureSquare(node, width, height, faceSize) : undefined;
  } catch { /* Cross-origin media needs the fetched, origin-clean bitmap. */ }
  const blob = await imageBlob(source);
  const gif=await inspectAnimation(blob);
  if(gif&&gif.durations.length>1)throw new AnimatedGifSource(blob,gif);
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
  const key: FrameKey = { mediaSessionId: uniqueId(), epoch: 1, sequence: 1 };
  try {
    await ensureOffscreen();
    const response = await send<{ ok: boolean; result?: AnalysisResult; error?: string }>({ type: 'analyze',
      frame: { key, kind: 'image', acquisitionStartedAtMs, capturedAtMs: Date.now(),
        width: size, height: size, nativeWidth:width,nativeHeight:height,rgba, faceRgba, faceSize } satisfies FramePacket, settings: current });
    if (!response?.ok || !response.result) throw new Error(response?.error || 'not-ready');
    return { blob, key, width, height, timingsMs: response.result.timingsMs };
  } catch (error) {
    void send({ type: 'reset-session', mediaSessionId: key.mediaSessionId, epoch: key.epoch }).catch(() => {});
    throw error;
  }
}

class MediaController {
  private readonly sessionId = uniqueId();
  private epoch = 1;
  private sequence = 0;
  private result?: AnalysisResult;
  private gif?: GifPlayback;
  private source = '';
  private inFlight = false;
  private refreshPending = false;
  private nextCaptureAt = 0;
  private readonly pendingVideoFrame = new LatestVideoFrame();
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
  videoReadyForWork(): boolean {
    return !document.hidden && !this.disposed && !this.inFlight && !this.corsRecovery && !this.labelPending && !this.videoRetryTimer &&
      this.node instanceof HTMLVideoElement && Date.now() >= this.nextCaptureAt &&
      (!this.node.paused || !this.result || this.refreshPending);
  }
  constructor(readonly node: HTMLImageElement | HTMLVideoElement, private background?: BackgroundSurface) {
    node.dataset.localMediaCensorBuild = 'stylesheet-image-shield-4';
    // Preview panels may clone a thumbnail while its extension blackout is set.
    const inherited=node.hasAttribute(tag)&&node.dataset.localMediaCensorOriginalFilter!==undefined;
    this.originalFilter = inherited?node.dataset.localMediaCensorOriginalFilter!:node.style.getPropertyValue('filter');
    this.originalFilterPriority = inherited?(node.dataset.localMediaCensorOriginalFilterPriority??''):node.style.getPropertyPriority('filter');
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
      this.resize = new ResizeObserver(() => {this.overlay?.draw();this.presentImageIfReady();});
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
          if(this.blacked&&this.result&&!this.result.black&&this.motion.canPropagate(this.result,Date.now()))this.holdVideoMaskOrProtect();
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
    // The pending image blackout must also clear sibling fabric/effect canvases.
    // Keep the controller's cached result so visibility recovery can repaint it.
    if (this.node instanceof HTMLImageElement) this.overlay?.clear();
    if (this.background) { this.blacked = true; this.background.protect(); return; }
    this.blacked = true;
    if(this.node instanceof HTMLVideoElement){
      this.node.dataset.localMediaCensorOriginalFilter=this.originalFilter;
      this.node.dataset.localMediaCensorOriginalFilterPriority=this.originalFilterPriority;
      this.node.style.setProperty('filter', 'brightness(0)', 'important');
    }else{
      // Google copies thumbnail inline styles into a separate full-resolution
      // image without copying our ownership attributes. Never put our blackout
      // in an image's inline styles: it could become that preview's permanent filter.
      this.node.toggleAttribute('data-local-media-censor-opacity-shield',!!this.node.style.filter&&this.node.style.getPropertyPriority('filter')==='important');
    }
    this.node.setAttribute(tag, '');
    if (!this.node.dataset.localMediaCensorStatus) this.node.dataset.localMediaCensorStatus = 'pending';
  }
  private reveal(): void {
    this.blacked = false;
    if (this.background) { if (!eligible(this.node)) this.background.release(); return; }
    this.node.removeAttribute(tag);
    delete this.node.dataset.localMediaCensorOriginalFilter;delete this.node.dataset.localMediaCensorOriginalFilterPriority;
    this.node.removeAttribute('data-local-media-censor-opacity-shield');
    if(this.node instanceof HTMLVideoElement){
      if (this.originalFilter) this.node.style.setProperty('filter', this.originalFilter, this.originalFilterPriority);
      else this.node.style.removeProperty('filter');
    }
  }
  private holdVideoMaskOrProtect(): void {
    if (this.node instanceof HTMLVideoElement && settings.videoPlayback === 'smooth' && this.result && !this.result.black &&
        !videoMaskNeedsProtection(this.result,Date.now(),this.node.currentTime,!!this.motion?.canPropagate(this.result,Date.now()),!!this.motion?.trackingLost(this.result),settings.videoPlayback)) {
      this.node.dataset.localMediaCensorStatus = 'propagated';
      this.overlay?.setMotion(this.motion?.offsets() ?? new Map());
      if (this.blacked&&this.overlay?.drawNow()) this.reveal();
      return;
    }
    if (this.node instanceof HTMLVideoElement && this.result && !this.result.black && this.motion?.canPropagate(this.result, Date.now())) {
      this.node.dataset.localMediaCensorStatus = 'propagated';
      this.overlay?.setMotion(this.motion.offsets());
      if (this.blacked&&this.overlay?.drawNow()) this.reveal();
    } else this.protect();
  }
  private currentSource(): string { return this.node instanceof HTMLImageElement ? this.node.currentSrc || this.node.src : videoSourceKey(this.node); }
  private syncVideoSource(): void {
    if (!(this.node instanceof HTMLVideoElement)) return;
    const source = this.currentSource();
    if (source !== this.source) { this.source = source; this.reset('source-change', false); }
  }
  private key(): FrameKey { return { mediaSessionId: this.sessionId, epoch: this.epoch, sequence: ++this.sequence }; }
  private reset(reason = 'state-change', capture = true): void {
    this.gif?.dispose();this.gif=undefined;
    if(this.node instanceof HTMLImageElement){animatedImages.delete(this.node);classifiedStaticImages.delete(this.node);}
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
    this.nextCaptureAt = 0;
    this.pendingVideoFrame.clear();
    this.result = undefined;
    this.motion?.reset();
    this.overlay?.clear();
    if (this.inFlight) this.refreshPending = true;
    this.protect();
    void send({ type: 'reset-session', mediaSessionId: this.sessionId, epoch: priorEpoch }).catch(() => {});
    if (capture && this.node instanceof HTMLVideoElement && this.node.readyState >= 2) void this.captureVideo();
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
      if(this.gif){this.gif.update();return;}
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
    if(this.gif){this.gif.update(true);return;}
    this.reset();
    if (this.node instanceof HTMLImageElement) requestImageWork();
    else if (!this.node.paused) this.startVideo();
  }
  private async dispatch(packet: FramePacket): Promise<void> {
    this.inFlight = true;
    try {
      await ensureOffscreen();
      const response = await send<{ ok: boolean; result?: AnalysisResult; error?: string }>({ type: 'analyze', frame: packet, settings });
      this.syncVideoSource();
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
    finally {
      this.inFlight = false; this.maybeRefresh();
      const next = this.pendingVideoFrame.take(this.sessionId, this.epoch, Date.now());
      if (next && !this.inFlight && !this.disposed && !this.labelPending && !this.corsRecovery &&
          !document.hidden && this.node instanceof HTMLVideoElement && !this.node.paused && videoHasLiveSource(this.node) && eligible(this.node) && videoAdmitted(this.node))
        void this.dispatch(next);
    }
  }
  private accept(result: AnalysisResult): void {
    this.syncVideoSource();
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
    if (result.bodyRegionDiagnostics) this.node.dataset.localMediaCensorBodyRegions = JSON.stringify(result.bodyRegionDiagnostics);
    else delete this.node.dataset.localMediaCensorBodyRegions;
    const lateVideo = this.node instanceof HTMLVideoElement && !this.node.paused &&
      (Date.now() - result.capturedAtMs > ENGINE.maxResultAgeMs ||
        (result.mediaTimeSec !== undefined && Math.abs(this.node.currentTime - result.mediaTimeSec) > ENGINE.maxResultAgeMs / 1000));
    if (this.node instanceof HTMLVideoElement&&!this.node.paused&&videoMaskNeedsProtection(result,Date.now(),this.node.currentTime,!!this.motion?.canPropagate(result,Date.now()),!!this.motion?.trackingLost(result),settings.videoPlayback)) {
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
  presentImageIfReady():void{
    if(this.node instanceof HTMLImageElement&&!this.gif&&this.blacked&&this.result&&!this.result.black&&
      this.result.settingsRevision===settings.revision&&this.currentSource()===this.source&&
      imageWorkRange(this.viewportNode.getBoundingClientRect(),innerWidth,innerHeight)==='visible')this.accept(this.result);
  }
  imageReadyForWork(): boolean {
    return this.node instanceof HTMLImageElement && !this.gif && this.viewportNode.isConnected && !this.disposed && !this.inFlight && !this.imageBlocked && !this.imageRetryTimer &&
      eligible(this.node) && this.node.complete && this.node.naturalWidth > 0 && !!this.currentSource() &&
      (!this.result || this.result.settingsRevision < settings.revision);
  }
  imageHasPendingWork(): boolean {
    return this.node instanceof HTMLImageElement && !this.gif && this.viewportNode.isConnected && !this.disposed && !this.imageBlocked &&
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
  animationActive():boolean{return this.gif?.isPlaying()??false;}
  private activateGif(source:AnimatedGifSource):void{
    if(!(this.node instanceof HTMLImageElement))return;
    animatedImages.add(this.node);classifiedStaticImages.delete(this.node);this.overlay?.dispose();this.overlay=undefined;this.result=undefined;
    this.gif?.dispose();this.gif=new GifPlayback(this.node,source.blob,source.info,{
      background:this.background,target:this.viewportNode,settings:()=>settings,enabled:()=>protectedSite()&&settings.videos,admitted:()=>videoAdmitted(this.node),
      analyze:async(frame,current)=>{await ensureOffscreen();const response=await send<{ok:boolean;result?:AnalysisResult;error?:string}>({type:'analyze',frame,settings:current});if(!response.ok||!response.result)throw Error(response.error??'GIF analysis unavailable');return response.result;},
      reset:(id,epoch)=>{void send({type:'reset-session',mediaSessionId:id,epoch}).catch(()=>{});},protect:()=>this.protect(),release:()=>this.reveal(),
    });prepareEngine('video');
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
      if(!current.images){
        const blob=await imageBlob(source),info=await inspectAnimation(blob);
        if(this.epoch!==captureEpoch||this.disposed)return;
        if(info&&info.durations.length>1){this.activateGif(new AnimatedGifSource(blob,info));return;}
        classifiedStaticImages.add(this.node);this.node.dataset.localMediaCensorKind=info&&info.type!=='image/webp'?'gif-image':'image';this.reveal();return;
      }
      const work = sharedImages.get(sharedKey, () => analyzeImageSource(this.node as HTMLImageElement, source, current));
      this.node.dataset.localMediaCensorImageReuse = String(work.reused);
      const shared = await work.promise;
      if (!imageWorkRange(this.viewportNode.getBoundingClientRect(), innerWidth, innerHeight) ||
          this.currentSource() !== source || this.epoch !== captureEpoch || this.disposed ||
          imageAnalysisKey(settings) !== imageAnalysisKey(current)) return;
      const aspectDifference = Math.abs(shared.width * this.node.naturalHeight - shared.height * this.node.naturalWidth);
      if (aspectDifference > Math.max(shared.width, shared.height)) throw new Error('Fetched image differs in aspect ratio');
      classifiedStaticImages.add(this.node);
      this.node.dataset.localMediaCensorKind=shared.blob.type.split(';')[0]==='image/gif'?'gif-image':'image';
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
      if(error instanceof AnimatedGifSource){this.activateGif(error);return;}
      const message = error instanceof Error ? error.message : 'image-error';
      this.node.dataset.localMediaCensorStatus = message;
      if (message === 'Animated or unverified image' || message === 'Fetched image differs in aspect ratio') this.imageBlocked = true;
      else this.retryImage(this.epoch);
      this.protect();
    }
    finally { this.inFlight = false; this.maybeRefresh(); }
  }
  private startVideo(): void {
    if (document.hidden || !(this.node instanceof HTMLVideoElement) || this.frameCallback) return;
    const video = this.node;
    const loop = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      this.frameCallback = 0;
      if (document.hidden || this.disposed || video.paused || !eligible(video)) return;
      this.syncVideoSource();
      if (!videoAdmitted(video)) { video.dataset.localMediaCensorStatus = 'capacity'; this.protect(); }
      else if (!this.corsRecovery) {
        const motion = this.ensureMotion();
        const motionStarted = performance.now();
        motion?.observe(video, Date.now());
        if (motion?.error) video.dataset.localMediaCensorMotionError = motion.error;
        video.dataset.localMediaCensorMotionMs = String(Math.round((performance.now() - motionStarted) * 10) / 10);
        // Commit in this presentation callback, not the next animation frame.
        if(this.result)this.overlay?.setVideoPadding(settings.videoPlayback==='smooth'
          ?videoMaskPadding(this.result,Date.now(),metadata.mediaTime,!!motion?.canPropagate(this.result,Date.now()),!!motion?.trackingLost(this.result)):0);
        this.overlay?.setMotion(motion?.offsets() ?? new Map(),true);
        if(this.result&&!this.result.black){
          if(videoMaskNeedsProtection(this.result,Date.now(),metadata.mediaTime,!!motion?.canPropagate(this.result,Date.now()),!!motion?.trackingLost(this.result),settings.videoPlayback)){
            video.dataset.localMediaCensorStatus='stale';this.protect();
          }else if(this.blacked&&this.overlay?.drawNow())this.reveal();
        }
        if (Date.now() >= this.nextCaptureAt && (!this.inFlight || !meetingPage)) void this.captureVideo(metadata.mediaTime);
      }
      this.frameCallback = video.requestVideoFrameCallback(loop);
    };
    this.frameCallback = video.requestVideoFrameCallback(loop);
  }
  private async captureVideo(mediaTime?: number): Promise<void> {
    this.syncVideoSource();
    if (document.hidden || !eligible(this.node) || !(this.node instanceof HTMLVideoElement) || (this.inFlight && meetingPage) || this.corsRecovery || this.labelPending || this.node.readyState < 2) return;
    if (!videoHasLiveSource(this.node)) { this.protect(); return; }
    if (!videoAdmitted(this.node)) { this.node.dataset.localMediaCensorStatus = 'capacity'; this.protect(); return; }
    const video = this.node;
    const release = meetingPage ? meetingVideoWork.acquire(video, visibleMeetingVideos().filter(node => byNode.get(node)?.videoReadyForWork())) : undefined;
    if (meetingPage && !release) {
      video.dataset.localMediaCensorStatus = 'queued'; this.holdVideoMaskOrProtect(); return;
    }
    // One request stays in flight per video. Advanced masks should follow the
    // source as quickly as inference allows, rather than inherit the 4–8 Hz
    // whole-person sampling budget. Never build a backlog of obsolete frames.
    this.nextCaptureAt = settings.performance === 'performance' && !settings.advancedVideoMode ? Date.now() + 60 : 0;
    try {
      // Some decoders initially return a blank frame before reporting taint.
      // Do not accept that as an analyzed, safe cross-origin video.
      if (videoNeedsCors(video)) throw new DOMException('Cross-origin video needs CORS for frame capture', 'SecurityError');
      const captureStarted = performance.now();
      const size = resolvePersonSize(settings, 'video');
      const rgba = captureSquare(video, video.videoWidth, video.videoHeight, size);
      video.dataset.localMediaCensorCaptureAccess = video.crossOrigin === null ? 'direct' : 'cors';
      const faceRgba = (settings.automaticGender && settings.videoGenderModel.startsWith('face') &&
        Date.now() >= (this.result?.nextFaceCheckAtMs ?? 0)) ||
        settings.faceAssociation || settings.debugOverlay
        ? captureSquare(video, video.videoWidth, video.videoHeight, settings.faceCaptureSize) : undefined;
      const key = this.key();
      video.dataset.localMediaCensorCaptureSequence = String(key.sequence);
      video.dataset.localMediaCensorCaptureMs = String(Math.round(performance.now() - captureStarted));
      const packet: FramePacket = { key, kind: 'video', mediaTimeSec: mediaTime ?? video.currentTime,
        paused: video.paused,
        capturedAtMs: Date.now(), width: size, height: size, rgba, faceRgba, faceSize: faceRgba ? settings.faceCaptureSize : undefined,
        motionTracks: this.motion?.predictedTracks() };
      if (this.inFlight) this.pendingVideoFrame.offer(packet);
      else await this.dispatch(packet);
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
    } finally { release?.(); }
  }
  private checkFreshness(): void {
    if (this.disposed || !this.node.isConnected) { this.dispose(); return; }
    if (document.hidden) return;
    if (!eligible(this.node)) { this.overlay?.clear(); if (this.blacked) this.reveal(); return; }
    this.syncVideoSource();
    if (this.node instanceof HTMLVideoElement && !videoHasLiveSource(this.node)) {
      this.overlay?.clear(); this.protect(); this.node.dataset.localMediaCensorStatus = 'stream-ended'; return;
    }
    // Screen sharing can stop delivering frames while its contents are static.
    // Polling also catches property-only source switches while paused/stalled.
    if (this.node instanceof HTMLVideoElement && (meetingPage || !this.result) && this.videoReadyForWork() &&
        this.node.readyState >= 2) void this.captureVideo();
    if (this.blacked && (!this.node.hasAttribute(tag) || getComputedStyle(this.node).filter !== 'brightness(0)')) this.protect();
    if (!(this.node instanceof HTMLVideoElement) || this.node.paused) return;
    if (!this.result) {
      if (!this.corsRecovery) this.node.dataset.localMediaCensorStatus = this.node.dataset.localMediaCensorCaptureAccess === 'unreadable' ? 'video-capture-unavailable' : 'stale';
      this.protect(); return;
    }
    if (videoMaskNeedsProtection(this.result,Date.now(),this.node.currentTime,!!this.motion?.canPropagate(this.result,Date.now()),!!this.motion?.trackingLost(this.result),settings.videoPlayback)) {
      this.node.dataset.localMediaCensorStatus = 'stale';
      this.protect();
    }
  }

  visibilityChanged(): void {
    if (this.disposed) return;
    if(this.gif){this.gif.update();return;}
    if (this.node instanceof HTMLVideoElement) {
      if (this.frameCallback) this.node.cancelVideoFrameCallback(this.frameCallback);
      this.frameCallback = 0;
      this.pendingVideoFrame.clear();
      this.motion?.reset();
      this.nextCaptureAt = 0;
    }
    if (document.hidden || !eligible(this.node)) return;
    if (this.node instanceof HTMLImageElement) {
      // A hidden-tab result can be valid even if its canvas could not be painted.
      // Re-present it through accept(), which also releases the pending blackout.
      if (this.result) this.accept(this.result);
      if (this.imageRetryTimer) { clearTimeout(this.imageRetryTimer); this.imageRetryTimer = 0; }
      if (this.node.complete && this.node.naturalWidth > 0 && this.node.dataset.localMediaCensorStatus === 'image-load-error') this.imageBlocked = false;
      this.sourceChanged();
    } else {
      // Cancel/resubscribe even if a pre-hide callback handle never fired again.
      // Keep identities and settled work; only refresh the current video frame.
      this.refreshPending = true;
      this.sourceChanged();
      this.maybeRefresh();
    }
  }
  private fullscreenChanged(): void {
    if (this.node instanceof HTMLVideoElement && document.fullscreenElement === this.node) {
      this.node.pause(); this.protect();
    }
    this.overlay?.draw();
  }
  async reevaluate(): Promise<void> {
    if(this.gif){this.gif.update(true);return;}
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
    if(this.gif){this.gif.update(true);return;}
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
    const current=this.gif?.getResult()??this.result;
    const tracks = current?.tracks ?? [];
    const labelled = tracks.filter(track => track.labelUsable && track.label !== 'unknown').length;
    const automatic = tracks.filter(track => track.labelUsable && track.labelSource === 'automatic').length;
    const male = tracks.filter(track => track.labelUsable && track.label === 'male').length;
    const female = tracks.filter(track => track.labelUsable && track.label === 'female').length;
    return { analyzed: Number(Boolean(current)), detected: tracks.length, labelled, automatic, male, female, unlabelled: tracks.length - labelled };
  }
  dispose(): void {
    this.gif?.dispose();
    if(this.node instanceof HTMLImageElement){animatedImages.delete(this.node);classifiedStaticImages.delete(this.node);}
    this.pendingVideoFrame.clear();
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
        visibleImages.add(controller);controller.presentImageIfReady();
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
    controller.presentImageIfReady();
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

function videoAdmitted(video: HTMLVideoElement | HTMLImageElement): boolean {
  if(document.hidden)return false;
  if (meetingPage && video instanceof HTMLVideoElement) return visibleMeetingVideos().includes(video);
  if (video instanceof HTMLVideoElement && video.paused) return true;
  const ranked = [...controllers]
    .filter(controller => controller.viewportNode.isConnected && eligible(controller.node) &&
      (controller.node instanceof HTMLVideoElement ? !controller.node.paused : controller.animationActive()))
    .map(controller => {
      const node=controller.node,rect = controller.viewportNode.getBoundingClientRect();
      const visibleWidth = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
      const visibleHeight = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
      const area = visibleWidth * visibleHeight;
      const score = (document.fullscreenElement?.contains(node) ? 1e12 : 0) + (document.activeElement === node ? 1e9 : 0) + area;
      return { node, score, area };
    }).filter(item => item.area > 0).sort((a, b) => b.score - a.score)
    .slice(0, ENGINE.maxActiveVideos);
  return ranked.some(item => item.node === video);
}

function visibleMeetingVideos(): HTMLVideoElement[] {
  if (document.hidden) return [];
  return [...controllers].map(controller => controller.node)
    .filter((node): node is HTMLVideoElement => node instanceof HTMLVideoElement && node.isConnected &&
      eligible(node) && node.readyState >= 2 && videoHasLiveSource(node) && node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
    .filter(node => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
    });
}

function add(node: HTMLImageElement | HTMLVideoElement): void {
  if (!byNode.has(node)) { const controller = new MediaController(node); byNode.set(node, controller); controllers.add(controller); }
  else byNode.get(node)?.sourceChanged();
}
const discovery = new MediaDiscovery(add, node => byNode.get(node)?.dispose(), pendingCss);
const backgrounds = new BackgroundImages(() => protectedSite() && (settings.images || settings.videos), (image, surface) => {
  const controller = new MediaController(image, surface);
  controllers.add(controller);
  return controller;
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    for (const controller of controllers) controller.visibilityChanged();
    return;
  }
  // Validate the host again after browser backgrounding/discard pressure.
  ensuringOffscreen = undefined; preparingKey = '';
  discovery.inspect(document); backgrounds.refresh();
  for (const controller of controllers) controller.visibilityChanged();
  reconcileVisibleImages(); requestImageWork();
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
    'yoloImageSize', 'yoloVideoSize', 'videoDetector', 'advancedVideoMode', 'yunetSize', 'faceCaptureSize', 'performance',
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
