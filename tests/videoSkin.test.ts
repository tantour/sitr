// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '../src/config/settings';
import { policyFor, uniformPolicy, videoSkinAction } from '../src/config/personPolicy';
import { imageAnalysisKey } from '../src/config/imageAnalysis';
import { personSelected } from '../src/rules/evaluate';
import { videoSkinMasks } from '../src/rendering/videoSkin';
import { bodyRegionsEnabled } from '../src/vision/bodyRegionMap';
import type { Track } from '../src/state/contracts';

const side = 12, n = side * side;
const makeTrack = (id: string, label: 'male' | 'female', covers = (_x: number, _y: number) => true): Track => ({
  id, label, labelUsable: true, mask: Float32Array.from({ length: n }, (_, p) => covers(p % side, Math.floor(p / side)) ? .95 : 0),
  maskWidth: side, maskHeight: side, state: 'active', box: { x: 0, y: 0, width: 1, height: 1 },
} as Track);
function settings(patch: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, advancedVideoMode: true, videoSkinExpansion: 0,
    personPolicies: { female: uniformPolicy('hide'), male: uniformPolicy('show') }, ...patch };
}

describe('advanced video semantic coverage', () => {
  it('defaults off and validates expansion without invalidating image inference', () => {
    expect(normalizeSettings({}).advancedVideoMode).toBe(false);
    expect(normalizeSettings({ advancedVideoMode: 'true' }).advancedVideoMode).toBe(false);
    expect(normalizeSettings({ advancedVideoMode: true, videoSkinExpansion: 80 }).videoSkinExpansion).toBe(24);
    expect(normalizeSettings({ videoSkinExpansion: -3 }).videoSkinExpansion).toBe(0);
    expect(imageAnalysisKey(DEFAULT_SETTINGS)).toBe(imageAnalysisKey({ ...DEFAULT_SETTINGS, advancedVideoMode: true, videoSkinExpansion: 15 }));
    expect(bodyRegionsEnabled({ ...settings(), imageBodyRegionMode: 'finer' }, 'video')).toBe(false);
  });
  it('hides body skin independently of face, hair, clothes and background', () => {
    const categories = Uint8Array.from({ length: n }, (_, p) => p % 5);
    const [mask] = videoSkinMasks([makeTrack('f', 'female')], categories, settings(), side);
    for (let p = 0; p < n; p++) expect(mask.alpha[p]).toBe(categories[p] === 2 ? 255 : 0);
  });
  it('can hide only faces or only hair while body skin stays shown', () => {
    for (const [field, category] of [['videoFace', 3], ['videoHair', 1]] as const) {
      const current = settings(), female = current.personPolicies!.female;
      female.videoSkin = 'show'; female[field] = 'hide';
      const categories = Uint8Array.from({ length: n }, (_, p) => p % 5);
      const [mask] = videoSkinMasks([makeTrack('f', 'female')], categories, current, side);
      for (let p = 0; p < n; p++) expect(mask.alpha[p]).toBe(categories[p] === category ? 255 : 0);
    }
  });
  it('keeps independent male/female choices and requires a detected person', () => {
    const tracks = [makeTrack('f', 'female', x => x < 5), makeTrack('m', 'male', x => x >= 7)];
    const masks = videoSkinMasks(tracks, new Uint8Array(n).fill(2), settings(), side);
    expect(masks).toHaveLength(1); expect(masks[0].id).toBe('f');
    for (let p = 0; p < n; p++) expect(masks[0].alpha[p]).toBe(p % side < 5 ? 255 : 0);
    expect(videoSkinMasks([], new Uint8Array(n).fill(2), settings(), side)).toEqual([]);
  });
  it('expands into nearby clothing, keeping shown face/hair and exempt people open', () => {
    const current = settings({ videoSkinExpansion: 2 }), categories = new Uint8Array(n).fill(4);
    categories[5 * side + 4] = 2; categories[5 * side + 5] = 3; categories[4 * side + 4] = 1;
    const tracks = [makeTrack('f', 'female', x => x < 7), makeTrack('m', 'male', x => x >= 7)];
    const [mask] = videoSkinMasks(tracks, categories, current, side);
    expect(mask.alpha[5 * side + 4]).toBe(255); expect(mask.alpha[6 * side + 4]).toBe(255);
    expect(mask.alpha[5 * side + 5]).toBe(0); expect(mask.alpha[4 * side + 4]).toBe(0);
    for (let p = 0; p < n; p++) if (p % side >= 7) expect(mask.alpha[p]).toBe(0);
  });
  it('uses the union for unclassified Censor and no masks for unclassified Show', () => {
    const current = settings(), track = { ...makeTrack('u', 'male'), labelUsable: false };
    current.personPolicies!.male.videoHair = 'hide';
    expect(policyFor(current, track).videoHair).toBe('hide');
    expect(videoSkinAction(policyFor(current, track))).toBe('hide');
    expect(videoSkinMasks([track], new Uint8Array(n).fill(1), current, side)[0].alpha.every(Boolean)).toBe(true);
    expect(videoSkinMasks([track], new Uint8Array(n).fill(1), { ...current, videoUnknown: 'allow' }, side)).toEqual([]);
  });
  it('preserves standard whole-person effects and allows advanced choices to differ', () => {
    const current = settings(), track = makeTrack('m', 'male');
    current.personPolicies!.male.videoSkin = 'hide';
    expect(personSelected(track, current, 'video')).toBe(true);
    expect(personSelected(track, { ...current, advancedVideoMode: false }, 'video')).toBe(false);
    expect(() => videoSkinMasks([track], new Uint8Array(3), current, side)).toThrow('grid mismatch');
  });
});
