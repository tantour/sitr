import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, resolveYoloSize } from '../src/config/settings';
import { selectedMask } from '../src/rules/evaluate';
import { compose, pruneIslands } from '../src/rendering/compositor';
import type { Track, TrackObservation } from '../src/state/contracts';

function observation(id: string, ratio: number, reliable = true): TrackObservation {
  return {
    id, box: { x: 0, y: 0, width: 1, height: 1 }, label: 'unknown', labelUsable: false, state: 'active',
    ownedMask: new Uint8Array([255, 255, 255]), bodySkinMask: new Uint8Array([255, 0, 0]),
    hairMask: new Uint8Array([0, 255, 0]), faceSkinMask: new Uint8Array([0, 0, 255]),
    exposure: { ratio, reliable, ownedPixels: 100, ambiguousFraction: 0 },
  };
}
describe('censorship rules', () => {
  it('censors unlabelled body skin and hair while leaving face skin visible', () => {
    expect([...selectedMask(observation('a', 0.3), DEFAULT_SETTINGS)]).toEqual([255, 255, 0]);
  });
  it('uses explicit exemptions only when track identity is usable', () => {
    const person = observation('a', 0.3);
    person.label = 'male'; person.labelUsable = true;
    expect([...selectedMask(person, DEFAULT_SETTINGS)]).toEqual([0, 0, 0]);
    person.labelUsable = false;
    expect([...selectedMask(person, DEFAULT_SETTINGS)]).toEqual([255, 255, 0]);
  });
  it('never blackens the full person because of a high skin percentage', () => {
    expect([...selectedMask(observation('a', 0.99), DEFAULT_SETTINGS)]).toEqual([255, 255, 0]);
  });
  it('keeps face skin visible for an unclassified person under the whole-person legacy setting', () => {
    const legacySettings = normalizeSettings({ schemaVersion: 2, unknown: 'whole' });
    expect(legacySettings.unknown).toBe('selected');
    expect(legacySettings.faceDetectionConfidence).toBe(0.55);
    expect(legacySettings.yoloConfidence).toBe(0.1);
    expect(normalizeSettings({ yoloConfidence: 0 }).yoloConfidence).toBe(0.01);
    expect(normalizeSettings({ faceDetectionConfidence: 4, minFaceSizePx: 1, faceMargin: -1 }).faceDetectionConfidence).toBe(0.99);
    expect(normalizeSettings({ faceDetectionConfidence: 4, minFaceSizePx: 1, faceMargin: -1 }).minFaceSizePx).toBe(4);
    expect(normalizeSettings({ faceDetectionConfidence: 4, minFaceSizePx: 1, faceMargin: -1 }).faceMargin).toBe(0);
    expect([...selectedMask(observation('a', 0.3), legacySettings)]).toEqual([255, 255, 0]);
  });
});

describe('model resolution settings', () => {
  it('uses the preset for Auto and permits only packaged YOLO sizes', () => {
    const quality = normalizeSettings({ performance: 'quality' });
    expect(resolveYoloSize(quality, 'image')).toBe(416);
    expect(resolveYoloSize(quality, 'video')).toBe(320);
    const override = normalizeSettings({ performance: 'quality', yoloImageSize: 256, yoloVideoSize: 416 });
    expect(resolveYoloSize(override, 'image')).toBe(256);
    expect(resolveYoloSize(override, 'video')).toBe(416);
    expect(normalizeSettings({ yoloImageSize: 384, yunetSize: 384, faceCaptureSize: 900 }).yoloImageSize).toBe('auto');
    expect(normalizeSettings({ yunetSize: 384 }).yunetSize).toBe(320);
    expect(normalizeSettings({ faceCaptureSize: 900 }).faceCaptureSize).toBe(640);
  });
});

function track(id: string, mask: number[]): Track {
  return { id, box: { x: 0, y: 0, width: 1, height: 1 }, mask: Float32Array.from(mask), maskWidth: 10, maskHeight: 10,
    score: 0.9, firstSeen: 0, lastSeen: 0, hits: 2, state: 'active', label: 'unknown', labelUsable: false,
    labelSource: 'none', genderConfidence: 0, genderEvidence: 0,
    identityGeneration: 0, velocityX: 0, velocityY: 0 };
}
describe('instance ownership', () => {
  it('limits uncertain-track fallback to selected semantic regions', () => {
    const person = track('a', [0.9, 0.9, 0.9, 0.9]);
    const result = compose([person], new Uint8Array([2, 3, 1, 4]), 2, 2);
    expect([...result.uncertainByTrack[0]]).toEqual([255, 0, 255, 0]);
  });
  it('counts body skin separately per person without counting face skin', () => {
    const a = new Array<number>(100).fill(0);
    const b = new Array<number>(100).fill(0);
    const semantic = new Uint8Array(100).fill(4);
    for (let i = 0; i < 50; i++) { a[i] = 0.9; semantic[i] = i < 40 ? 2 : 3; }
    for (let i = 50; i < 100; i++) { b[i] = 0.9; semantic[i] = i < 90 ? 2 : 3; }
    const result = compose([track('a', a), track('b', b)], semantic, 10, 10);
    expect(result.observations.map(o => o.exposure.ratio)).toEqual([0.8, 0.8]);
    expect(result.observations.map(o => o.exposure.reliable)).toEqual([false, false]);
  });
  it('never grants ambiguous pixels to one person', () => {
    const a = new Array<number>(100).fill(0.7);
    const b = new Array<number>(100).fill(0.68);
    const result = compose([track('a', a), track('b', b)], new Uint8Array(100).fill(2), 10, 10);
    expect(result.ambiguous.every(x => x === 255)).toBe(true);
    expect(result.observations.every(o => o.exposure.ownedPixels === 0)).toBe(true);
  });
  it('keeps unassigned semantic foreground in a local protection mask', () => {
    const semantic = new Uint8Array(100);
    semantic.fill(2, 20, 30);
    const result = compose([], semantic, 10, 10);
    expect(result.unassignedForeground).toBe(10);
    expect([...result.unassignedMask].filter(Boolean)).toHaveLength(10);
  });
  it('limits uncertain-person protection to selected semantic pixels', () => {
    const mask = new Array<number>(100).fill(0);
    mask.fill(0.8, 20, 30);
    const semantic = new Uint8Array(100);
    semantic.fill(2, 20, 25);
    semantic.fill(3, 25, 30);
    const result = compose([track('a', mask)], semantic, 10, 10);
    expect(result.observations[0].exposure.reliable).toBe(false);
    expect([...result.uncertainMask].filter(Boolean)).toHaveLength(5);
  });
  it('does not treat disabled face skin or clothing as unassigned censorship', () => {
    const semantic = new Uint8Array(100);
    semantic[1] = 3; semantic[2] = 4; semantic[3] = 2;
    const result = compose([], semantic, 10, 10);
    expect(result.unassignedMask[1]).toBe(0);
    expect(result.unassignedMask[2]).toBe(0);
    expect(result.unassignedMask[3]).toBe(255);
  });
  it('removes isolated model pixels without erasing a real region', () => {
    const mask = new Uint8Array(100);
    mask[0] = 255;
    mask.fill(255, 20, 25);
    const clean = pruneIslands(mask, 10, 10);
    expect(clean[0]).toBe(0);
    expect([...clean].filter(Boolean)).toHaveLength(5);
  });
});
