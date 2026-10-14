// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '../src/config/settings';
import { editablePolicies, faceStrength, genderPolicy, groupedBodySkin, policyFor, uniformPolicy } from '../src/config/personPolicy';
import { personSelected, selectedMask } from '../src/rules/evaluate';
import { compose } from '../src/rendering/compositor';
import { regionCoverage } from '../src/rendering/regionCoverage';
import { imageAnalysisKey } from '../src/config/imageAnalysis';
import { decodeBodyRegions } from '../src/vision/bodyRegionMap';
import type { Track, TrackObservation } from '../src/state/contracts';

const policies = () => ({ female: uniformPolicy('hide'), male: uniformPolicy('show') });
describe('face strength', () => {
  it('migrates the shared strength and validates independent gender values without repeating inference', () => {
    const value = policies(); value.female.face = value.male.face = 'blur';
    const original = normalizeSettings({ personPolicies: value, imageFaceEffectIntensity: 30 });
    expect(faceStrength(original, genderPolicy(original, 'male'))).toBe(30);
    value.male.faceStrength = 99; value.female.faceStrength = 14;
    const changed = normalizeSettings({ ...original, personPolicies: value });
    expect(faceStrength(changed, genderPolicy(changed, 'male'))).toBe(64);
    expect(faceStrength(changed, genderPolicy(changed, 'female'))).toBe(14);
    expect(faceStrength(changed, policyFor(changed, { label: 'unknown', labelUsable: false }))).toBe(64);
    expect(imageAnalysisKey(changed)).toBe(imageAnalysisKey(original));
  });
});
const person = (label: 'male' | 'female'): TrackObservation => ({ id: label, label, labelUsable: true, state: 'active',
  box: { x: 0, y: 0, width: 1, height: 1 }, ownedMask: new Uint8Array(10).fill(255),
  bodySkinMask: Uint8Array.from([0, 0, 255, 255, 255, 255, 255, 255, 255, 255]), hairMask: Uint8Array.from([255, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  faceSkinMask: Uint8Array.from([0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), exposure: { ratio: .8, reliable: true, ownedPixels: 10, ambiguousFraction: 0 } });
const fixtureTrack = (id: string, label: 'male' | 'female', side: number, predicate: (x: number, y: number) => boolean): Track => ({
  id, label, labelUsable: true, state: 'active', labelSource: 'user', genderConfidence: 1, genderEvidence: 1,
  mask: Float32Array.from({ length: side * side }, (_, i) => predicate(i % side, Math.floor(i / side)) ? .9 : 0),
  maskWidth: side, maskHeight: side, box: { x: .1, y: .1, width: .8, height: .8 }, score: .9, firstSeen: 1, lastSeen: 1,
  hits: 3, identityGeneration: 0, velocityX: 0, velocityY: 0 });
describe('diagram policies and expansion', () => {
  it('groups body skin while preserving independent hair, face and video choices', () => {
    const policy = { ...uniformPolicy('show'), hair: 'hide' as const, face: 'blur' as const, video: 'checkerboard' as const };
    const hidden = groupedBodySkin(policy, 'hide');
    expect(Object.values(hidden.skin).every(value => value === 'hide')).toBe(true);
    const shown = groupedBodySkin(hidden, 'show');
    expect(Object.values(shown.skin).every(value => value === 'show')).toBe(true);
    expect([shown.hair, shown.face, shown.video]).toEqual(['hide', 'blur', 'checkerboard']);
  });
  it('covers both upper arms without covering either forearm, front and back', () => {
    const value = policies(); value.male.skin['upper-arms'] = 'hide';
    const settings = { ...DEFAULT_SETTINGS, personPolicies: value };
    for (const channel of [2, 3, 4, 5, 6, 7, 8, 9]) {
      const logits = new Float32Array(96).fill(-10); logits.fill(10, channel * 4, channel * 4 + 4);
      const regions = decodeBodyRegions(logits, new Float32Array(4).fill(3), 2, new Uint8Array(4).fill(2), 2);
      const modelPerson = { ...person('male'), ownedMask: new Uint8Array(4).fill(255), bodySkinMask: new Uint8Array(4).fill(255), hairMask: new Uint8Array(4) };
      expect([...selectedMask(modelPerson, settings, regions)], `BodyPix channel ${channel}`).toEqual(new Array(4).fill(channel <= 5 ? 255 : 0));
    }
  });
  it('hides only male thighs and leaves hair, neck, torso, hands and unknown skin visible', () => {
    const value = policies(); value.male.skin.thighs = 'hide';
    const settings = { ...DEFAULT_SETTINGS, personPolicies: value };
    const map = Uint8Array.from([0, 0, 8, 1, 2, 3, 4, 5, 6, 0]);
    expect([...selectedMask(person('male'), settings, map)]).toEqual([0, 0, 0, 0, 0, 0, 0, 255, 0, 0]);
    expect([...selectedMask(person('female'), settings, map)]).toEqual([255, 0, 255, 255, 255, 255, 255, 255, 255, 255]);
  });
  it('a shown person has no body/hair coverage even after model failure', () => {
    const settings = { ...DEFAULT_SETTINGS, filter: 'both' as const, hair: true, personPolicies: policies() };
    expect(personSelected(person('male'), settings, 'image')).toBe(false);
    expect(selectedMask(person('male'), settings).some(Boolean)).toBe(false);
  });
  it('uses each gender video action independently of the old filter', () => {
    const settings = { ...DEFAULT_SETTINGS, filter: 'off' as const, personPolicies: policies() };
    expect(personSelected(person('female'), settings, 'video')).toBe(true);
    expect(personSelected(person('male'), settings, 'video')).toBe(false);
  });
  it('does not paint a semantic halo around a fully shown man at maximum expansion', () => {
    const side = 32, track = fixtureTrack('male', 'male', side, (x, y) => x >= 10 && x < 22 && y >= 7 && y < 26);
    const semantic = Uint8Array.from({ length: side * side }, (_, i) => { const x = i % side, y = Math.floor(i / side);
      return x >= 8 && x < 24 && y >= 5 && y < 28 ? (y < 9 ? 1 : y < 12 ? 3 : 2) : 0; });
    const settings: Settings = { ...DEFAULT_SETTINGS, personPolicies: policies(), imageExpansion: 24 };
    const map = new Uint8Array(side * side).fill(1);
    const composition = compose([track], semantic, side, side, settings, 'regions', map);
    expect(regionCoverage(composition, [track], settings, side, map).some(Boolean)).toBe(false);
  });
  it('expands hidden thighs without repainting shown torso, neck or hair', () => {
    const side = 32, track = fixtureTrack('male', 'male', side, (x, y) => x >= 5 && x < 27 && y >= 3 && y < 29);
    const semantic = Uint8Array.from(track.mask, (_, i) => track.mask[i] ? (i < side * 8 ? 1 : 2) : 0);
    const regions = Uint8Array.from(track.mask, (_, i) => i >= side * 18 && i < side * 25 ? 5 : i < side * 10 ? 8 : 1);
    const value = policies(); value.male.skin.thighs = 'hide';
    const settings = { ...DEFAULT_SETTINGS, personPolicies: value, imageExpansion: 12 };
    const composition = compose([track], semantic, side, side, settings, 'regions', regions);
    const mask = regionCoverage(composition, [track], settings, side, regions);
    expect(mask[20 * side + 16]).toBe(255);
    for (const y of [5, 9, 15]) expect(mask[y * side + 16]).toBe(0);
  });
  it('keeps genuinely hidden pixels where another person overlaps', () => {
    const side = 16, a = fixtureTrack('male', 'male', side, x => x < 12), b = fixtureTrack('female', 'female', side, x => x > 7);
    const settings = { ...DEFAULT_SETTINGS, personPolicies: policies(), imageExpansion: 8 };
    const semantic = new Uint8Array(side * side).fill(2), regions = new Uint8Array(side * side).fill(1);
    const composition = compose([a, b], semantic, side, side, settings, 'regions', regions);
    const mask = regionCoverage(composition, [a, b], settings, side, regions);
    expect(mask[8 * side + 10]).toBe(255); expect(mask[8 * side + 3]).toBe(0);
  });
  it('migrates old all-area exemptions into shown hair and neck, with independent copies', () => {
    const current = { ...DEFAULT_SETTINGS, filter: 'both' as const, imageBodyRegionMode: 'finer' as const,
      imageMaleAllowedRegions: ['torso', 'upper-arms', 'forearms', 'hands', 'thighs', 'lower-legs', 'feet'] as Settings['imageMaleAllowedRegions'] };
    expect(genderPolicy(current, 'male').hair).toBe('show'); expect(genderPolicy(current, 'male').skin.neck).toBe('show');
    const edited = editablePolicies(current); edited.male.skin.torso = 'hide'; expect(genderPolicy(current, 'male').skin.torso).toBe('show');
  });
  it('validates policy actions and reuses inference for area and face-effect changes', () => {
    const value = policies(), settings = normalizeSettings({ personPolicies: value, imageBodyRegionMode: 'finer' });
    const changed = structuredClone(settings); changed.personPolicies!.male.skin.thighs = 'hide'; changed.personPolicies!.female.face = 'blur';
    expect(imageAnalysisKey(changed)).toBe(imageAnalysisKey(settings));
    expect(normalizeSettings({ personPolicies: { male: { skin: { thighs: 'bad' }, hair: 'bad', face: 'bad' } } }).personPolicies!.male.skin.thighs).toBe('hide');
  });
});
