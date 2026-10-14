// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { resolveYoloSize, type Settings } from './settings';
import { hasBodyCoverage, hasFaceEffects } from './personPolicy';

/** Settings that can change image detections, associations, or automatic labels.
 * Rendering options and video-only options do not invalidate image inference. */
export function imageAnalysisKey(settings: Settings): string {
  return JSON.stringify([
    resolveYoloSize(settings, 'image'), settings.onnxThreads,
    settings.imageCoverage, settings.imageDetectionGate,
    settings.imageCoverage === 'regions' && hasBodyCoverage(settings) ? settings.imageBodyRegionMode : 'off',
    hasFaceEffects(settings), settings.imageWholeBodyFaceEffect !== 'show',
    settings.automaticGender, settings.imageGenderModel,
    settings.faceAssociation, settings.faceAssociationMode, settings.debugOverlay,
    settings.imageSkinThresholdEnabled && !settings.imageSkinThresholdIncludeFace &&
      settings.imageCoverage !== 'whole-body' && (settings.imageCoverage !== 'regions' || !hasFaceEffects(settings)) &&
      !(settings.automaticGender && settings.imageGenderModel.startsWith('face')) && !settings.faceAssociation && !settings.debugOverlay,
    settings.yunetSize, settings.faceCaptureSize, settings.faceDetectionConfidence,
    settings.minFaceSizePx, settings.genderConfidence, settings.smallFaceCutoffPx,
    settings.smallFaceConfidence, settings.faceCoverage, settings.faceMargin,
    settings.centerMaskConfidence, settings.yoloConfidence,
  ]);
}
