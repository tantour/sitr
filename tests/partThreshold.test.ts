// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '../src/config/settings';
import { hasBodyCoverage, hasImageCoverage, policyFor, uniformPolicy } from '../src/config/personPolicy';
import { compose } from '../src/rendering/compositor';
import { regionCoverage } from '../src/rendering/regionCoverage';
import { partThresholdCoverage, partThresholdMask } from '../src/rendering/partThreshold';
import { imageAnalysisKey } from '../src/config/imageAnalysis';
import { splitTorso, torsoAxes } from '../src/vision/torso';
import { decodeBodyRegions } from '../src/vision/bodyRegionMap';
import type { Track } from '../src/state/contracts';

function fixture(skin = 51, target: 'part' | 'body' = 'part') {
  const side = 20, n = side * side;
  const male = uniformPolicy('show'); male.partThresholds = [{ area: 'chest', percent: 50, target }];
  const settings: Settings = { ...DEFAULT_SETTINGS, imageExpansion: 0, imageBodyRegionMode: 'faster',
    personPolicies: { male, female: uniformPolicy('show') } };
  const track = { id: 'one', label: 'male', labelUsable: true, state: 'active', mask: new Float32Array(n).fill(.95),
    maskWidth: side, maskHeight: side, box: { x: 0, y: 0, width: 1, height: 1 } } as Track;
  const semantic = new Uint8Array(n).fill(4); semantic.fill(2, 0, skin);
  const regions = new Uint8Array(n).fill(11); regions.fill(10, 0, 100);
  const composition = compose([track], semantic, side, side, settings, 'regions', regions);
  return { settings, track, composition, regions, side };
}

describe('per-part skin thresholds', () => {
  it('uses clothed part area as denominator, with strictly-above boundaries', () => {
    for (const [skin, expected] of [[0, 0], [49, 0], [50, 0], [51, 100], [100, 100]]) {
      const f = fixture(skin);
      expect(partThresholdMask(f.composition.observations, f.settings, f.regions)!.filter(Boolean).length).toBe(expected);
    }
  });
  it('covers the entire clothed part or full owned body, including the face', () => {
    for (const [target, count] of [['part', 100], ['body', 400]] as const) {
      const f = fixture(51, target);
      expect(regionCoverage(f.composition, [f.track], f.settings, f.side, f.regions).filter(Boolean)).toHaveLength(count);
    }
  });
  it('respects off, missing map, uncertain people, and unclassified Show', () => {
    const f = fixture();
    expect(partThresholdMask(f.composition.observations, f.settings)).toBeUndefined();
    expect(partThresholdMask(f.composition.observations, { ...f.settings, imageBodyRegionMode: 'off' }, f.regions)).toBeUndefined();
    f.composition.observations[0].exposure.reliable = false;
    expect(partThresholdMask(f.composition.observations, f.settings, f.regions)!.some(Boolean)).toBe(false);
    f.composition.observations[0].exposure.reliable = true;
    f.composition.observations[0].labelUsable = false;
    expect(partThresholdMask(f.composition.observations, { ...f.settings, imageUnknown: 'allow' }, f.regions)!.some(Boolean)).toBe(false);
  });
  it('never borrows another person’s anatomy or skin', () => {
    const f = fixture(); const person = f.composition.observations[0];
    person.ownedMask.fill(0, 0, 51);
    expect(partThresholdMask([person], f.settings, f.regions)!.some(Boolean)).toBe(false);
  });
  it('keeps threshold-only people selected and combines unknown policies', () => {
    const f = fixture(); const policy = f.settings.personPolicies!.male;
    expect(hasImageCoverage(policy)).toBe(true); expect(hasBodyCoverage(f.settings)).toBe(true);
    expect(policyFor(f.settings, { label: 'unknown', labelUsable: false }).partThresholds).toEqual(policy.partThresholds);
    const changed = structuredClone(f.settings); changed.personPolicies!.male.partThresholds![0].percent = 70;
    expect(imageAnalysisKey(changed)).toBe(imageAnalysisKey(f.settings));
  });
  it('validates rules and migrates chest/belly from saved torso actions', () => {
    const old = uniformPolicy('show');
    delete (old.skin as Partial<typeof old.skin>).chest; delete (old.skin as Partial<typeof old.skin>).belly;
    const settings = normalizeSettings({ personPolicies: { male: { ...old, partThresholds: [
      { area: 'belly', percent: 180, target: 'body' }, { area: 'invalid', percent: 50, target: 'part' },
      { area: 'chest', percent: NaN, target: 'part' },
    ] } } });
    expect(settings.personPolicies!.male.skin.chest).toBe('show'); expect(settings.personPolicies!.male.skin.belly).toBe('show');
    expect(settings.personPolicies!.male.partThresholds).toEqual([{ area: 'belly', percent: 100, target: 'body', face: 'black' }]);
  });
  it('opens shown faces after expansion while leaving black faces covered', () => {
    for (const face of ['show', 'black'] as const) {
      const f = fixture(51, 'body'); f.settings.imageExpansion = 3;
      f.settings.personPolicies!.male.partThresholds![0].face = face;
      const person = f.composition.observations[0]; person.faceSkinMask[300] = 255;
      const coverage = partThresholdCoverage([person], f.settings, f.regions, f.side)!;
      expect(coverage.mask[300]).toBe(face === 'show' ? 0 : 255);
      expect(coverage.mask[301]).toBe(255);
      expect(coverage.showFaceIds.has(person.id)).toBe(face === 'show');
      expect(partThresholdMask([person], f.settings, f.regions)![300]).toBe(face === 'show' ? 0 : 255);
    }
  });
  it('uses associated face boxes and black wins when several body rules trigger', () => {
    const f = fixture(51, 'body'), rules = f.settings.personPolicies!.male.partThresholds!;
    rules[0].face = 'show';
    const coverage = () => partThresholdCoverage(f.composition.observations, f.settings, f.regions, f.side,
      () => [{ x: .4, y: .65, width: .2, height: .2 }])!;
    expect(coverage().mask[15 * f.side + 10]).toBe(0);
    rules.push({ area: 'chest', percent: 50, target: 'body', face: 'black' });
    expect(coverage().mask[15 * f.side + 10]).toBe(255);
  });
  it('requests new face matching only when a face opening is enabled', () => {
    const f = fixture(51, 'body'), original = imageAnalysisKey(f.settings);
    f.settings.personPolicies!.male.partThresholds![0].face = 'show';
    expect(imageAnalysisKey(f.settings)).not.toBe(original);
    const normalized = normalizeSettings(f.settings);
    expect(normalized.personPolicies!.male.partThresholds![0].face).toBe('show');
  });
});

describe('orientation-aware chest/belly halves', () => {
  it.each([0, Math.PI / 6, Math.PI / 2, Math.PI, -Math.PI / 2])('splits dense anatomy at rotation %s including lying down and inverted', angle => {
    const grid = 41, c = Math.cos(angle), s = Math.sin(angle);
    const world = (x: number, y: number) => ({ x: .5 + x * c - y * s, y: .5 + x * s + y * c });
    const labels = Uint8Array.from({ length: grid * grid }, (_, p) => {
      const px = p % grid / (grid - 1) - .5, py = Math.floor(p / grid) / (grid - 1) - .5;
      const x = px * c + py * s, y = -px * s + py * c;
      return Math.abs(x) <= .12 ? y >= -.25 && y <= .15 ? 13 : y > .15 && y < .4 ? 15 : 0 : 0;
    });
    const person = { mask: new Float32Array(grid * grid).fill(.95), maskWidth: grid, maskHeight: grid };
    const axis = torsoAxes(labels, grid, [person], [undefined])[0];
    expect(axis).toBeDefined();
    const chest = world(0, -.17), belly = world(0, .08);
    expect(splitTorso(chest.x, chest.y, axis)).toBe(10); expect(splitTorso(belly.x, belly.y, axis)).toBe(11);
    const parts = new Float32Array(24 * grid * grid).fill(-10), fg = new Float32Array(grid * grid).fill(-10);
    labels.forEach((id, p) => { if (id) { parts[(id - 1) * grid * grid + p] = 10; fg[p] = 10; } });
    const map = decodeBodyRegions(parts, fg, grid, new Uint8Array(grid * grid).fill(4), grid, [person], undefined, undefined, true);
    const at = (point: { x: number; y: number }) => map[Math.round(point.y * (grid - 1)) * grid + Math.round(point.x * (grid - 1))];
    expect(at(chest)).toBe(10); expect(at(belly)).toBe(11);
  });
  it('retains unresolved torso when anatomy is absent or belongs to overlapping people', () => {
    expect(splitTorso(.5, .5)).toBe(1);
    const person = { mask: new Float32Array(9).fill(.95), maskWidth: 3, maskHeight: 3 };
    expect(torsoAxes(new Uint8Array(9).fill(13), 3, [person, person], [])).toEqual([undefined, undefined]);
  });
});
