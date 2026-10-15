// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { describe, expect, it } from 'vitest';
import { BODY_REGIONS, DEFAULT_SETTINGS, normalizeSettings } from '../src/config/settings';
import { uniformPolicy } from '../src/config/personPolicy';
import { decodeBodyRegions, regionName } from '../src/vision/bodyRegionMap';
import { estimatePelvis, estimatePosePelvis, pelvicRegion, regionOwner, type RegionPerson } from '../src/vision/pelvis';
import { selectedMask } from '../src/rules/evaluate';
import { compose } from '../src/rendering/compositor';
import { regionCoverage } from '../src/rendering/regionCoverage';
import type { Track } from '../src/state/contracts';

const grid = 41, side = 81;
const fixture = (rotate = 0, offset = 0, legs = true) => {
  const c = Math.cos(rotate), s = Math.sin(rotate);
  const local = (x: number, y: number) => ({ x: (x - .5 - offset) * c + (y - .5) * s + .5,
    y: -(x - .5 - offset) * s + (y - .5) * c + .5 });
  const part = (x: number, y: number) => { const p = local(x, y);
    if (p.x < .36 || p.x > .64) return 0;
    if (p.y >= .2 && p.y <= .56) return 13;
    if (legs && p.y > .56 && p.y <= .85) return p.x < .5 ? 15 : 17;
    return 0;
  };
  const labels = Uint8Array.from({ length: grid * grid }, (_, p) => part(p % grid / (grid - 1), Math.floor(p / grid) / (grid - 1)));
  const person: RegionPerson = { maskWidth: side, maskHeight: side,
    mask: Float32Array.from({ length: side * side }, (_, p) => part(p % side / (side - 1), Math.floor(p / side) / (side - 1)) ? .95 : 0) };
  const point = (x: number, y: number) => ({ x: (x - .5) * c - (y - .5) * s + .5 + offset,
    y: (x - .5) * s + (y - .5) * c + .5 });
  return { labels, person, point };
};

describe('pelvis geometry from existing clothed part predictions', () => {
  it.each([0, Math.PI / 6, Math.PI / 2, Math.PI, -Math.PI / 2])('follows the torso at rotation %s and raises the lateral upper thighs', angle => {
    const { labels, person, point } = fixture(angle), pelvis = estimatePelvis(labels, grid, [person])[0];
    expect(pelvis).toBeDefined();
    const classify = (x: number, y: number, region = 1) => { const p = point(x, y); return pelvicRegion(region, p.x, p.y, pelvis); };
    expect(classify(.5, .54)).toBe(9); // pelvis still labelled torso by the model
    expect(classify(.62, .55)).toBe(5); // outer upper thigh, also labelled torso
    expect(classify(.5, .3)).toBe(1); // chest/belly remain independent
    expect(classify(.5, .58, 5)).toBe(9); // proximal inner legs complete the band
    expect(classify(.6, .72, 5)).toBe(5);
    expect(classify(.5, .51, 4)).toBe(4); // hand over pelvis retains its own action
    expect(classify(.5, .51, 0)).toBe(0); // no anatomical exemption for unknowns
  });
  it('declines torso-only crops, sparse logits, absent detections and ambiguous overlapping people', () => {
    const crop = fixture(0, 0, false);
    expect(estimatePelvis(crop.labels, grid, [crop.person])[0]).toBeUndefined();
    const full = fixture();
    expect(estimatePelvis(full.labels, grid, [])).toEqual([]);
    expect(estimatePelvis(new Uint8Array(grid * grid), grid, [full.person])[0]).toBeUndefined();
    expect(estimatePelvis(full.labels, grid, [full.person, full.person])).toEqual([undefined, undefined]);
    expect(regionOwner([full.person, { ...full.person, mask: new Float32Array(side * side).fill(.85) }], .5, .5)).toBe(-1);
  });
  it('isolates neighbouring people using their masks rather than frame proportions', () => {
    const a = fixture(0, -.23), b = fixture(0, .23);
    const labels = Uint8Array.from(a.labels, (v, p) => v || b.labels[p]);
    const pelvis = estimatePelvis(labels, grid, [a.person, b.person]);
    expect(pelvis.every(Boolean)).toBe(true);
    expect(pelvicRegion(1, .27, .54, pelvis[0])).toBe(9);
    expect(pelvicRegion(1, .73, .54, pelvis[1])).toBe(9);
    expect(pelvicRegion(1, .73, .51, pelvis[0])).toBe(1);
  });
  it('uses clothing as geometric evidence but only writes body-skin pixels', () => {
    const { labels, person } = fixture();
    const logits = new Float32Array(24 * grid * grid).fill(-10);
    const foreground = new Float32Array(grid * grid).fill(-10);
    labels.forEach((label, p) => { if (label) { logits[(label - 1) * grid * grid + p] = 10; foreground[p] = 10; } });
    const semantic = new Uint8Array(side * side).fill(4); // a fully clothed analytical fixture
    const index = (x: number, y: number) => Math.round(y * (side - 1)) * side + Math.round(x * (side - 1));
    const pelvisPixel = index(.5, .54), thighPixel = index(.62, .55), torsoPixel = index(.5, .3);
    semantic[pelvisPixel] = semantic[thighPixel] = semantic[torsoPixel] = 2;
    const map = decodeBodyRegions(logits, foreground, grid, semantic, side, [person]);
    expect([map[pelvisPixel], map[thighPixel], map[torsoPixel]]).toEqual([9, 5, 1]);
    expect(map.filter(Boolean)).toHaveLength(3);
    const invalid = logits.slice(); invalid.fill(NaN);
    expect(decodeBodyRegions(invalid, foreground, grid, semantic, side, [person]).some(Boolean)).toBe(false);
  });
});

describe('original BodyPix hip, shoulder and knee heads', () => {
  const poseFixture = () => {
    const heatmaps = new Float32Array(17 * grid * grid).fill(-10), offsets = new Float32Array(34 * grid * grid);
    const place = (channel: number, x: number, y: number) => {
      const gx = Math.round(x * (grid - 1)), gy = Math.round(y * (grid - 1)), p = gy * grid + gx;
      heatmaps[channel * grid * grid + p] = 5;
      offsets[channel * grid * grid + p] = (y - gy / (grid - 1)) * 320;
      offsets[(channel + 17) * grid * grid + p] = (x - gx / (grid - 1)) * 320;
    };
    place(5, .39, .24); place(6, .61, .24); place(11, .43, .58); place(12, .57, .58);
    place(13, .43, .82); place(14, .57, .82);
    return { heatmaps, offsets, inputSide: 321 };
  };
  it('anchors to learned hips and repairs lower-leg labels above the learned knees', () => {
    const { person, labels } = fixture();
    const pelvis = estimatePosePelvis(poseFixture(), grid, [person], estimatePelvis(labels, grid, [person]))[0]!;
    expect(pelvis.origin.y).toBeCloseTo(.24); expect(pelvis.height).toBeCloseTo(.34);
    expect(pelvis.thighs).toHaveLength(2);
    expect(pelvicRegion(1, .5, .57, pelvis)).toBe(9);
    expect(pelvicRegion(6, .59, .72, pelvis)).toBe(5);
    expect(pelvicRegion(6, .43, .84, pelvis)).toBe(6);
    expect(pelvicRegion(1, .5, .33, pelvis)).toBe(1);
    expect(pelvicRegion(4, .5, .57, pelvis)).toBe(4);
  });
  it('declines uncertain, invalid and ambiguous pose heads instead of substituting a guess', () => {
    const { person, labels } = fixture(), dense = estimatePelvis(labels, grid, [person]);
    const pose = poseFixture(); pose.heatmaps.fill(-10, 11 * grid * grid, 13 * grid * grid);
    expect(estimatePosePelvis(pose, grid, [person], dense)[0]).toBeUndefined();
    pose.heatmaps.fill(NaN); expect(estimatePosePelvis(pose, grid, [person], dense)[0]).toBeUndefined();
    const valid = poseFixture(); valid.offsets.fill(Infinity);
    expect(estimatePosePelvis(valid, grid, [person], dense)[0]).toBeUndefined();
    expect(estimatePosePelvis(poseFixture(), grid, [person, person], dense)).toEqual([undefined, undefined]);
    expect(() => estimatePosePelvis({ ...poseFixture(), offsets: new Float32Array(4) }, grid, [person], dense)).toThrow('pose output grid mismatch');
  });
  it('follows crossed thighs and stops the groin above the knee line', () => {
    const { person } = fixture(), pelvis = estimatePosePelvis(poseFixture(), grid, [person], [undefined])[0]!;
    pelvis.thighs = [{ hip: { x: .43, y: .58 }, knee: { x: .58, y: .82 } },
      { hip: { x: .57, y: .58 }, knee: { x: .6, y: .82 } }];
    expect(pelvicRegion(5, .56, .72, pelvis)).toBe(9);
    expect(pelvicRegion(5, .6, .82, pelvis)).toBe(5);
  });
});

describe('independent groin policy and migration', () => {
  it('preserves IDs and inherits the old torso choice without changing Show all', () => {
    expect(regionName(9)).toBe('groin'); expect(regionName(5)).toBe('thighs');
    for (const action of ['show', 'hide'] as const) {
      const old = uniformPolicy(action); delete (old.skin as Partial<typeof old.skin>).groin;
      const settings = normalizeSettings({ schemaVersion: 19, personPolicies: { male: old, female: old } });
      expect(settings.personPolicies!.male.skin.groin).toBe(action);
    }
    expect(normalizeSettings({ schemaVersion: 19, imageMaleAllowedRegions: ['torso'] }).imageMaleAllowedRegions).toEqual(['torso', 'groin']);
    expect(normalizeSettings({ schemaVersion: 20, imageMaleAllowedRegions: ['torso'] }).imageMaleAllowedRegions).toEqual(['torso']);
    const policy = uniformPolicy('show'); policy.skin.groin = 'hide';
    expect(normalizeSettings({ personPolicies: { male: policy } }).personPolicies!.male.skin.groin).toBe('hide');
    expect(BODY_REGIONS).toHaveLength(9);
  });
  it('hides groin and corrected upper thighs independently of torso, clothing, hands and face even with expansion', () => {
    const person: Track = { ...fixture().person, id: 'clothed-male', label: 'male', labelUsable: true, state: 'active',
      labelSource: 'user', genderConfidence: 1, genderEvidence: 1, box: { x: .36, y: .2, width: .28, height: .65 },
      score: .95, firstSeen: 1, lastSeen: 1, hits: 3, identityGeneration: 0, velocityX: 0, velocityY: 0 };
    const semantic = new Uint8Array(side * side).fill(4), map = new Uint8Array(side * side);
    for (let y = 24; y < 55; y++) for (let x = 31; x < 50; x++) { const p = y * side + x;
      semantic[p] = 2; map[p] = y < 38 ? 1 : x < 36 || x > 44 ? 5 : 9; }
    const male = uniformPolicy('show'); male.skin.groin = male.skin.thighs = 'hide';
    const settings = { ...DEFAULT_SETTINGS, imageExpansion: 24, personPolicies: { male, female: uniformPolicy('show') } };
    const composition = compose([person], semantic, side, side, settings, 'regions', map);
    const mask = selectedMask(composition.observations[0], settings, map);
    expect(mask[45 * side + 40]).toBe(255); expect(mask[45 * side + 33]).toBe(255);
    expect(mask[30 * side + 40]).toBe(0);
    expect(selectedMask({ ...composition.observations[0], label: 'female' }, settings, map).some(Boolean)).toBe(false);
    const expanded = regionCoverage(composition, [person], settings, side, map);
    expect(expanded[30 * side + 40]).toBe(0);
    male.skin.groin = 'show'; male.skin.thighs = 'show';
    expect(selectedMask(composition.observations[0], settings, map).some(Boolean)).toBe(false);
    settings.personPolicies.female.skin.groin = 'hide';
    expect(selectedMask({ ...composition.observations[0], label: 'female' }, settings, map)[45 * side + 40]).toBe(255);
    expect(selectedMask(composition.observations[0], settings, map)[45 * side + 40]).toBe(0);
  });
});
