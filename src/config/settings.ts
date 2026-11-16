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
export type BodyRegionMode = 'off' | 'faster' | 'finer';
// Append new regions to preserve existing numeric model/debug IDs.
export const BODY_REGIONS = ['torso', 'upper-arms', 'forearms', 'hands', 'thighs', 'lower-legs', 'feet', 'neck', 'groin', 'chest', 'belly'] as const;
export type BodyRegion = typeof BODY_REGIONS[number];
export type RuleOperator = 'above' | 'at-least' | 'below' | 'at-most' | 'any' | 'none';
export interface RuleCondition { areas: BodyRegion[]; operator: RuleOperator; percent: number }
export interface PartThreshold { area: BodyRegion; areas?: BodyRegion[]; percent: number; condition?: 'above' | 'any'; conditions?:RuleCondition[]; match?:'all'|'any'; coverAreas?:BodyRegion[]; name?:string; presetKey?:string; enabled?: boolean; effect?: 'black' | 'smart'; target: 'part' | 'body' | 'skin'; face?: 'show' | 'black' }
function normalizeRuleConditions(value:unknown[]):RuleCondition[]{
  if(!value.length||value.length>8)return [];
  const result:RuleCondition[]=[];
  for(const raw of value){
    if(!raw||typeof raw!=='object')return [];
    const clause=raw as Partial<RuleCondition>,areas=Array.isArray(clause.areas)?BODY_REGIONS.filter(area=>clause.areas!.includes(area)):[],operator=clause.operator,percent=Number(clause.percent??0);
    if(!areas.length||!['above','at-least','below','at-most','any','none'].includes(String(operator))||!Number.isFinite(percent))return [];
    result.push({areas,operator:operator!,percent:Math.max(0,Math.min(100,Math.round(percent)))});
  }
  return result;
}
export type SkinAction = 'show' | 'hide';
export type PersonArea = BodyRegion | 'hair' | 'face' | 'body' | 'other-skin';
export interface PersonPolicy {
  partThresholds?: PartThreshold[];
  skin: Record<BodyRegion, SkinAction>;
  otherSkin: SkinAction;
  hair: SkinAction;
  face: FaceEffect;
  faceStrength?: number;
  video: FaceEffect;
  videoSkin?: SkinAction;
  videoHair?: SkinAction;
  videoFace?: SkinAction;
}
export type PersonPolicies = Record<'female' | 'male', PersonPolicy>;

export interface Settings {
  schemaVersion: 21;
  expansionUnit?: 'person';
  revision: number;
  enabled: boolean;
  images: boolean;
  thumbnailFallback: boolean;
  pdfs:boolean;
  videos: boolean;
  videoPlayback: VideoPlayback;
  videoDetector: VideoDetector;
  advancedVideoMode: boolean;
  fabricFill: boolean;
  videoSkinExpansion: number;
  filter: FilterMode;
  /** Legacy fields remain readable; diagram policies take precedence once edited. */
  personPolicies?: PersonPolicies;
  imageUnknown: UnknownPolicy;
  videoUnknown: UnknownPolicy;
  bodySkin: boolean;
  imageBodyRegionMode: BodyRegionMode;
  imageFemaleAllowedRegions: BodyRegion[];
  imageMaleAllowedRegions: BodyRegion[];
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
  schemaVersion: 21,
  expansionUnit: 'person',
  revision: 0,
  enabled: true,
  images: true,
  thumbnailFallback: true,
  pdfs:true,
  videos: true,
  videoPlayback: 'smooth',
  videoDetector: 'segment',
  advancedVideoMode: false,
  fabricFill: false,
  videoSkinExpansion: 2,
  filter: 'female',
  imageUnknown: 'selected',
  videoUnknown: 'selected',
  bodySkin: true,
  imageBodyRegionMode: 'off',
  imageFemaleAllowedRegions: [],
  imageMaleAllowedRegions: [],
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
  imageExpansion: .5,
  videoExpansion: 2,
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
  merged.schemaVersion = 21;
  merged.expansionUnit = 'person';
  merged.thumbnailFallback = raw.thumbnailFallback !== false;
  merged.pdfs=raw.pdfs!==false;
  if (raw.personPolicies && typeof raw.personPolicies === 'object') {
    const policies = {} as PersonPolicies;
    for (const gender of ['female', 'male'] as const) {
      const value = raw.personPolicies[gender];
      const action = (input: unknown): SkinAction => input === 'show' ? 'show' : 'hide';
      const effect = (input: unknown): FaceEffect => ['show', 'black', 'blur', 'checkerboard'].includes(String(input)) ? input as FaceEffect : 'show';
      // The pelvis previously belonged to torso: inherit that saved action
      // until the user chooses groin explicitly, including old Show-all policies.
      policies[gender] = { skin: Object.fromEntries(BODY_REGIONS.map(area => [area, action(
        ['groin', 'chest', 'belly'].includes(area) && value?.skin?.[area] === undefined ? value?.skin?.torso : value?.skin?.[area])])) as PersonPolicy['skin'],
        partThresholds: Array.isArray(value?.partThresholds) ? value.partThresholds.filter(rule => rule &&
          !['modesty-gaps','modesty-chest','modesty-torso','modesty-swimwear','modesty-legs-arms'].includes(rule.presetKey??'') &&
          BODY_REGIONS.includes(rule.area) && ['part', 'body', 'skin'].includes(rule.target) && Number.isFinite(Number(rule.percent)))
          .slice(0, 32).map(rule => ({ area: rule.area,
            ...(typeof rule.name === 'string' ? {name:rule.name.trim().slice(0,80)} : {}),
            ...(Array.isArray(rule.conditions) ? {conditions:normalizeRuleConditions(rule.conditions),match:rule.match==='any'?'any' as const:'all' as const} : {}),
            ...(Array.isArray(rule.coverAreas) ? {coverAreas:BODY_REGIONS.filter(area=>rule.coverAreas!.includes(area))} : {}), ...(Array.isArray(rule.areas) ? { areas: BODY_REGIONS.filter(area => rule.areas!.includes(area)) } : {}), enabled: rule.enabled !== false, condition: rule.condition === 'any' ? 'any' as const : 'above' as const, effect: rule.effect === 'smart' ? 'smart' as const : 'black' as const, target: rule.target, percent: Math.max(0, Math.min(100, Math.round(Number(rule.percent)))),
            ...(rule.target === 'body' ? { face: rule.face === 'show' ? 'show' as const : 'black' as const } : {}) })) : [],
        ...(value?.videoSkin === 'show' || value?.videoSkin === 'hide' ? { videoSkin: value.videoSkin } : {}),
        ...(value?.videoHair === 'show' || value?.videoHair === 'hide' ? { videoHair: value.videoHair } : {}),
        ...(value?.videoFace === 'show' || value?.videoFace === 'hide' ? { videoFace: value.videoFace } : {}),
        otherSkin: action(value?.otherSkin), hair: action(value?.hair), face: effect(value?.face), video: effect(value?.video),
        ...(value?.faceStrength !== undefined && Number.isFinite(Number(value.faceStrength))
          ? { faceStrength: Math.max(8, Math.min(64, Math.round(Number(value.faceStrength)))) } : {}) };
    }
    merged.personPolicies = policies;
  } else delete merged.personPolicies;
  if (!['off', 'faster', 'finer'].includes(merged.imageBodyRegionMode)) merged.imageBodyRegionMode = 'off';
  for (const field of ['imageFemaleAllowedRegions', 'imageMaleAllowedRegions'] as const) {
    const allowed = merged[field];
    merged[field] = Array.isArray(allowed) ? BODY_REGIONS.filter(region => allowed.includes(region) ||
      ['chest', 'belly'].includes(region) && allowed.includes('torso') ||
      region === 'groin' && (raw.schemaVersion ?? 0) < 20 && allowed.includes('torso')) : [];
  }
  // Removed exposure rules must not survive invisibly in saved profiles.
  merged.imageSkinThresholdEnabled = false;
  merged.imageGroupSkinThresholdEnabled = false;
  merged.imageSkinThresholdIncludeFace = false;
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
  merged.advancedVideoMode = raw.advancedVideoMode === true;
  merged.fabricFill = raw.fabricFill === true;
  for (const field of ['imageGenderModel', 'videoGenderModel'] as const)
    if (!['face', 'body-intel', 'body-paddle', 'face-intel', 'face-paddle'].includes(merged[field])) merged[field] = DEFAULT_SETTINGS[field];
  if (merged.imageCoverage === 'whole-body-face') merged.imageCoverage = 'whole-body';
  if (!['regions', 'whole-body'].includes(merged.imageCoverage)) merged.imageCoverage = DEFAULT_SETTINGS.imageCoverage;
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
  for (const field of ['imageExpansion', 'videoExpansion', 'videoSkinExpansion'] as const) {
    const value = Number(merged[field]);
    merged[field] = Number.isFinite(value) ? Math.max(0, Math.min(12, Math.round((raw.expansionUnit === 'person' ? value : raw[field] === undefined ? DEFAULT_SETTINGS[field] : value / 2) * 4) / 4)) : DEFAULT_SETTINGS[field];
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
