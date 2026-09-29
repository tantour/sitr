/// <reference lib="webworker" />
import { ENGINE, resolveYoloSize, type Settings, type Label } from '../config/settings';
import type { AnalysisResult, FramePacket, FrameKey, Track, WorkerInput, WorkerOutput } from '../state/contracts';
import type { YoloPersonSegmenter } from '../vision/person';
import type { AppearanceGenderClassifier } from '../vision/gender';
import type { GenderEstimate } from '../vision/gender';
import { SelfieSemanticSegmenter, type FaceBox } from '../vision/semantic';
import { SemanticClient } from '../vision/semanticClient';
import type { OptionalFaceDetector } from '../vision/face';
import { associateFaces, type FaceAssociation } from '../vision/faceAssociation';
import { ByteTracker } from '../vision/tracker';
import { compose, dilate, pruneIslands, type Composition } from '../rendering/compositor';
import { personSelected, selectedMask } from '../rules/evaluate';

type Session = { epoch: number; tracker: ByteTracker; lastTouched: number; lastBytes: number; lastFaceAt: number; kind?: 'image' | 'video'; genderDiagnostics?: AnalysisResult['genderDiagnostics']; last?: { frame: FramePacket; tracks: Track[]; categories: Uint8Array; composition: Composition; faceAssociations?: FaceAssociation[]; detectedFaces?: FaceBox[] } };
const sessions = new Map<string, Session>();
type CachedImage = { key: string; rgba: Uint8Array; faceRgba?: Uint8Array; detections: Awaited<ReturnType<YoloPersonSegmenter['segment']>>;
  categories: Uint8Array; faces?: FaceBox[]; gender?: GenderEstimate[]; genderReady: boolean; bytes: number };
const imageCache = new Map<string, CachedImage>();
let cacheBytes = 0;
const memoryBudget = 64 * 1024 * 1024;
const personModels = new Map<number, { model: YoloPersonSegmenter; lastUsed: number }>();
let personConstructor: typeof YoloPersonSegmenter | undefined;
let genderConstructor: typeof AppearanceGenderClassifier | undefined;
let faceConstructor: typeof OptionalFaceDetector | undefined;
let genderModel: AppearanceGenderClassifier | undefined;
let genderUnavailable = false;
let semantic: SelfieSemanticSegmenter | undefined;
let semanticClient: SemanticClient | undefined;
let faces: OptionalFaceDetector | undefined;
let faceModelSize = 320;
let semanticPreference: 'auto' | 'cpu' = 'auto';
let onnxPreference: 'wasm' | 'webgpu' = 'wasm';
let onnxThreads: number | undefined;
let parallelSemantic = false;
let settings: Settings | undefined;
let warming: Promise<void> | undefined;

function send(output: WorkerOutput): void {
  if (output.type !== 'result') { postMessage(output); return; }
  const result = output.result;
  const transfers: Transferable[] = [result.rgbaMask.buffer];
  if (result.staticMask) transfers.push(result.staticMask.buffer);
  for (const mask of result.trackMasks ?? []) transfers.push(mask.alpha.buffer);
  for (const item of result.debugPersonMasks ?? []) transfers.push(item.mask.buffer);
  postMessage(output, transfers);
}
function getSession(key: FrameKey): Session {
  const prior = sessions.get(key.mediaSessionId);
  if (prior && prior.epoch === key.epoch) { prior.lastTouched = Date.now(); return prior; }
  prior?.tracker.reset();
  const session: Session = { epoch: key.epoch, tracker: new ByteTracker(key.mediaSessionId), lastTouched: Date.now(), lastBytes: 0, lastFaceAt: -Infinity };
  sessions.set(key.mediaSessionId, session);
  return session;
}
function sampledHash(bytes: Uint8Array, seed: number): number {
  let hash = seed;
  for (let i = 0; i < bytes.length; i += 32) hash = Math.imul(hash ^ bytes[i], 16777619);
  return Math.imul(hash ^ bytes.length ^ bytes[bytes.length - 1], 16777619) >>> 0;
}
function sameBytes(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function imageCacheKey(frame: FramePacket, revision: number, confidence: number): string {
  const main = sampledHash(frame.rgba, 2166136261);
  const face = frame.faceRgba ? sampledHash(frame.faceRgba, main) : 0;
  return `${frame.width}:${frame.faceSize ?? 0}:${revision}:${confidence}:${main}:${face}`;
}
function cachedImage(frame: FramePacket, revision: number, confidence: number): CachedImage | undefined {
  if (frame.kind !== 'image') return;
  const key = imageCacheKey(frame, revision, confidence);
  const entry = imageCache.get(key);
  if (!entry || !sameBytes(entry.rgba, frame.rgba) || !sameBytes(entry.faceRgba, frame.faceRgba)) return;
  imageCache.delete(key);
  imageCache.set(key, entry);
  return entry;
}
function keepImage(entry: CachedImage): void {
  const old = imageCache.get(entry.key);
  if (old) cacheBytes -= old.bytes;
  imageCache.delete(entry.key);
  imageCache.set(entry.key, entry);
  cacheBytes += entry.bytes;
}
function trimSessions(keepId: string): void {
  let total = cacheBytes + [...sessions.values()].reduce((sum, session) => sum + session.lastBytes, 0);
  while (total > memoryBudget && imageCache.size) {
    const oldestKey = imageCache.keys().next().value as string;
    const oldest = imageCache.get(oldestKey)!;
    imageCache.delete(oldestKey);
    cacheBytes -= oldest.bytes;
    total -= oldest.bytes;
  }
  if (total <= memoryBudget) return;
  const candidates = [...sessions.entries()].filter(([id]) => id !== keepId)
    .sort((a, b) => Number(a[1].kind === 'video') - Number(b[1].kind === 'video') || a[1].lastTouched - b[1].lastTouched);
  for (const [id, session] of candidates) {
    if (total <= memoryBudget) break;
    total -= session.lastBytes;
    session.tracker.reset();
    sessions.delete(id);
  }
}
async function ensureModels(size: number): Promise<YoloPersonSegmenter> {
  const prepareSemantic = async () => {
    if (semanticClient || semantic) return;
    if (parallelSemantic) {
      const client = new SemanticClient();
      try { await client.initialize(semanticPreference); semanticClient = client; return; }
      catch { /* A local semantic model preserves analysis if a nested worker is unavailable. */ }
    }
    {
      const instance = new SelfieSemanticSegmenter(semanticPreference === 'auto');
      await instance.initialize();
      semantic = instance;
    }
  };
  const semanticReady = prepareSemantic();
  const prior = personModels.get(size);
  if (prior) { prior.lastUsed = Date.now(); await semanticReady; return prior.model; }
  if (!personConstructor) {
    const path = `${self.location.origin}/person-runtime.js`;
    const runtime = await import(/* @vite-ignore */ path) as typeof import('../vision/personRuntime');
    personConstructor = runtime.YoloPersonSegmenter;
    genderConstructor = runtime.AppearanceGenderClassifier;
    faceConstructor = runtime.OptionalFaceDetector;
  }
  if (!personConstructor) throw new Error('Person runtime unavailable');
  if (personModels.size >= 2) {
    const oldest = [...personModels.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    personModels.delete(oldest[0]);
    await oldest[1].model.dispose();
  }
  const model = new personConstructor(size, onnxPreference, onnxThreads);
  await model.initialize();
  personModels.set(size, { model, lastUsed: Date.now() });
  await semanticReady;
  return model;
}
function render(frame: FramePacket, session: Session, composition: Composition): AnalysisResult {
  if (!settings) throw new Error('Settings unavailable');
  const size = frame.width;
  const now = Date.now();
  const { observations, unassignedMask, unassignedForeground } = composition;
  const unreliable = observations.some(o => o.state !== 'lost' && personSelected(o, settings!) && !o.exposure.reliable);
  const unassigned = unassignedForeground > Math.max(64, size * size * 0.005);
  let reason = unreliable ? 'uncertain-person' : unassigned ? 'unassigned-region' : 'protected';
  const alpha = new Uint8Array(size * size);
  const staticMask = dilate(pruneIslands(unassignedMask, size, size), size, size, 1);
  alpha.set(staticMask);
  const trackMasks: Array<{ id: string; alpha: Uint8Array }> = [];
  for (let t = 0; t < observations.length; t++) {
    const observation = observations[t];
    if (!personSelected(observation, settings)) continue;
    const part = selectedMask(observation, settings);
    const ambiguousPart = composition.ambiguousByTrack[t];
    const uncertainPart = composition.uncertainByTrack[t];
    for (let i = 0; i < part.length; i++) if (ambiguousPart[i] || uncertainPart[i]) part[i] = 255;
    const expanded = dilate(pruneIslands(part, size, size), size, size, 1);
    if (frame.kind === 'video') trackMasks.push({ id: observation.id, alpha: expanded });
    for (let i = 0; i < alpha.length; i++) if (expanded[i]) alpha[i] = 255;
  }
  if (settings.filter === 'off' && !unreliable && !unassigned) reason = 'off';
  const rgbaMask = new Uint8Array(size * size * 4);
  for (let i = 0; i < alpha.length; i++) rgbaMask[i * 4 + 3] = alpha[i];
  return {
    key: frame.key, width: size, height: size, mediaTimeSec: frame.mediaTimeSec,
    acquisitionStartedAtMs: frame.acquisitionStartedAtMs,
    capturedAtMs: frame.capturedAtMs, analyzedAtMs: now, settingsRevision: settings.revision,
    black: false, reason, rgbaMask,
    staticMask: frame.kind === 'video' ? staticMask : undefined,
    trackMasks: frame.kind === 'video' ? trackMasks : undefined,
    tracks: observations.map(o => {
      const track = session.last?.tracks.find(candidate => candidate.id === o.id);
      return { id: o.id, box: o.box, label: o.label, labelUsable: o.labelUsable,
        labelSource: track?.labelSource ?? 'none', genderConfidence: track?.genderConfidence ?? 0, exposure: o.exposure };
    }),
    faceAssociations: settings.faceAssociation ? session.last?.faceAssociations : undefined,
    debugPersonMasks: settings.debugOverlay ? session.last?.tracks.map(track => {
      const width = 128, height = 128, mask = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const sx = Math.min(track.maskWidth - 1, Math.floor((x + 0.5) * track.maskWidth / width));
        const sy = Math.min(track.maskHeight - 1, Math.floor((y + 0.5) * track.maskHeight / height));
        mask[y * width + x] = track.mask[sy * track.maskWidth + sx] >= 0.65 ? 255 : 0;
      }
      return { id: track.id, box: track.box, mask, width, height, label: track.label, labelUsable: track.labelUsable,
        labelSource: track.labelSource, genderConfidence: track.genderConfidence };
    }) : undefined,
    debugFaces: settings.debugOverlay ? session.last?.detectedFaces?.map((face, index) => {
      const association = session.last?.faceAssociations?.[index];
      return { box: face.box, score: face.score, trackId: association?.trackId, ambiguous: association?.ambiguous ?? true };
    }) : undefined,
    genderDiagnostics: session.genderDiagnostics,
  };
}

async function analyze(frame: FramePacket): Promise<void> {
  await warming;
  if (!settings) throw new Error('Settings unavailable');
  const started = performance.now();
  const side = resolveYoloSize(settings, frame.kind);
  if (frame.width !== side || frame.height !== side || frame.rgba.length !== side * side * 4 || frame.rgba.byteLength > ENGINE.maxPayloadBytes) throw new Error('Invalid frame dimensions');
  const reused = cachedImage(frame, settings.revision, settings.yoloConfidence);
  const person = reused ? undefined : await ensureModels(side);
  const modelInit = performance.now() - started;
  let personMs = 0, semanticMs = 0, faceMs = 0, genderMs = 0;
  let semanticStages = { preprocess: 0, run: 0, decode: 0 };
  let faceStages = { preprocess: 0, run: 0, decode: 0 };
  let genderStages = { preprocess: 0, run: 0, decode: 0 };
  const personTask = (async () => {
    if (reused) return reused.detections;
    const at = performance.now();
    const detections = await person!.segment(frame.rgba, settings.yoloConfidence);
    personMs = performance.now() - at;
    return detections;
  })();
  const semanticTask = (async () => {
    if (reused) return reused.categories;
    const at = performance.now();
    try {
      const categories = semanticClient ? await semanticClient.segment(frame.rgba, side) : semantic!.segment(frame.rgba, side);
      semanticMs = performance.now() - at;
      if (semantic) semanticStages = semantic.getLastTimings();
      return categories;
    } catch (error) {
      const failure = new Error(error instanceof Error ? error.message : String(error)) as Error & { stage: 'semantic' };
      failure.stage = 'semantic';
      throw failure;
    }
  })();
  const [detections, categories] = await Promise.all([personTask, semanticTask]);
  const cacheEntry: CachedImage | undefined = frame.kind === 'image' ? reused ?? {
    key: imageCacheKey(frame, settings.revision, settings.yoloConfidence), rgba: frame.rgba,
    faceRgba: frame.faceRgba, detections, categories, genderReady: false,
    bytes: frame.rgba.byteLength + (frame.faceRgba?.byteLength ?? 0) + categories.byteLength +
      detections.reduce((sum, detection) => sum + detection.mask.byteLength, 0),
  } : undefined;
  const trackingAt = performance.now();
  const session = getSession(frame.key);
  const tracks = session.tracker.update(detections, Date.now(), frame.kind === 'image');
  const trackingMs = performance.now() - trackingAt;
  let faceAssociations: FaceAssociation[] | undefined;
  let detectedFaces: FaceBox[] | undefined;
  const needsFaces = settings.faceAssociation || settings.automaticGender || settings.debugOverlay;
  if (needsFaces && (tracks.length > 0 || settings.debugOverlay) &&
      (frame.kind === 'image' || (frame.faceRgba && Date.now() - session.lastFaceAt >= 650))) {
    const faceAt = performance.now();
    session.lastFaceAt = Date.now();
    const faceRgba = frame.faceRgba ?? frame.rgba;
    const faceSide = frame.faceSize ?? side;
    const diagnostics = { people: tracks.length, faces: 0, associated: 0, attempted: 0, accepted: 0, error: undefined as string | undefined };
    session.genderDiagnostics = diagnostics;
    try {
      if (faces && faceModelSize !== settings.yunetSize) { await faces.dispose(); faces = undefined; }
      if (!faces) {
        if (!faceConstructor) throw new Error('Face runtime unavailable');
        const detector = new faceConstructor(onnxPreference, onnxThreads, settings.yunetSize);
        await detector.initialize();
        faces = detector;
        faceModelSize = settings.yunetSize;
      }
      const currentFaces = (cacheEntry?.faces ?? await faces.detect(faceRgba, faceSide))
        .filter(face => face.score >= settings!.faceDetectionConfidence && face.box.width * ENGINE.faceInput >= settings!.minFaceSizePx);
      if (!cacheEntry?.faces) faceStages = faces.getLastTimings();
      if (cacheEntry) cacheEntry.faces = currentFaces;
      detectedFaces = currentFaces;
      diagnostics.faces = currentFaces.length;
      faceAssociations = associateFaces(currentFaces, tracks, side, settings.faceAssociationMode, {
        coverage: settings.faceCoverage, margin: settings.faceMargin, centerMaskConfidence: settings.centerMaskConfidence,
      });
      diagnostics.associated = faceAssociations.filter(item => item.trackId && !item.ambiguous).length;
      if (settings.automaticGender && !genderUnavailable) {
        const genderAt = performance.now();
        const eligible = faceAssociations.filter(item => item.trackId && !item.ambiguous &&
          currentFaces[item.faceIndex].score >= settings!.faceDetectionConfidence && currentFaces[item.faceIndex].box.width * ENGINE.faceInput >= settings!.minFaceSizePx);
        diagnostics.attempted = eligible.length;
        if (eligible.length) {
          if (!genderModel) {
            if (!genderConstructor) throw new Error('Gender runtime unavailable');
            const classifier = new genderConstructor(onnxPreference, onnxThreads);
            await classifier.initialize();
            genderModel = classifier;
          }
          const estimates = cacheEntry?.genderReady && cacheEntry.gender
            ? eligible.map(item => cacheEntry.gender![item.faceIndex])
            : await genderModel.classify(faceRgba, faceSide, eligible.map(item => currentFaces[item.faceIndex].box));
          if (!cacheEntry?.genderReady) genderStages = genderModel.getLastTimings();
          if (cacheEntry) {
            cacheEntry.gender = Array.from({ length: currentFaces.length });
            for (const [index, association] of eligible.entries()) cacheEntry.gender[association.faceIndex] = estimates[index];
            cacheEntry.genderReady = true;
          }
          for (const [index, association] of eligible.entries()) {
            const estimate = estimates[index];
            const width = currentFaces[association.faceIndex].box.width * ENGINE.faceInput;
            const minimumConfidence = width < settings.smallFaceCutoffPx ? settings.smallFaceConfidence : settings.genderConfidence;
            if (estimate && association.trackId && estimate.confidence >= minimumConfidence &&
              session.tracker.estimateGender(association.trackId, estimate.label, estimate.confidence, frame.kind === 'image', minimumConfidence)) diagnostics.accepted++;
          }
        }
        genderMs = performance.now() - genderAt;
      }
    } catch (error) {
      // A failed attribute model must not turn an unclassified person into an exemption.
      genderUnavailable = true;
      diagnostics.error = error instanceof Error ? error.message : String(error);
      console.warn('Automatic gender inference unavailable:', error);
    }
    faceMs = performance.now() - faceAt - genderMs;
  }
  const compositionAt = performance.now();
  const composition = compose(tracks, categories, side, side, settings);
  const compositionMs = performance.now() - compositionAt;
  session.last = { frame: { ...frame, rgba: new Uint8Array(0), faceRgba: undefined }, tracks, categories, composition, faceAssociations, detectedFaces };
  session.kind = frame.kind;
  session.lastBytes = side * side * (5 * composition.observations.length + 5) + tracks.length * side * side * 4;
  if (cacheEntry && !reused) keepImage(cacheEntry);
  trimSessions(frame.key.mediaSessionId);
  const renderAt = performance.now();
  const result = render(frame, session, composition);
  const renderMs = performance.now() - renderAt;
  const personStages = person?.getLastTimings() ?? { preprocess: 0, run: 0, decode: 0 };
  result.timingsMs = { acquire: frame.acquisitionStartedAtMs ? frame.capturedAtMs - frame.acquisitionStartedAtMs : 0,
    modelInit, person: personMs, semantic: semanticMs, tracking: trackingMs, face: faceMs, gender: genderMs,
    composition: compositionMs, render: renderMs,
    personPreprocess: personStages.preprocess, personRun: personStages.run, personDecode: personStages.decode,
    semanticPreprocess: semanticStages.preprocess, semanticRun: semanticStages.run, semanticDecode: semanticStages.decode,
    facePreprocess: faceStages.preprocess, faceRun: faceStages.run, faceDecode: faceStages.decode,
    genderPreprocess: genderStages.preprocess, genderRun: genderStages.run, genderDecode: genderStages.decode,
    total: performance.now() - started, backend: person?.getBackend() ?? 'cache', faceBackend: faces?.getBackend(),
    genderBackend: genderModel?.getBackend(), semanticBackend: semanticClient?.getBackend() ?? semantic?.getBackend() ?? 'cache',
    yoloSize: side, yunetSize: settings.yunetSize, faceCaptureSize: frame.faceSize,
    onnxThreads: onnxThreads ?? Math.min(4, Math.max(2, Math.floor(navigator.hardwareConcurrency / 4))),
    semanticParallel: !!semanticClient, isolated: self.crossOriginIsolated };
  send({ type: 'result', result });
}

self.onmessage = async (event: MessageEvent<WorkerInput>) => {
  const message = event.data;
  try {
    if (message.type === 'backend') {
      semanticPreference = message.semantic; onnxPreference = message.onnx;
      onnxThreads = message.threads; parallelSemantic = message.parallelSemantic; return;
    }
    if (message.type === 'warm') {
      warming = (async () => {
        await ensureModels(message.size);
        // Face and attribute sessions start with the first detected person.
      })().catch(error => console.warn('Model warmup unavailable:', error));
      return;
    }
    if (message.type === 'reset') {
      const session = sessions.get(message.mediaSessionId);
      if (session && session.epoch <= message.epoch) { session.tracker.reset(); sessions.delete(message.mediaSessionId); }
      return;
    }
    if (message.type === 'settings') {
      settings = message.settings;
      const session = sessions.get(message.key.mediaSessionId);
      if (!session || session.epoch !== message.key.epoch || !session.last || session.last.frame.key.sequence !== message.key.sequence) throw new Error('Cached analysis unavailable');
      session.last.composition = compose(session.last.tracks, session.last.categories, session.last.frame.width, session.last.frame.height, settings);
      send({ type: 'result', result: render(session.last.frame, session, session.last.composition) });
      return;
    }
    if (message.type === 'label') {
      settings = message.settings;
      const session = sessions.get(message.key.mediaSessionId);
      if (!session || session.epoch !== message.key.epoch || !session.last || !session.tracker.label(message.trackId, message.label as Label)) throw new Error('Track label unavailable');
      session.last.composition = compose(session.last.tracks, session.last.categories, session.last.frame.width, session.last.frame.height, settings!);
      send({ type: 'result', result: render(session.last.frame, session, session.last.composition) });
      return;
    }
    if (message.type === 'analyze') { settings = message.settings; await analyze(message.frame); }
  } catch (error) {
    send({ type: 'error', key: message.type === 'analyze' ? message.frame.key : 'key' in message ? message.key : undefined,
      message: error instanceof Error ? error.message : String(error),
      stage: (error as { stage?: 'semantic' })?.stage });
  }
};
send({ type: 'ready' });
