// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '../src/config/settings';
import { imageAnalysisKey } from '../src/config/imageAnalysis';
import { selectedMask } from '../src/rules/evaluate';
import { bodyRegionsEnabled, decodeBodyRegions } from '../src/vision/bodyRegionMap';
import type { TrackObservation } from '../src/state/contracts';

const settings: Settings = { ...DEFAULT_SETTINGS, filter: 'both', imageBodyRegionMode: 'finer',
  imageMaleAllowedRegions: ['torso'], imageFemaleAllowedRegions: ['upper-arms', 'forearms', 'hands'] };
const observation = (label: TrackObservation['label'], usable = true): TrackObservation => ({
  id: 'fixture', box: { x: 0, y: 0, width: 1, height: 1 }, label, labelUsable: usable, state: 'active',
  exposure: { ratio: 1, reliable: true, ownedPixels: 8, ambiguousFraction: 0 },
  ownedMask: new Uint8Array(8).fill(255), bodySkinMask: new Uint8Array(8).fill(255),
  hairMask: new Uint8Array(8), faceSkinMask: new Uint8Array(8),
});
describe('optional image body-region policies', () => {
  it('migrates old settings with the feature off and validates independent allowlists', () => {
    expect(normalizeSettings({ schemaVersion: 16 }).imageBodyRegionMode).toBe('off');
    const parsed = normalizeSettings({ imageBodyRegionMode: 'bad', imageFemaleAllowedRegions: ['thighs', 'thighs', 'belly'], imageMaleAllowedRegions: 'torso' });
    expect(parsed.schemaVersion).toBe(19); expect(parsed.imageBodyRegionMode).toBe('off');
    expect(parsed.imageFemaleAllowedRegions).toEqual(['thighs']); expect(parsed.imageMaleAllowedRegions).toEqual([]);
  });
  it('allows a male torso but covers thighs; female arms stay visible while torso is covered', () => {
    const regions = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 0]);
    expect([...selectedMask(observation('male'), settings, regions)]).toEqual([0, 255, 255, 255, 255, 255, 255, 255]);
    expect([...selectedMask(observation('female'), settings, regions)]).toEqual([255, 0, 0, 0, 255, 255, 255, 255]);
  });
  it('never grants region exemptions to unclassified people, missing maps, or unknown pixels', () => {
    const regions = new Uint8Array(8).fill(1);
    for (const person of [observation('unknown'), observation('male', false)])
      expect([...selectedMask(person, settings, regions)]).toEqual(new Array(8).fill(255));
    expect([...selectedMask(observation('male'), settings)]).toEqual(new Array(8).fill(255));
    expect([...selectedMask(observation('male'), settings, new Uint8Array(8))]).toEqual(new Array(8).fill(255));
  });
  it('preserves people filtering and hair coverage without censoring clothes', () => {
    const person = observation('male'); person.bodySkinMask.fill(0); person.hairMask[0] = 255;
    expect([...selectedMask(person, settings, new Uint8Array(8).fill(1))]).toEqual([255, 0, 0, 0, 0, 0, 0, 0]);
    expect([...selectedMask(person, { ...settings, filter: 'female' }, new Uint8Array(8))]).toEqual(new Array(8).fill(0));
  });
  it('runs only for image skin coverage and does not invalidate inference for allowlist edits', () => {
    expect(bodyRegionsEnabled(settings, 'video')).toBe(false);
    expect(bodyRegionsEnabled({ ...settings, imageCoverage: 'whole-body' }, 'image')).toBe(false);
    expect(bodyRegionsEnabled({ ...settings, bodySkin: false }, 'image')).toBe(false);
    expect(bodyRegionsEnabled(settings, 'image')).toBe(true);
    expect(imageAnalysisKey(settings)).toBe(imageAnalysisKey({ ...settings, imageMaleAllowedRegions: ['thighs'] }));
    expect(imageAnalysisKey(settings)).not.toBe(imageAnalysisKey({ ...settings, imageBodyRegionMode: 'faster' }));
  });
});
describe('direct dense output decoding', () => {
  it('maps a learned forearm/thigh boundary without any pose and decodes skin only', () => {
    const parts = new Float32Array(24 * 4).fill(-10);
    parts.set([5, -5, 5, -5], 6 * 4); // left forearm at left edge
    parts.set([-5, 5, -5, 5], 14 * 4); // thigh at right edge
    const semantic = new Uint8Array(9).fill(2); semantic[1] = 4;
    const map = decodeBodyRegions(parts, new Float32Array(4).fill(3), 2, semantic, 3);
    expect(map[0]).toBe(3); expect(map[2]).toBe(5); expect(map[1]).toBe(0);
  });
  it('retains unknown regions on missing foreground or invalid logits', () => {
    const parts = new Float32Array(96).fill(-10); parts.fill(10, 48, 52);
    expect([...decodeBodyRegions(parts, new Float32Array(4).fill(-1), 2, new Uint8Array(4).fill(2), 2)]).toEqual([0, 0, 0, 0]);
    parts[0] = NaN;
    expect(decodeBodyRegions(parts, new Float32Array(4).fill(2), 2, new Uint8Array(4).fill(2), 2)[0]).toBe(0);
    expect(() => decodeBodyRegions(parts, new Float32Array(3), 2, new Uint8Array(4), 2)).toThrow('grid mismatch');
  });
});
