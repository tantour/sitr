// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
/// <reference lib="webworker" />
import { BODY_REGIONS, ENGINE, resolvePersonSize, type FaceEffect, type WholeBodyEffect, type Settings, type Label } from '../config/settings';
import { faceStrength, genderPolicy, hasBodyCoverage, hasFaceEffects, policyFor } from '../config/personPolicy';
import { regionCoverage } from '../rendering/regionCoverage';
import type { AnalysisResult, FramePacket, FrameKey, Track, WorkerInput, WorkerOutput } from '../state/contracts';
import type { YoloPersonSegmenter } from '../vision/person';
import type { FastPersonDetector } from '../vision/fastPerson';
import type { AppearanceGenderClassifier } from '../vision/gender';
import type { GenderEstimate } from '../vision/gender';
import type { BodyGenderClassifier, BodyGenderModel } from '../vision/bodyGender';
import { SelfieSemanticSegmenter, type FaceBox } from '../vision/semantic';
import { SemanticClient } from '../vision/semanticClient';
import type { OptionalFaceDetector } from '../vision/face';
import { associateFaces, associateFacesToBoxes, type FaceAssociation } from '../vision/faceAssociation';
import { ByteTracker } from '../vision/tracker';
import { canUseBodyGender, genderCheckDue } from '../vision/genderPolicy';
import { personAppearance } from '../vision/appearance';
import { compose, dilate, pruneIslands, type Composition } from '../rendering/compositor';
import { faceEllipseMask, openAssociatedFaces, videoPersonMask } from '../rendering/videoMask';
import { imageDetectionGatePass, imageSkinThresholds, personSelected, selectedMask } from '../rules/evaluate';
import { openThresholdFace, skinThresholdMask } from '../rendering/skinThreshold';
import { imageAnalysisKey } from '../config/imageAnalysis';
import type { BodyPixRegionSegmenter } from '../vision/bodyRegions';
import { allowedRegionIds, bodyRegionsEnabled } from '../vision/bodyRegionMap';
import type { BodyRegionDiagnostics } from '../state/contracts';

type FaceLabel = { label: Label; labelUsable: boolean };
type Session = { epoch: number; tracker: ByteTracker; lastTouched: number; lastBytes: number; kind?: 'image' | 'video'; imageAnalysis?: string; timingsMs?: AnalysisResult['timingsMs']; genderDiagnostics?: AnalysisResult['genderDiagnostics']; bodyRegionDiagnostics?: BodyRegionDiagnostics; last?: { frame: FramePacket; tracks: Track[]; categories: Uint8Array; bodyRegions?: Uint8Array; composition: Composition; faceAssociations?: FaceAssociation[]; detectedFaces?: FaceBox[]; faceLabels?: FaceLabel[] } };
const sessions = new Map<string, Session>();
type CachedImage = { key: string; rgba: Uint8Array; faceRgba?: Uint8Array; detections: Awaited<ReturnType<YoloPersonSegmenter['segment']>>;
  categories: Uint8Array; bodyRegions?: Uint8Array; bodyRegionDiagnostics?: BodyRegionDiagnostics; faces?: FaceBox[]; gender?: GenderEstimate[]; genderReady: boolean; bytes: number };
const imageCache = new Map<string, CachedImage>();
let cacheBytes = 0;
const memoryBudget = 64 * 1024 * 1024;
type PersonModel = YoloPersonSegmenter | FastPersonDetector;
const personModels = new Map<string, { model: PersonModel; lastUsed: number }>();
let personConstructor: typeof YoloPersonSegmenter | undefined;
let fastConstructor: typeof FastPersonDetector | undefined;
let genderConstructor: typeof AppearanceGenderClassifier | undefined;
let bodyGenderConstructor: typeof BodyGenderClassifier | undefined;
let faceConstructor: typeof OptionalFaceDetector | undefined;
let bodyRegionConstructor: typeof BodyPixRegionSegmenter | undefined;
let bodyRegionModel: BodyPixRegionSegmenter | undefined;
let bodyRegionRetryAt = 0;
let bodyRegionFailure = '';
let bodyRegionFailedMode: Settings['imageBodyRegionMode'] = 'off';
let genderModel: AppearanceGenderClassifier | undefined;
const bodyGenderModels = new Map<BodyGenderModel, BodyGenderClassifier>();
const bodyRetryAt = new Map<BodyGenderModel, number>();
let faceRetryAt = 0;
let semantic: SelfieSemanticSegmenter | undefined;
let semanticClient: SemanticClient | undefined;
let faces: OptionalFaceDetector | undefined;
let faceModelSize = 320;
let semanticPreference: 'auto' | 'cpu' = 'auto';
let onnxPreference: 'wasm' | 'webgpu' = 'webgpu';
let onnxThreads: number | undefined;
let parallelSemantic = false;
let settings: Settings | undefined;
let warming: Promise<void> | undefined;
let analyzing = false;

function send(output: WorkerOutput): void {
  if (output.type !== 'result') { postMessage(output); return; }
  const result = output.result;
  const transfers: Transferable[] = [result.rgbaMask.buffer];
  if (result.staticMask) transfers.push(result.staticMask.buffer);
  if (result.blackMask) transfers.push(result.blackMask.buffer);
  if (result.faceMask) transfers.push(result.faceMask.buffer);
  for (const layer of result.faceLayers ?? []) transfers.push(layer.alpha.buffer);
  for (const mask of result.trackMasks ?? []) transfers.push(mask.alpha.buffer);
  for (const item of result.debugPersonMasks ?? []) transfers.push(item.mask.buffer);
  if (result.debugBodyRegions) transfers.push(result.debugBodyRegions.labels.buffer);
  postMessage(output, transfers);
}
function getSession(key: FrameKey): Session {
  const prior = sessions.get(key.mediaSessionId);
  if (prior && prior.epoch === key.epoch) { prior.lastTouched = Date.now(); return prior; }
  prior?.tracker.reset();
  const session: Session = { epoch: key.epoch, tracker: new ByteTracker(key.mediaSessionId), lastTouched: Date.now(), lastBytes: 0 };
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
function imageCacheKey(frame: FramePacket, current: Settings): string {
  const main = sampledHash(frame.rgba, 2166136261);
  const face = frame.faceRgba ? sampledHash(frame.faceRgba, main) : 0;
  return `${frame.width}:${frame.faceSize ?? 0}:${imageAnalysisKey(current)}:${main}:${face}`;
}
function cachedImage(frame: FramePacket, current: Settings): CachedImage | undefined {
  if (frame.kind !== 'image') return;
  const key = imageCacheKey(frame, current);
  const entry = imageCache.get(key);
  if (!entry || !sameBytes(entry.rgba, frame.rgba) || !sameBytes(entry.faceRgba, frame.faceRgba)) return;
  if (bodyRegionsEnabled(current, 'image') && entry.bodyRegionDiagnostics?.status === 'fallback') return;
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
function composeWholePerson(tracks: Track[]): Composition {
  const empty = () => new Uint8Array(0);
  return {
    observations: tracks.map(track => ({
      id: track.id, box: track.box, label: track.label, labelUsable: track.labelUsable, state: track.state,
      ownedMask: empty(), bodySkinMask: empty(), hairMask: empty(), faceSkinMask: empty(),
      exposure: { ratio: 0, ownedPixels: 0, ambiguousFraction: 0, reliable: track.state !== 'ambiguous' },
    })),
    ambiguous: empty(), ambiguousByTrack: tracks.map(empty), unassignedMask: empty(),
    uncertainMask: empty(), uncertainByTrack: tracks.map(empty), unassignedForeground: 0,
  };
}
function composeFrame(frame: FramePacket, tracks: Track[], categories: Uint8Array, current: Settings, regions?: Uint8Array): Composition {
  if (frame.kind === 'video') return composeWholePerson(tracks);
  const whole = current.imageCoverage !== 'regions';
  return compose(tracks, categories, frame.width, frame.height, {
    ...current,
    bodySkin: whole || current.bodySkin,
    hair: whole || current.hair,
    faceSkin: current.imageCoverage === 'whole-body-face',
  }, current.imageCoverage, regions);
}
function imageFaceMask(session: Session, current: Settings, side: number, requested?: FaceEffect, strength?: number): Uint8Array | undefined {
  const kind = requested ?? (current.imageCoverage === 'regions' ? current.imageRegionFaceEffect
    : current.imageCoverage === 'whole-body' ? current.imageWholeBodyFaceEffect : 'show');
  if (kind === 'show' || !current.personPolicies && current.filter === 'off' || !session.last) return;
  const { tracks, categories, faceAssociations, detectedFaces, faceLabels } = session.last;
  const chosen = (person: FaceLabel) => personSelected(person, current, 'image') && (!current.personPolicies ||
    policyFor(current, person).face === kind && (strength === undefined || faceStrength(current, policyFor(current, person)) === strength));
  const selected = new Set(tracks.filter(chosen).map(track => track.id));
  const mask = new Uint8Array(side * side);
  const faceChosen = (detectedFaces ?? []).map((_face, index) => {
    const association = faceAssociations?.[index];
    if (association?.trackId && !association.ambiguous) return selected.has(association.trackId);
    if (current.personPolicies) {
      const cx = _face.box.x + _face.box.width / 2, cy = _face.box.y + _face.box.height / 2;
      const possible = tracks.filter(track => track.labelUsable && cx >= track.box.x && cx <= track.box.x + track.box.width &&
        cy >= track.box.y && cy <= track.box.y + track.box.height);
      if (possible.length === 1) return chosen(possible[0]);
    }
    return chosen(faceLabels?.[index] ?? { label: 'unknown', labelUsable: false });
  });
  const exemptFaces = faceEllipseMask(side, (detectedFaces ?? []).flatMap((face, index) => faceChosen[index] ? [] : [face.box]));
  const unknownChosen = chosen({ label: 'unknown', labelUsable: false });
  // MediaPipe supplies face-skin pixels when YuNet misses a face. Keep pixels
  // belonging only to an exempt person out of this extra effect layer.
  for (let p = 0; p < categories.length; p++) {
    if (categories[p] !== 3) continue;
    let selectedOwner = false, exemptOwner = false;
    for (const track of tracks) if (track.mask[p] >= 0.5) {
      if (selected.has(track.id)) selectedOwner = true;
      else exemptOwner = true;
    }
    if (selectedOwner || (!exemptOwner && unknownChosen && !exemptFaces[p])) mask[p] = 255;
  }
  const boxes = (detectedFaces ?? []).flatMap((face, index) => faceChosen[index] ? [face.box] : []);
  const ellipses = faceEllipseMask(side, boxes);
  for (let p = 0; p < mask.length; p++) mask[p] = Math.max(mask[p], ellipses[p]);
  return mask;
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
async function ensureModels(size: number, needSemantic = true, fast = false): Promise<PersonModel> {
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
  const semanticReady = needSemantic ? prepareSemantic() : Promise.resolve();
  const key = `${fast ? 'fast' : 'segment'}:${size}`;
  const prior = personModels.get(key);
  if (prior) { prior.lastUsed = Date.now(); await semanticReady; return prior.model; }
  if (!personConstructor) {
    const path = `${self.location.origin}/person-runtime.js`;
    const runtime = await import(/* @vite-ignore */ path) as typeof import('../vision/personRuntime');
    personConstructor = runtime.YoloPersonSegmenter;
    fastConstructor = runtime.FastPersonDetector;
    genderConstructor = runtime.AppearanceGenderClassifier;
    bodyGenderConstructor = runtime.BodyGenderClassifier;
    faceConstructor = runtime.OptionalFaceDetector;
    bodyRegionConstructor = runtime.BodyPixRegionSegmenter;
  }
  if (!personConstructor) throw new Error('Person runtime unavailable');
  if (personModels.size >= 2) {
    const oldest = [...personModels.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    personModels.delete(oldest[0]);
    await oldest[1].model.dispose();
  }
  if (fast && size !== 256) throw new Error('Fast person detector requires 256-pixel input');
  const model = fast ? new fastConstructor!(onnxPreference, onnxThreads)
    : new personConstructor(size, onnxPreference, onnxThreads);
  await model.initialize();
  personModels.set(key, { model, lastUsed: Date.now() });
  await semanticReady;
  return model;
}
async function inferBodyRegions(frame: FramePacket, categories: Uint8Array, current: Settings, reused?: CachedImage): Promise<{
  map?: Uint8Array; diagnostics: BodyRegionDiagnostics; ms: number; stages: { preprocess: number; run: number; decode: number };
}> {
  const skinPixels = categories.reduce((sum, label) => sum + Number(label === 2), 0);
  const diagnostics: BodyRegionDiagnostics = { model: current.imageBodyRegionMode,
    status: frame.kind === 'video' ? 'skipped-video' : current.imageBodyRegionMode === 'off' ? 'disabled'
      : current.imageCoverage !== 'regions' ? 'skipped-coverage' : !hasBodyCoverage(current) || !skinPixels ? 'skipped-no-skin' : 'ready',
    skinPixels, unknownSkinPixels: 0, allowedSkinPixels: 0, coveredSkinPixels: 0,
    femaleAllowedRegions: [...current.imageFemaleAllowedRegions], maleAllowedRegions: [...current.imageMaleAllowedRegions] };
  const stages = { preprocess: 0, run: 0, decode: 0 };
  if (diagnostics.status !== 'ready') {
    if (current.imageBodyRegionMode === 'off' && bodyRegionModel) { await bodyRegionModel.dispose(); bodyRegionModel = undefined; }
    return { diagnostics, ms: 0, stages };
  }
  if (reused?.bodyRegions && reused.bodyRegionDiagnostics) return {
    map: reused.bodyRegions, diagnostics: { ...reused.bodyRegionDiagnostics, status: 'cache',
      femaleAllowedRegions: diagnostics.femaleAllowedRegions, maleAllowedRegions: diagnostics.maleAllowedRegions }, ms: 0, stages,
  };
  const at = performance.now();
  try {
    if (bodyRegionFailedMode === current.imageBodyRegionMode && Date.now() < bodyRegionRetryAt) throw new Error(bodyRegionFailure);
    if (bodyRegionModel?.mode !== current.imageBodyRegionMode) {
      await bodyRegionModel?.dispose(); bodyRegionModel = undefined;
      if (!bodyRegionConstructor) throw new Error('BodyPix runtime unavailable');
      const model = new bodyRegionConstructor(current.imageBodyRegionMode as 'faster' | 'finer', onnxPreference, onnxThreads);
      try { await model.initialize(); } catch (error) { await model.dispose(); throw error; }
      bodyRegionModel = model;
    }
    const map = await bodyRegionModel!.segment(frame.rgba, frame.width, categories);
    diagnostics.backend = bodyRegionModel!.getBackend(); diagnostics.inputSize = bodyRegionModel!.getInputSize();
    diagnostics.stride = current.imageBodyRegionMode === 'faster' ? 16 : 8;
    diagnostics.unknownSkinPixels = categories.reduce((sum, label, index) => sum + Number(label === 2 && map[index] === 0), 0);
    bodyRegionRetryAt = 0;
    return { map, diagnostics, ms: performance.now() - at, stages: bodyRegionModel!.getLastTimings() };
  } catch (error) {
    diagnostics.status = 'fallback'; diagnostics.unknownSkinPixels = skinPixels;
    diagnostics.error = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    bodyRegionFailure = diagnostics.error; bodyRegionFailedMode = current.imageBodyRegionMode; bodyRegionRetryAt = Date.now() + 5000;
    await bodyRegionModel?.dispose().catch(() => {}); bodyRegionModel = undefined;
    console.warn('BodyPix unavailable; covering skin with the existing model:', diagnostics.error);
    return { diagnostics, ms: performance.now() - at, stages };
  }
}
function render(frame: FramePacket, session: Session, composition: Composition): AnalysisResult {
  if (!settings) throw new Error('Settings unavailable');
  const size = frame.width;
  const now = Date.now();
  const { observations, unassignedMask, unassignedForeground } = composition;
  const unreliable = observations.some(o => o.state !== 'lost' && personSelected(o, settings!, frame.kind) && !o.exposure.reliable);
  const unassigned = unassignedForeground > Math.max(64, size * size * 0.005);
  let reason = unreliable ? 'uncertain-person' : unassigned ? 'unassigned-region' : 'protected';
  const isVideo = frame.kind === 'video';
  const gatePass = isVideo || imageDetectionGatePass(settings,
    !!session.last?.detectedFaces?.length, !!session.last?.tracks.length);
  const thresholds = !isVideo && gatePass ? imageSkinThresholds(observations, settings)
    : { bodyIds: new Set<string>(), blackImage: false };
  const blackMask = thresholds.bodyIds.size ? new Uint8Array(size * size) : undefined;
  const facesFor = (id: string) => (session.last?.faceAssociations ?? [])
    .filter(item => item.trackId === id && !item.ambiguous)
    .map(item => session.last?.detectedFaces?.[item.faceIndex]?.box)
    .filter((box): box is NonNullable<typeof box> => !!box);
  const wholePerson = isVideo || settings.imageCoverage !== 'regions';
  const alpha = wholePerson ? new Uint8Array(0) : new Uint8Array(size * size);
  const bodyRegions = bodyRegionsEnabled(settings, frame.kind) ? session.last?.bodyRegions : undefined;
  const allowedSkin = bodyRegions ? new Uint8Array(size * size) : undefined;
  const requiredCoverage = bodyRegions ? new Uint8Array(size * size) : undefined;
  const bodyRegionDiagnostics = session.bodyRegionDiagnostics && { ...session.bodyRegionDiagnostics,
    model: settings.imageBodyRegionMode,
    status: isVideo ? 'skipped-video' as const : settings.imageBodyRegionMode === 'off' ? 'disabled' as const
      : settings.imageCoverage !== 'regions' ? 'skipped-coverage' as const : !hasBodyCoverage(settings) ? 'skipped-no-skin' as const
      : session.bodyRegionDiagnostics.status,
    femaleAllowedRegions: settings.personPolicies ? BODY_REGIONS.filter(area => genderPolicy(settings!, 'female').skin[area] === 'show') : [...settings.imageFemaleAllowedRegions],
    maleAllowedRegions: settings.personPolicies ? BODY_REGIONS.filter(area => genderPolicy(settings!, 'male').skin[area] === 'show') : [...settings.imageMaleAllowedRegions],
    policies: settings.personPolicies,
    allowedSkinPixels: 0, coveredSkinPixels: 0 };
  const staticMask = isVideo || !gatePass ? undefined : dilate(pruneIslands(unassignedMask, size, size), size, size, settings.imageExpansion);
  if (staticMask && settings.imageCoverage === 'whole-body')
    openAssociatedFaces(staticMask, size, session.last?.detectedFaces?.map(face => face.box) ?? []);
  if (!wholePerson && staticMask) alpha.set(staticMask);
  const trackMasks: NonNullable<AnalysisResult['trackMasks']> = [];
  for (let t = 0; t < observations.length; t++) {
    if (!gatePass) break;
    const observation = observations[t];
    if (!personSelected(observation, settings, frame.kind)) continue;
    if (blackMask && thresholds.bodyIds.has(observation.id)) {
      const track = session.last?.tracks.find(candidate => candidate.id === observation.id);
      if (track) {
        const mask = skinThresholdMask(track.mask, observation, size, settings.imageExpansion,
          settings.imageSkinThresholdIncludeFace, facesFor(observation.id));
        for (let p = 0; p < mask.length; p++) blackMask[p] = Math.max(blackMask[p], mask[p]);
      }
      continue;
    }
    if (wholePerson) {
      const track = session.last?.tracks.find(candidate => candidate.id === observation.id);
      if (!track) continue;
      const protectedMask = videoPersonMask(track.mask, size, isVideo ? settings.videoExpansion : settings.imageExpansion);
      if (!isVideo && settings.imageCoverage === 'whole-body') {
        const faceBoxes = (session.last?.faceAssociations ?? [])
          .filter(item => item.trackId === observation.id && !item.ambiguous)
          .map(item => session.last?.detectedFaces?.[item.faceIndex]?.box)
          .filter((box): box is NonNullable<typeof box> => !!box);
        openAssociatedFaces(protectedMask, size, faceBoxes);
      }
      trackMasks.push({ id: observation.id, alpha: protectedMask, effect: isVideo && settings.personPolicies
        ? { kind: policyFor(settings, observation).video as WholeBodyEffect, intensity: settings.videoEffectIntensity, grayscale: settings.videoEffectGrayscale } : undefined });
      continue;
    }
    const part = selectedMask(observation, settings, bodyRegions);
    const ambiguousPart = composition.ambiguousByTrack[t];
    const uncertainPart = composition.uncertainByTrack[t];
    const allowed = bodyRegions ? allowedRegionIds(observation, settings) : undefined;
    for (let i = 0; i < part.length; i++) if (hasBodyCoverage(settings) && observation.bodySkinMask[i]) {
      if (allowedSkin && allowed?.[bodyRegions![i]] && !ambiguousPart[i] && !uncertainPart[i]) {
        allowedSkin[i] = 255;
        if (bodyRegionDiagnostics) bodyRegionDiagnostics.allowedSkinPixels++;
      } else if (bodyRegionDiagnostics) bodyRegionDiagnostics.coveredSkinPixels++;
    }
    for (let i = 0; i < part.length; i++) if (ambiguousPart[i] || uncertainPart[i]) {
      part[i] = 255;
      if (requiredCoverage) requiredCoverage[i] = 255;
    }
    const expanded = dilate(pruneIslands(part, size, size), size, size, settings.imageExpansion);
    for (let i = 0; i < alpha.length; i++) if (expanded[i]) alpha[i] = 255;
  }
  // Expansion must not repaint confidently owned skin in an explicitly allowed region.
  if (allowedSkin) for (let i = 0; i < alpha.length; i++) if (allowedSkin[i] && !requiredCoverage![i]) alpha[i] = 0;
  if (settings.personPolicies && !wholePerson && gatePass) alpha.set(regionCoverage(composition, session.last?.tracks ?? [], settings, size, bodyRegions));
  const noImageCoverage = settings.personPolicies ? !['female', 'male'].some(gender => {
    const policy = genderPolicy(settings!, gender as 'female' | 'male');
    return policy.hair === 'hide' || policy.face !== 'show' || policy.otherSkin === 'hide' || BODY_REGIONS.some(area => policy.skin[area] === 'hide');
  }) : settings.filter === 'off';
  if (!gatePass || (noImageCoverage && !isVideo && !unreliable && !unassigned)) reason = 'off';
  const rgbaMask = new Uint8Array(alpha.length * 4);
  for (let i = 0; i < alpha.length; i++) rgbaMask[i * 4 + 3] = alpha[i];
  const faceMask = !isVideo && gatePass && !settings.personPolicies ? imageFaceMask(session, settings, size) : undefined;
  const faceLayers = !isVideo && gatePass && settings.personPolicies && settings.imageCoverage !== 'whole-body-face'
    ? (['blur', 'checkerboard', 'black'] as const).flatMap(kind => {
      const strengths = new Set([genderPolicy(settings!, 'female'), genderPolicy(settings!, 'male'), policyFor(settings!, { label: 'unknown', labelUsable: false })]
        .filter(policy => policy.face === kind).map(policy => faceStrength(settings!, policy)));
      return [...strengths].sort((a, b) => a - b).flatMap(intensity => {
        const alpha = imageFaceMask(session, settings!, size, kind, intensity);
        if (!alpha?.some(Boolean)) return [];
        if (!settings!.imageSkinThresholdIncludeFace) for (const observation of observations)
          if (thresholds.bodyIds.has(observation.id)) openThresholdFace(alpha, observation, size, facesFor(observation.id));
        return [{ alpha, effect: { kind, intensity, grayscale: settings!.imageFaceEffectGrayscale } }];
      });
    }) : undefined;
  if (faceMask && !settings.imageSkinThresholdIncludeFace) for (const observation of observations) {
    if (thresholds.bodyIds.has(observation.id)) openThresholdFace(faceMask, observation, size, facesFor(observation.id));
  }
  if (thresholds.blackImage) reason = 'group-skin-threshold';
  else if (thresholds.bodyIds.size) reason = 'skin-threshold';
  const faceKind = settings.imageCoverage === 'regions' ? settings.imageRegionFaceEffect : settings.imageWholeBodyFaceEffect;
  return {
    key: frame.key, width: size, height: size, mediaTimeSec: frame.mediaTimeSec,
    acquisitionStartedAtMs: frame.acquisitionStartedAtMs,
    capturedAtMs: frame.capturedAtMs, analyzedAtMs: now, settingsRevision: settings.revision,
    black: thresholds.blackImage, reason, rgbaMask, faceMask, faceLayers, blackMask,
    trackMasks: wholePerson ? trackMasks : undefined,
    effect: wholePerson && !(isVideo && settings.personPolicies) ? { kind: isVideo ? settings.videoEffect : settings.imageWholeBodyEffect,
      intensity: isVideo ? settings.videoEffectIntensity : settings.imageEffectIntensity,
      grayscale: isVideo ? settings.videoEffectGrayscale : settings.imageEffectGrayscale } : undefined,
    faceEffect: faceMask ? { kind: faceKind === 'show' ? 'black' : faceKind,
      intensity: settings.imageFaceEffectIntensity, grayscale: settings.imageFaceEffectGrayscale } : undefined,
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
    bodyRegionDiagnostics,
    debugBodyRegions: settings.debugOverlay && bodyRegions ? (() => {
      const width = 128, height = 128, labels = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
        labels[y * width + x] = bodyRegions[Math.min(size - 1, Math.floor(y * size / height)) * size + Math.min(size - 1, Math.floor(x * size / width))];
      return { labels, width, height };
    })() : undefined,
  };
}

function renderCached(session: Session, current: Settings): AnalysisResult {
  if (!session.last) throw new Error('Cached analysis unavailable');
  const at = performance.now();
  if (session.last.bodyRegions && bodyRegionsEnabled(current, session.last.frame.kind) && session.bodyRegionDiagnostics)
    session.bodyRegionDiagnostics = { ...session.bodyRegionDiagnostics, status: 'cache' };
  session.last.composition = composeFrame(session.last.frame, session.last.tracks, session.last.categories, current, session.last.bodyRegions);
  const compositionMs = performance.now() - at, renderAt = performance.now();
  const result = render(session.last.frame, session, session.last.composition);
  if (session.timingsMs) result.timingsMs = { ...session.timingsMs, modelInit: 0, person: 0, semantic: 0, face: 0, gender: 0,
    bodyRegions: 0, bodyRegionPreprocess: 0, bodyRegionRun: 0, bodyRegionDecode: 0,
    personPreprocess: 0, personRun: 0, personDecode: 0, semanticPreprocess: 0, semanticRun: 0, semanticDecode: 0,
    facePreprocess: 0, faceRun: 0, faceDecode: 0, genderPreprocess: 0, genderRun: 0, genderDecode: 0,
    backend: 'cache', semanticBackend: session.kind === 'video' ? 'skipped' : 'cache',
    bodyRegionBackend: bodyRegionsEnabled(current, session.last.frame.kind) && session.last.bodyRegions ? 'cache' : result.bodyRegionDiagnostics?.status,
    bodyRegionModel: current.imageBodyRegionMode, composition: compositionMs, render: performance.now() - renderAt,
    acquire: 0, queue: 0, tracking: 0, total: performance.now() - at };
  return result;
}

async function analyze(frame: FramePacket): Promise<void> {
  await warming;
  if (!settings) throw new Error('Settings unavailable');
  if (genderModel && settings.imageGenderModel.startsWith('body-') && settings.videoGenderModel.startsWith('body-')) {
    await genderModel.dispose();
    genderModel = undefined;
  }
  const started = performance.now();
  const side = resolvePersonSize(settings, frame.kind);
  if (frame.width !== side || frame.height !== side || frame.rgba.length !== side * side * 4 || frame.rgba.byteLength > ENGINE.maxPayloadBytes) throw new Error('Invalid frame dimensions');
  const reused = cachedImage(frame, settings);
  const person = reused ? undefined : await ensureModels(side, frame.kind === 'image',
    frame.kind === 'video' && settings.videoDetector === 'fast-box');
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
    if (frame.kind === 'video') return new Uint8Array(side * side);
    // Local MediaPipe blocks this JS worker. Let ONNX submit and complete first;
    // otherwise semantic work delays GPU dispatch/readback and pollutes its timer.
    // A separate semantic worker can still overlap without blocking ONNX.
    if (!semanticClient) await personTask;
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
  const bodyRegions = await inferBodyRegions(frame, categories, settings, reused);
  if (!reused) for (const detection of detections)
    detection.appearance = personAppearance(frame.rgba, side, detection.box);
  const cacheEntry: CachedImage | undefined = frame.kind === 'image' ? reused ?? {
    key: imageCacheKey(frame, settings), rgba: frame.rgba,
    faceRgba: frame.faceRgba, detections, categories, genderReady: false,
    bodyRegions: bodyRegions.map, bodyRegionDiagnostics: bodyRegions.diagnostics,
    bytes: frame.rgba.byteLength + (frame.faceRgba?.byteLength ?? 0) + categories.byteLength +
      detections.reduce((sum, detection) => sum + detection.mask.byteLength, 0) + (bodyRegions.map?.byteLength ?? 0),
  } : undefined;
  const trackingAt = performance.now();
  const session = getSession(frame.key);
  session.bodyRegionDiagnostics = bodyRegions.diagnostics;
  const imageNeedsFaceMatching = frame.kind === 'image' &&
    (settings.faceAssociation || settings.debugOverlay || settings.imageCoverage === 'whole-body' ||
      (settings.imageSkinThresholdEnabled && !settings.imageSkinThresholdIncludeFace) ||
      (settings.imageCoverage === 'regions' && hasFaceEffects(settings)) ||
      (settings.automaticGender && settings.imageGenderModel.startsWith('face')));
  const tracks = session.tracker.update(detections, Date.now(), frame.kind === 'image',
    frame.motionTracks ? new Map(frame.motionTracks.map(track => [track.id, track.box])) : undefined,
    imageNeedsFaceMatching);
  const trackingMs = performance.now() - trackingAt;
  let faceAssociations: FaceAssociation[] | undefined;
  let detectedFaces: FaceBox[] | undefined;
  let faceLabels: FaceLabel[] | undefined;
  const faceClassifiedTracks = new Set<string>();
  const visibleFaceTracks = new Set<string>();
  const genderCheckAt = Date.now();
  const dueTracks = new Set(tracks.filter(track => frame.kind === 'image' || genderCheckDue(track, genderCheckAt)).map(track => track.id));
  const genderDue = settings.automaticGender && (frame.kind === 'image' ||
    dueTracks.size > 0);
  const genderChoice = frame.kind === 'image' ? settings.imageGenderModel : settings.videoGenderModel;
  const faceGender = genderChoice === 'face' || genderChoice.startsWith('face-');
  const bodyGender: BodyGenderModel | undefined = genderChoice.endsWith('paddle') ? 'paddle'
    : genderChoice.endsWith('intel') ? 'intel' : undefined;
  const bodyFallback = genderChoice.startsWith('face-');
  if (genderDue && frame.kind === 'video') for (const track of tracks)
    if (dueTracks.has(track.id)) track.lastGenderCheckAt = genderCheckAt;
  const needsFaces = settings.faceAssociation || (genderDue && faceGender) || settings.debugOverlay ||
    (frame.kind === 'image' && ((settings.imageSkinThresholdEnabled && !settings.imageSkinThresholdIncludeFace) ||
      ['face', 'either', 'both'].includes(settings.imageDetectionGate) ||
      settings.imageCoverage === 'whole-body' ||
      (settings.imageCoverage === 'regions' && hasFaceEffects(settings))));
  const diagnostics = { model: genderChoice, people: tracks.length, faces: 0, associated: 0,
    faceGenderAttempts: 0, bodyGenderAttempts: 0, attempted: 0, accepted: 0,
    error: undefined as string | undefined };
  session.genderDiagnostics = diagnostics;
  if (needsFaces && (tracks.length > 0 || settings.debugOverlay || frame.kind === 'image') &&
      Date.now() >= faceRetryAt && (frame.kind === 'image' || frame.faceRgba)) {
    const faceAt = performance.now();
    const faceRgba = frame.faceRgba ?? frame.rgba;
    const faceSide = frame.faceSize ?? side;
    try {
      if (faces && faceModelSize !== settings.yunetSize) { await faces.dispose(); faces = undefined; }
      if (!faces) {
        if (!faceConstructor) throw new Error('Face runtime unavailable');
        const detector = new faceConstructor('wasm', onnxThreads, settings.yunetSize);
        await detector.initialize();
        faces = detector;
        faceModelSize = settings.yunetSize;
      }
      const currentFaces = (cacheEntry?.faces ?? await faces.detect(faceRgba, faceSide))
        .filter(face => face.score >= settings!.faceDetectionConfidence && face.box.width * faceSide >= settings!.minFaceSizePx);
      if (!cacheEntry?.faces) faceStages = faces.getLastTimings();
      if (cacheEntry) cacheEntry.faces = currentFaces;
      detectedFaces = currentFaces;
      faceLabels = currentFaces.map(() => ({ label: 'unknown', labelUsable: false }));
      diagnostics.faces = currentFaces.length;
      faceAssociations = frame.kind === 'video' && settings.videoDetector === 'fast-box'
        ? associateFacesToBoxes(currentFaces, tracks)
        : associateFaces(currentFaces, tracks, side, settings.faceAssociationMode, {
          coverage: settings.faceCoverage, margin: settings.faceMargin, centerMaskConfidence: settings.centerMaskConfidence,
        });
      diagnostics.associated = faceAssociations.filter(item => item.trackId && !item.ambiguous).length;
      for (const association of faceAssociations) if (association.trackId && !association.ambiguous)
        visibleFaceTracks.add(association.trackId);
      const independentImageFaces = frame.kind === 'image' &&
        (settings.imageCoverage === 'regions' ? hasFaceEffects(settings)
          : settings.imageCoverage === 'whole-body' && settings.imageWholeBodyFaceEffect !== 'show');
      if (genderDue && (faceGender || independentImageFaces)) {
        const genderAt = performance.now();
        const eligible = currentFaces.flatMap((face, index) => {
          const owner = faceAssociations?.[index];
          const associated = !!owner?.trackId && !owner.ambiguous;
          return faceGender && (frame.kind === 'image' || associated && dueTracks.has(owner!.trackId!)) ||
            independentImageFaces && !associated ? [index] : [];
        });
        diagnostics.attempted = eligible.length;
        diagnostics.faceGenderAttempts = eligible.length;
        if (eligible.length) {
          if (!genderModel) {
            if (!genderConstructor) throw new Error('Gender runtime unavailable');
            const classifier = new genderConstructor('wasm', onnxThreads);
            await classifier.initialize();
            genderModel = classifier;
          }
          const estimates = eligible.map(index => cacheEntry?.gender?.[index]);
          const missing = eligible.flatMap((index, position) => estimates[position] ? [] : [{ index, position }]);
          if (missing.length) {
            if (cacheEntry) {
              cacheEntry.gender ??= Array.from({ length: currentFaces.length });
            }
            for (let start = 0; start < missing.length; start += ENGINE.maxPersonsPerFrame) {
              const batch = missing.slice(start, start + ENGINE.maxPersonsPerFrame);
              const fresh = await genderModel.classify(faceRgba, faceSide, batch.map(item => currentFaces[item.index].box));
              const stages = genderModel.getLastTimings();
              genderStages = { preprocess: genderStages.preprocess + stages.preprocess,
                run: genderStages.run + stages.run, decode: genderStages.decode + stages.decode };
              for (const [index, item] of batch.entries()) {
                estimates[item.position] = fresh[index];
                if (cacheEntry) cacheEntry.gender![item.index] = fresh[index];
              }
            }
          }
          if (cacheEntry) cacheEntry.genderReady = eligible.every(index => !!cacheEntry.gender?.[index]);
          for (const [position, index] of eligible.entries()) {
            const estimate = estimates[position];
            const width = currentFaces[index].box.width * faceSide;
            const minimumConfidence = width < settings.smallFaceCutoffPx ? settings.smallFaceConfidence : settings.genderConfidence;
            if (estimate && estimate.confidence >= minimumConfidence) {
              faceLabels![index] = { label: estimate.label, labelUsable: true };
              const association = faceAssociations[index];
              if (faceGender && association.trackId && !association.ambiguous) {
                faceClassifiedTracks.add(association.trackId);
                if (session.tracker.estimateGender(association.trackId, estimate.label, estimate.confidence,
                  frame.kind === 'image', minimumConfidence, 'face')) diagnostics.accepted++;
              } else diagnostics.accepted++;
            }
          }
        }
        genderMs += performance.now() - genderAt;
      }
    } catch (error) {
      // A failed attribute model must not turn an unclassified person into an exemption.
      faceRetryAt = Date.now() + 5000;
      if (genderModel) { void genderModel.dispose().catch(() => {}); genderModel = undefined; }
      if (faces) { void faces.dispose().catch(() => {}); faces = undefined; }
      diagnostics.error = error instanceof Error ? error.message : String(error);
      console.warn('Automatic gender inference unavailable:', error);
    }
    faceMs = performance.now() - faceAt - genderMs;
  }
  if (genderDue && bodyGender && Date.now() >= (bodyRetryAt.get(bodyGender) ?? 0)) {
    const candidates = tracks.filter(track => dueTracks.has(track.id) &&
      canUseBodyGender(track, frame.kind, bodyFallback, visibleFaceTracks.has(track.id), faceClassifiedTracks.has(track.id)));
    diagnostics.attempted += candidates.length;
    diagnostics.bodyGenderAttempts = candidates.length;
    if (candidates.length) {
      const bodyAt = performance.now();
      try {
        let classifier = bodyGenderModels.get(bodyGender);
        if (!classifier) {
          if (!bodyGenderConstructor) throw new Error('Body gender runtime unavailable');
          classifier = new bodyGenderConstructor(bodyGender, 'wasm', onnxThreads);
          await classifier.initialize();
          bodyGenderModels.set(bodyGender, classifier);
        }
        const estimates = await classifier.classify(frame.rgba, side, candidates.map(track => track.box));
        const stages = classifier.getLastTimings();
        genderStages = { preprocess: genderStages.preprocess + stages.preprocess,
          run: genderStages.run + stages.run, decode: genderStages.decode + stages.decode };
        for (const [index, track] of candidates.entries()) {
          const estimate = estimates[index];
          if (estimate && estimate.confidence >= settings.genderConfidence &&
            session.tracker.estimateGender(track.id, estimate.label, estimate.confidence,
              frame.kind === 'image', settings.genderConfidence, bodyGender === 'intel' ? 'body-intel' : 'body-paddle')) diagnostics.accepted++;
        }
      } catch (error) {
        bodyRetryAt.set(bodyGender, Date.now() + 5000);
        const failed = bodyGenderModels.get(bodyGender);
        if (failed) { void failed.dispose().catch(() => {}); bodyGenderModels.delete(bodyGender); }
        diagnostics.error = error instanceof Error ? error.message : String(error);
        console.warn('Body gender inference unavailable:', error);
      }
      genderMs += performance.now() - bodyAt;
    }
  }
  const compositionAt = performance.now();
  const composition = composeFrame(frame, tracks, categories, settings, bodyRegions.map);
  const compositionMs = performance.now() - compositionAt;
  session.last = { frame: { ...frame, rgba: new Uint8Array(0), faceRgba: undefined }, tracks, categories, bodyRegions: bodyRegions.map, composition, faceAssociations, detectedFaces, faceLabels };
  session.kind = frame.kind;
  session.imageAnalysis = frame.kind === 'image' ? imageAnalysisKey(settings) : undefined;
  session.lastBytes = side * side * (5 * composition.observations.length + 5) + tracks.length * side * side * 4 + (bodyRegions.map?.byteLength ?? 0);
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
    bodyRegions: bodyRegions.ms, bodyRegionPreprocess: bodyRegions.stages.preprocess,
    bodyRegionRun: bodyRegions.stages.run, bodyRegionDecode: bodyRegions.stages.decode,
    bodyRegionBackend: bodyRegions.diagnostics.status === 'cache' ? 'cache' : bodyRegions.diagnostics.backend ?? bodyRegions.diagnostics.status, bodyRegionModel: settings.imageBodyRegionMode,
    facePreprocess: faceStages.preprocess, faceRun: faceStages.run, faceDecode: faceStages.decode,
    genderPreprocess: genderStages.preprocess, genderRun: genderStages.run, genderDecode: genderStages.decode,
    total: performance.now() - started, backend: person?.getBackend() ?? 'cache', faceBackend: faces?.getBackend(),
    genderBackend: (bodyGender ? bodyGenderModels.get(bodyGender)?.getBackend() : undefined) ?? genderModel?.getBackend(),
    semanticBackend: frame.kind === 'video'
      ? 'skipped' : semanticClient?.getBackend() ?? semantic?.getBackend() ?? 'cache',
    yoloSize: side, yunetSize: settings.yunetSize, faceCaptureSize: frame.faceSize,
    onnxThreads: onnxThreads ?? Math.min(4, Math.max(2, Math.floor(navigator.hardwareConcurrency / 4))),
    semanticParallel: !!semanticClient, isolated: self.crossOriginIsolated };
  session.timingsMs = result.timingsMs;
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
      if (warming || analyzing) return;
      warming = (async () => {
        await ensureModels(message.size, message.semantic, message.kind === 'video' && message.detector === 'fast-box');
        // Face and attribute sessions start with the first detected person.
      })().catch(error => console.warn('Model warmup unavailable:', error)).finally(() => { warming = undefined; });
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
      if (session.kind === 'image' && session.imageAnalysis !== imageAnalysisKey(settings)) throw new Error('Cached analysis unavailable');
      if (settings.imageBodyRegionMode === 'off' && bodyRegionModel) { await bodyRegionModel.dispose(); bodyRegionModel = undefined; }
      send({ type: 'result', result: renderCached(session, settings) });
      return;
    }
    if (message.type === 'reuse-image') {
      const started = performance.now();
      settings = message.settings;
      const source = sessions.get(message.fromKey.mediaSessionId);
      if (!source?.last || source.kind !== 'image' || source.epoch !== message.fromKey.epoch ||
          source.last.frame.key.sequence !== message.fromKey.sequence ||
          source.imageAnalysis !== imageAnalysisKey(settings)) throw new Error('Cached analysis unavailable');
      source.lastTouched = Date.now();
      const snapshot = structuredClone(source.last);
      snapshot.frame.key = message.key;
      const session = getSession(message.key);
      session.tracker.restoreImage(snapshot.tracks);
      session.last = snapshot;
      session.kind = 'image';
      session.imageAnalysis = source.imageAnalysis;
      session.lastBytes = source.lastBytes;
      session.genderDiagnostics = source.genderDiagnostics && { ...source.genderDiagnostics };
      session.bodyRegionDiagnostics = source.bodyRegionDiagnostics && { ...source.bodyRegionDiagnostics,
        status: source.last.bodyRegions ? 'cache' : source.bodyRegionDiagnostics.status };
      const compositionAt = performance.now();
        snapshot.composition = composeFrame(snapshot.frame, snapshot.tracks, snapshot.categories, settings, snapshot.bodyRegions);
      const compositionMs = performance.now() - compositionAt;
      trimSessions(message.key.mediaSessionId);
      const renderAt = performance.now();
      const result = render(snapshot.frame, session, snapshot.composition);
      if (source.timingsMs) result.timingsMs = { ...source.timingsMs,
        acquire: 0, modelInit: 0, person: 0, semantic: 0, tracking: 0, face: 0, gender: 0,
        personPreprocess: 0, personRun: 0, personDecode: 0,
        semanticPreprocess: 0, semanticRun: 0, semanticDecode: 0,
        bodyRegions: 0, bodyRegionPreprocess: 0, bodyRegionRun: 0, bodyRegionDecode: 0,
        bodyRegionBackend: bodyRegionsEnabled(settings, 'image') && snapshot.bodyRegions ? 'cache' : result.bodyRegionDiagnostics?.status, bodyRegionModel: settings.imageBodyRegionMode,
        facePreprocess: 0, faceRun: 0, faceDecode: 0,
        genderPreprocess: 0, genderRun: 0, genderDecode: 0, backend: 'cache', semanticBackend: 'cache',
        composition: compositionMs, render: performance.now() - renderAt, total: performance.now() - started };
      session.timingsMs = result.timingsMs;
      send({ type: 'result', result });
      return;
    }
    if (message.type === 'label') {
      settings = message.settings;
      const session = sessions.get(message.key.mediaSessionId);
      if (!session || session.epoch !== message.key.epoch || !session.last || !session.tracker.label(message.trackId, message.label as Label)) throw new Error('Track label unavailable');
      send({ type: 'result', result: renderCached(session, settings) });
      return;
    }
    if (message.type === 'analyze') {
      analyzing = true;
      try { settings = message.settings; await analyze(message.frame); }
      finally { analyzing = false; }
    }
  } catch (error) {
    send({ type: 'error', key: message.type === 'analyze' ? message.frame.key : 'key' in message ? message.key : undefined,
      message: error instanceof Error ? error.message : String(error),
      stage: (error as { stage?: 'semantic' })?.stage });
  }
};
send({ type: 'ready' });
