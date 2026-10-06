// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/config/settings';
import { imageAnalysisKey } from '../src/config/imageAnalysis';

it('retains image inference across rendering and video-only changes', () => {
  expect(imageAnalysisKey({ ...DEFAULT_SETTINGS, revision: 55, videoGenderModel: 'body-paddle',
    videoDetector: 'fast-box', yoloVideoSize: 416, filter: 'male', hair: false,
    imageExpansion: 5, imageEffectIntensity: 40 })).toBe(imageAnalysisKey(DEFAULT_SETTINGS));
});

it('invalidates image inference for model inputs, thresholds and independent face classification', () => {
  for (const patch of [
    { yoloImageSize: 416 }, { imageGenderModel: 'body-paddle' }, { yoloConfidence: .4 },
    { faceCaptureSize: 512 }, { yunetSize: 416 }, { genderConfidence: .9 },
    { imageWholeBodyFaceEffect: 'blur' }, { imageRegionFaceEffect: 'black' },
    { faceAssociationMode: 'center' }, { imageDetectionGate: 'face' },
  ] as const) {
    expect(imageAnalysisKey({ ...DEFAULT_SETTINGS, ...patch })).not.toBe(imageAnalysisKey(DEFAULT_SETTINGS));
  }
});
