export type Label = 'female' | 'male' | 'unknown';
export type FilterMode = 'female' | 'male' | 'both' | 'off';
export type UnknownPolicy = 'selected' | 'allow';
export type PerformanceMode = 'performance' | 'balanced' | 'quality';
export type OnnxThreads = 'auto' | 1 | 2 | 4 | 6 | 8 | 12 | 16;
export type YoloResolution = 'auto' | 256 | 320 | 416;
export type YunetResolution = 256 | 320 | 416;
export type FaceCaptureResolution = 320 | 416 | 512 | 640;
export type FaceAssociationMode = 'overlap' | 'center';

export interface Settings {
  schemaVersion: 8;
  revision: number;
  enabled: boolean;
  images: boolean;
  videos: boolean;
  filter: FilterMode;
  unknown: UnknownPolicy;
  bodySkin: boolean;
  hair: boolean;
  faceSkin: boolean;
  automaticGender: boolean;
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
  schemaVersion: 8,
  revision: 0,
  enabled: true,
  images: true,
  videos: true,
  filter: 'female',
  unknown: 'selected',
  bodySkin: true,
  hair: true,
  faceSkin: false,
  automaticGender: true,
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
  lostTrackMs: 1000,
  maxActiveVideos: 2,
  modes: {
    performance: { input: 256, videoInput: 256, initialHz: 3, maxHz: 4 },
    balanced: { input: 320, videoInput: 256, initialHz: 4, maxHz: 6 },
    quality: { input: 416, videoInput: 320, initialHz: 6, maxHz: 8 },
  },
} as const;

export function normalizeSettings(value: unknown): Settings {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Settings>;
  const merged = { ...DEFAULT_SETTINGS, ...raw };
  merged.schemaVersion = 8;
  if (!['female', 'male', 'both', 'off'].includes(merged.filter)) merged.filter = DEFAULT_SETTINGS.filter;
  if (!['selected', 'allow'].includes(merged.unknown)) merged.unknown = DEFAULT_SETTINGS.unknown;
  if ((raw as { unknown?: string }).unknown === 'whole') merged.unknown = 'selected';
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
  merged.siteExceptions = Array.isArray(merged.siteExceptions) ? merged.siteExceptions.filter((x): x is string => typeof x === 'string').map(x => x.trim().toLowerCase()).filter(Boolean).slice(0, 100) : [];
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
