// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '../src/config/settings';
import { imageAnalysisKey } from '../src/config/imageAnalysis';
import { imageSkinThresholds } from '../src/rules/evaluate';
import { openThresholdFace, skinThresholdMask } from '../src/rendering/skinThreshold';
import type { TrackObservation } from '../src/state/contracts';

function person(id: string, ratio: number, patch: Partial<TrackObservation> = {}): TrackObservation {
  return { id, box: { x: 0, y: 0, width: 1, height: 1 }, label: 'female', labelUsable: true, state: 'active',
    exposure: { ratio, ownedPixels: 100, reliable: true, ambiguousFraction: 0 },
    ownedMask: new Uint8Array(100).fill(255), bodySkinMask: new Uint8Array(100),
    faceSkinMask: new Uint8Array(100), hairMask: new Uint8Array(100), ...patch };
}
function options(patch: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, imageSkinThresholdEnabled: true, imageGroupSkinThresholdEnabled: true, ...patch };
}

describe('skin threshold decisions', () => {
  it('leaves existing coverage unchanged while both rules are disabled', () => {
    expect(imageSkinThresholds(Array.from({ length: 5 }, (_, index) => person(String(index), 1)), DEFAULT_SETTINGS))
      .toEqual({ bodyIds: new Set(), blackImage: false, groupCount: 0 });
  });
  it('blacks bodies strictly above the percentage, including fully exposed bodies', () => {
    expect([...imageSkinThresholds([person('equal', .8), person('above', .81), person('full', 1)], options()).bodyIds])
      .toEqual(['above', 'full']);
  });
  it('counts 70% inclusively but requires more than 3 selected people for a full blackout', () => {
    const people = Array.from({ length: 3 }, (_, index) => person(String(index), .7));
    expect(imageSkinThresholds(people, options()).blackImage).toBe(false);
    expect(imageSkinThresholds([...people, person('below', .699)], options()).blackImage).toBe(false);
    expect(imageSkinThresholds([...people, person('fourth', .7)], options())).toMatchObject({ blackImage: true, groupCount: 4 });
  });
  it('respects selected genders, filter off, and the unclassified-person policy', () => {
    const people = [person('female', .9), person('male', .9, { label: 'male' }),
      person('unknown', .9, { label: 'unknown', labelUsable: false })];
    expect([...imageSkinThresholds(people, options()).bodyIds]).toEqual(['female', 'unknown']);
    expect([...imageSkinThresholds(people, options({ imageUnknown: 'allow' })).bodyIds]).toEqual(['female']);
    expect([...imageSkinThresholds(people, options({ filter: 'male', imageUnknown: 'allow' })).bodyIds]).toEqual(['male']);
    expect(imageSkinThresholds(people, options({ filter: 'off' }))).toEqual({ bodyIds: new Set(), blackImage: false, groupCount: 0 });
  });
  it('never escalates an uncertain, lost, ambiguous or invalid skin measurement', () => {
    const people = [person('uncertain', .9, { exposure: { ratio: .9, ownedPixels: 2, reliable: false, ambiguousFraction: 0 } }),
      person('lost', .9, { state: 'lost' }), person('ambiguous', .9, { state: 'ambiguous' }),
      person('tentative', .9, { state: 'tentative' }), person('invalid', Number.NaN), person('too-high', 1.1)];
    expect(imageSkinThresholds(people, options())).toEqual({ bodyIds: new Set(), blackImage: false, groupCount: 0 });
  });
  it('lets either feature operate independently', () => {
    const people = Array.from({ length: 4 }, (_, index) => person(String(index), .9));
    expect(imageSkinThresholds(people, options({ imageSkinThresholdEnabled: false }))).toMatchObject({ bodyIds: new Set(), blackImage: true });
    expect(imageSkinThresholds(people, options({ imageGroupSkinThresholdEnabled: false })).blackImage).toBe(false);
    expect(imageSkinThresholds(people, options({ bodySkin: false, hair: false })).bodyIds.size).toBe(4);
  });
});

describe('threshold body rendering', () => {
  it('covers the full silhouette and opens semantic and matched faces only when requested', () => {
    const observation = person('a', .9);
    observation.faceSkinMask[25] = 255;
    const silhouette = new Float32Array(100).fill(.9);
    const face = { x: .3, y: .3, width: .3, height: .3 };
    const covered = skinThresholdMask(silhouette, observation, 10, 1, true, [face]);
    const open = skinThresholdMask(silhouette, observation, 10, 1, false, [face]);
    expect(covered[25]).toBe(255);
    expect(covered[44]).toBe(255);
    expect(open[25]).toBe(0);
    expect(open[44]).toBe(0);
    expect(open[88]).toBe(255);
  });
  it('keeps unrelated face effects and pixels outside the silhouette unchanged', () => {
    const observation = person('a', .9);
    observation.faceSkinMask[22] = 255;
    const effect = new Uint8Array(100).fill(255);
    openThresholdFace(effect, observation, 10, []);
    expect(effect[22]).toBe(0);
    expect(effect[88]).toBe(255);
    const silhouette = new Float32Array(100);
    for (let y = 3; y < 7; y++) for (let x = 3; x < 7; x++) silhouette[y * 10 + x] = .9;
    const mask = skinThresholdMask(silhouette, observation, 10, 0, true, []);
    expect(mask[44]).toBe(255);
    expect(mask[0]).toBe(0);
  });
});

describe('threshold settings', () => {
  it('migrates older settings with both new features off and the example defaults', () => {
    const settings = normalizeSettings({ schemaVersion: 15 });
    expect(settings.schemaVersion).toBe(16);
    expect([settings.imageSkinThresholdEnabled, settings.imageGroupSkinThresholdEnabled]).toEqual([false, false]);
    expect([settings.imageSkinThresholdPercent, settings.imageGroupSkinThresholdPercent, settings.imageGroupSkinPeopleLimit]).toEqual([80, 70, 3]);
  });
  it('validates numeric bounds, invalid values, and boolean toggles', () => {
    const settings = normalizeSettings({ imageSkinThresholdPercent: 120, imageGroupSkinThresholdPercent: -5,
      imageGroupSkinPeopleLimit: 999, imageSkinThresholdEnabled: 'true', imageGroupSkinThresholdEnabled: true });
    expect([settings.imageSkinThresholdPercent, settings.imageGroupSkinThresholdPercent, settings.imageGroupSkinPeopleLimit]).toEqual([100, 0, 19]);
    expect([settings.imageSkinThresholdEnabled, settings.imageGroupSkinThresholdEnabled]).toEqual([false, true]);
    expect(normalizeSettings({ imageSkinThresholdPercent: Number.NaN }).imageSkinThresholdPercent).toBe(80);
    expect(normalizeSettings({ imageGroupSkinPeopleLimit: .2 }).imageGroupSkinPeopleLimit).toBe(1);
  });
  it('reuses inference when percentages, group limits, or thresholds with existing face matching change', () => {
    expect(imageAnalysisKey(options({ imageSkinThresholdPercent: 90, imageGroupSkinThresholdPercent: 20, imageGroupSkinPeopleLimit: 8 })))
      .toBe(imageAnalysisKey(DEFAULT_SETTINGS));
  });
  it('reanalyzes when excluding a threshold face newly requires matching in either image mode', () => {
    for (const imageCoverage of ['regions', 'whole-body-face'] as const) {
      const settings = { ...DEFAULT_SETTINGS, automaticGender: false, imageCoverage };
      expect(imageAnalysisKey({ ...settings, imageSkinThresholdEnabled: true })).not.toBe(imageAnalysisKey(settings));
      expect(imageAnalysisKey({ ...settings, imageSkinThresholdEnabled: true, imageSkinThresholdIncludeFace: true }))
        .toBe(imageAnalysisKey(settings));
    }
  });
});
