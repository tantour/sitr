// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
export type Label = 'female' | 'male' | 'unknown';
export type FilterMode = 'female' | 'male' | 'both' | 'off';
export type UnknownPolicy = 'selected' | 'allow';
export type PerformanceMode = 'performance' | 'balanced' | 'quality';
export type OnnxThreads = 'auto' | 1 | 2 | 4 | 6 | 8 | 12 | 16;
export type YoloResolution = 'auto' | 256 | 320 | 416;
export type YunetResolution = 256 | 320 | 416;
export type FaceCaptureResolution = 320 | 416 | 512 | 640;
export type FaceAssociationMode = 'overlap' | 'center';
export type VideoPlayback = 'smooth' | 'strict';
export type VideoDetector = 'segment' | 'fast-box';
export type GenderModel = 'face' | 'body-intel' | 'body-paddle' | 'face-intel' | 'face-paddle';
export type ImageCoverage = 'regions' | 'whole-body' | 'whole-body-face';
export type WholeBodyEffect = 'black' | 'blur' | 'checkerboard';
export type FaceEffect = 'show' | WholeBodyEffect;
export type ImageDetectionGate = 'any' | 'face' | 'person' | 'either' | 'both';

export interface Settings {
  schemaVersion: 16;
  revision: number;
  enabled: boolean;
  images: boolean;
  videos: boolean;
  videoPlayback: VideoPlayback;
  videoDetector: VideoDetector;
  filter: FilterMode;
  imageUnknown: UnknownPolicy;
  videoUnknown: UnknownPolicy;
  bodySkin: boolean;
  hair: boolean;
  faceSkin: boolean;
  imageCoverage: ImageCoverage;
  imageDetectionGate: ImageDetectionGate;
  imageSkinThresholdEnabled: boolean;
  imageSkinThresholdPercent: number;
  imageSkinThresholdIncludeFace: boolean;
  imageGroupSkinThresholdEnabled: boolean;
  imageGroupSkinThresholdPercent: number;
  imageGroupSkinPeopleLimit: number;
  imageWholeBodyEffect: WholeBodyEffect;
  imageRegionFaceEffect: FaceEffect;
  imageWholeBodyFaceEffect: FaceEffect;
  imageFaceEffectIntensity: number;
  imageFaceEffectGrayscale: boolean;
  videoEffect: WholeBodyEffect;
  imageEffectIntensity: number;
  videoEffectIntensity: number;
  imageEffectGrayscale: boolean;
  videoEffectGrayscale: boolean;
  imageExpansion: number;
  videoExpansion: number;
  automaticGender: boolean;
  imageGenderModel: GenderModel;
  videoGenderModel: GenderModel;
  faceAssociation: boolean;
  faceAssociationMode: FaceAssociationMode;
  debugOverlay: boolean;
  faceDetectionConfidence: number;
  minFaceSizePx: number;
  genderConfidence: number;
  smallFaceCutoffPx: number;
  smallFaceConfidence: number;
  faceCoverage: number;
  faceMargin: number;
  centerMaskConfidence: number;
  yoloConfidence: number;
  performance: PerformanceMode;
  onnxThreads: OnnxThreads;
  yoloImageSize: YoloResolution;
  yoloVideoSize: YoloResolution;
  yunetSize: YunetResolution;
  faceCaptureSize: FaceCaptureResolution;
  siteExceptions: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 16,
  revision: 0,
  enabled: true,
  images: true,
  videos: true,
  videoPlayback: 'smooth',
  videoDetector: 'segment',
  filter: 'female',
  imageUnknown: 'selected',
  videoUnknown: 'selected',
  bodySkin: true,
  hair: true,
  faceSkin: false,
  imageCoverage: 'regions',
  imageDetectionGate: 'any',
  imageSkinThresholdEnabled: false,
  imageSkinThresholdPercent: 80,
  imageSkinThresholdIncludeFace: false,
  imageGroupSkinThresholdEnabled: false,
  imageGroupSkinThresholdPercent: 70,
  imageGroupSkinPeopleLimit: 3,
  imageWholeBodyEffect: 'black',
  imageRegionFaceEffect: 'show',
  imageWholeBodyFaceEffect: 'show',
  imageFaceEffectIntensity: 24,
  imageFaceEffectGrayscale: false,
  videoEffect: 'black',
  imageEffectIntensity: 24,
  videoEffectIntensity: 24,
  imageEffectGrayscale: false,
  videoEffectGrayscale: false,
  imageExpansion: 1,
  videoExpansion: 4,
  automaticGender: true,
  imageGenderModel: 'face',
  videoGenderModel: 'face',
  faceAssociation: false,
  faceAssociationMode: 'overlap',
  debugOverlay: false,
  faceDetectionConfidence: 0.55,
  minFaceSizePx: 8,
  genderConfidence: 0.85,
  smallFaceCutoffPx: 16,
  smallFaceConfidence: 0.98,
  faceCoverage: 0.7,
  faceMargin: 0.2,
  centerMaskConfidence: 0.65,
  yoloConfidence: 0.10,
  performance: 'balanced',
  onnxThreads: 'auto',
  yoloImageSize: 'auto',
  yoloVideoSize: 'auto',
  yunetSize: 320,
  faceCaptureSize: 640,
  siteExceptions: [],
};

export const ENGINE = {
  maxPersonsPerFrame: 20,
  faceInput: 640,
  maxFacePayloadBytes: 640 * 640 * 4,
  maxPixels: 416 * 416,
  maxPayloadBytes: 416 * 416 * 4,
  maxResultAgeMs: 500,
  minOwnedPixels: 64,
  maxAmbiguousFraction: 0.1,
  ownershipMargin: 0.15,
  lostTrackMs: 2000,
  maxActiveVideos: 2,
  modes: {
    performance: { input: 256, videoInput: 256, initialHz: 4, maxHz: 4 },
    balanced: { input: 320, videoInput: 256, initialHz: 6, maxHz: 6 },
    quality: { input: 416, videoInput: 320, initialHz: 8, maxHz: 8 },
  },
} as const;

export function normalizeSiteException(value: string): string | undefined {
  const input = value.trim().toLowerCase().replace(/^\*\./, '');
  if (!input || (/^[a-z][a-z\d+.-]*:/i.test(input) && !/^https?:\/\//.test(input))) return;
  try {
    const host = new URL(/^https?:\/\//.test(input) ? input : `https://${input}`).hostname
      .replace(/\.$/, '').replace(/^www\./, '');
    if (!/^[a-z\d](?:[a-z\d.-]*[a-z\d])?$/.test(host) || host.includes('..')) return;
    return host;
  } catch { return; }
}

export function siteIsExcepted(hostname: string, exceptions: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return exceptions.some(site => host === site || host.endsWith(`.${site}`));
}

export function normalizeSettings(value: unknown): Settings {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Settings>;
  const merged = { ...DEFAULT_SETTINGS, ...raw };
  merged.schemaVersion = 16;
  for (const field of ['imageSkinThresholdEnabled', 'imageSkinThresholdIncludeFace', 'imageGroupSkinThresholdEnabled'] as const)
    merged[field] = merged[field] === true;
  for (const field of ['imageSkinThresholdPercent', 'imageGroupSkinThresholdPercent'] as const) {
    const value = Number(merged[field]);
    merged[field] = Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : DEFAULT_SETTINGS[field];
  }
  const peopleLimit = Number(merged.imageGroupSkinPeopleLimit);
  merged.imageGroupSkinPeopleLimit = Number.isFinite(peopleLimit)
    ? Math.max(1, Math.min(ENGINE.maxPersonsPerFrame - 1, Math.round(peopleLimit))) : DEFAULT_SETTINGS.imageGroupSkinPeopleLimit;
  if (!['female', 'male', 'both', 'off'].includes(merged.filter)) merged.filter = DEFAULT_SETTINGS.filter;
  const legacyUnknown = (raw as Partial<Settings> & { unknown?: string }).unknown;
  const migratedUnknown = legacyUnknown === 'allow' ? 'allow' : 'selected';
  for (const field of ['imageUnknown', 'videoUnknown'] as const) {
    const value = raw[field] ?? migratedUnknown;
    merged[field] = value === 'allow' || value === 'selected' ? value : DEFAULT_SETTINGS[field];
  }
  delete (merged as Settings & { unknown?: string }).unknown;
  if (!['smooth', 'strict'].includes(merged.videoPlayback)) merged.videoPlayback = DEFAULT_SETTINGS.videoPlayback;
  if (!['segment', 'fast-box'].includes(merged.videoDetector)) merged.videoDetector = DEFAULT_SETTINGS.videoDetector;
  for (const field of ['imageGenderModel', 'videoGenderModel'] as const)
    if (!['face', 'body-intel', 'body-paddle', 'face-intel', 'face-paddle'].includes(merged[field])) merged[field] = DEFAULT_SETTINGS[field];
  if (!['regions', 'whole-body', 'whole-body-face'].includes(merged.imageCoverage)) merged.imageCoverage = DEFAULT_SETTINGS.imageCoverage;
  if (!['any', 'face', 'person', 'either', 'both'].includes(merged.imageDetectionGate)) merged.imageDetectionGate = DEFAULT_SETTINGS.imageDetectionGate;
  if (raw.imageRegionFaceEffect === undefined && raw.faceSkin === true) merged.imageRegionFaceEffect = 'black';
  for (const field of ['imageRegionFaceEffect', 'imageWholeBodyFaceEffect'] as const)
    if (!['show', 'black', 'blur', 'checkerboard'].includes(merged[field])) merged[field] = DEFAULT_SETTINGS[field];
  for (const field of ['imageWholeBodyEffect', 'videoEffect'] as const)
    if (!['black', 'blur', 'checkerboard'].includes(merged[field])) merged[field] = DEFAULT_SETTINGS[field];
  if (!['performance', 'balanced', 'quality'].includes(merged.performance)) merged.performance = DEFAULT_SETTINGS.performance;
  const requestedThreads = Number(merged.onnxThreads);
  merged.onnxThreads = merged.onnxThreads === 'auto' ? 'auto'
    : [1, 2, 4, 6, 8, 12, 16].includes(requestedThreads) ? requestedThreads as OnnxThreads : 'auto';
  for (const field of ['yoloImageSize', 'yoloVideoSize'] as const) {
    const value = Number(merged[field]);
    merged[field] = merged[field] === 'auto' ? 'auto'
      : [256, 320, 416].includes(value) ? value as YoloResolution : 'auto';
  }
  const yunetSize = Number(merged.yunetSize);
  merged.yunetSize = [256, 320, 416].includes(yunetSize) ? yunetSize as YunetResolution : 320;
  const faceCaptureSize = Number(merged.faceCaptureSize);
  merged.faceCaptureSize = [320, 416, 512, 640].includes(faceCaptureSize) ? faceCaptureSize as FaceCaptureResolution : 640;
  for (const field of ['imageExpansion', 'videoExpansion'] as const) {
    const value = Number(merged[field]);
    merged[field] = Number.isFinite(value) ? Math.max(0, Math.min(24, Math.round(value))) : DEFAULT_SETTINGS[field];
  }
  for (const field of ['imageEffectIntensity', 'videoEffectIntensity', 'imageFaceEffectIntensity'] as const) {
    const value = Number(merged[field]);
    merged[field] = Number.isFinite(value) ? Math.max(8, Math.min(64, Math.round(value))) : DEFAULT_SETTINGS[field];
  }
  merged.imageEffectGrayscale = merged.imageEffectGrayscale === true;
  merged.videoEffectGrayscale = merged.videoEffectGrayscale === true;
  merged.imageFaceEffectGrayscale = merged.imageFaceEffectGrayscale === true;
  if (!['overlap', 'center'].includes(merged.faceAssociationMode)) merged.faceAssociationMode = DEFAULT_SETTINGS.faceAssociationMode;
  for (const key of ['faceDetectionConfidence', 'genderConfidence', 'smallFaceConfidence', 'faceCoverage', 'centerMaskConfidence', 'yoloConfidence'] as const) {
    const value = Number(merged[key]);
    merged[key] = Number.isFinite(value) ? Math.min(0.99, Math.max(key === 'yoloConfidence' ? 0.01 : 0.1, value)) : DEFAULT_SETTINGS[key];
  }
  const faceMargin = Number(merged.faceMargin);
  merged.faceMargin = Number.isFinite(faceMargin) ? Math.min(0.8, Math.max(0, faceMargin)) : DEFAULT_SETTINGS.faceMargin;
  for (const key of ['minFaceSizePx', 'smallFaceCutoffPx'] as const) {
    const value = Number(merged[key]);
    merged[key] = Number.isFinite(value) ? Math.min(64, Math.max(4, value)) : DEFAULT_SETTINGS[key];
  }
  delete (merged as Settings & { highExposure?: unknown; highSkinThreshold?: unknown; highSkinPeopleLimit?: unknown }).highExposure;
  delete (merged as Settings & { highExposure?: unknown; highSkinThreshold?: unknown; highSkinPeopleLimit?: unknown }).highSkinThreshold;
  delete (merged as Settings & { highExposure?: unknown; highSkinThreshold?: unknown; highSkinPeopleLimit?: unknown }).highSkinPeopleLimit;
  merged.siteExceptions = Array.isArray(merged.siteExceptions)
    ? [...new Set(merged.siteExceptions.filter((x): x is string => typeof x === 'string')
      .map(normalizeSiteException).filter((host): host is string => !!host))].slice(0, 100) : [];
  return merged;
}

export function resolveOnnxThreads(setting: OnnxThreads, logicalCores: number): number {
  if (setting !== 'auto') return setting;
  const cores = Number.isFinite(logicalCores) ? logicalCores : 4;
  return cores <= 4 ? 1 : cores <= 8 ? 2 : 4;
}

export function resolveYoloSize(settings: Settings, kind: 'image' | 'video'): 256 | 320 | 416 {
  const selected = kind === 'image' ? settings.yoloImageSize : settings.yoloVideoSize;
  return selected === 'auto' ? ENGINE.modes[settings.performance][kind === 'image' ? 'input' : 'videoInput'] : selected;
}

export function resolvePersonSize(settings: Settings, kind: 'image' | 'video'): 256 | 320 | 416 {
  return kind === 'video' && settings.videoDetector === 'fast-box' ? 256 : resolveYoloSize(settings, kind);
}
