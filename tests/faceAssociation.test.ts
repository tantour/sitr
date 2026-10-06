// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { describe, expect, it } from 'vitest';
import { associateFaces, associateFacesToBoxes } from '../src/vision/faceAssociation';
import type { Track } from '../src/state/contracts';

function track(id: string, x0: number, x1: number): Track {
  const mask = new Float32Array(100);
  for (let y = 0; y < 10; y++) for (let x = x0; x < x1; x++) mask[y * 10 + x] = 0.9;
  return { id, box: { x: x0 / 10, y: 0, width: (x1 - x0) / 10, height: 1 }, mask, maskWidth: 10, maskHeight: 10,
    score: 0.9, firstSeen: 0, lastSeen: 0, hits: 2, state: 'active', label: 'unknown',
    labelUsable: false, labelSource: 'none', genderConfidence: 0, genderEvidence: 0,
    identityGeneration: 0, velocityX: 0, velocityY: 0 };
}

describe('face-to-person geometry', () => {
  it('assigns a central face region to a unique instance', () => {
    const result = associateFaces([{ box: { x: 0.1, y: 0.2, width: 0.2, height: 0.3 }, score: 0.9 }],
      [track('left', 0, 5), track('right', 5, 10)], 10);
    expect(result).toEqual([{ faceIndex: 0, trackId: 'left', ambiguous: false }]);
  });
  it('uses a clear lower-confidence face mask instead of requiring every pixel above 0.65', () => {
    const person = track('person', 0, 5);
    person.mask.fill(0.55);
    const face = { box: { x: 0.12, y: 0.15, width: 0.2, height: 0.2 }, score: 0.9 };
    expect(associateFaces([face], [person], 10))
      .toEqual([{ faceIndex: 0, trackId: 'person', ambiguous: false }]);
  });
  it('makes the coverage slider control partial face-mask ownership at both mask confidence levels', () => {
    const person = track('person', 0, 5);
    const face = { box: { x: 0.1, y: 0.2, width: 0.6, height: 0.3 }, score: 0.9 };
    const low = { coverage: 0.7, margin: 0.2, centerMaskConfidence: 0.65 };
    const high = { ...low, coverage: 0.9 };
    expect(associateFaces([face], [person], 10, 'overlap', low)[0].trackId).toBe('person');
    expect(associateFaces([face], [person], 10, 'overlap', high)[0].ambiguous).toBe(true);
    person.mask.fill(0.45);
    for (let y = 0; y < 10; y++) for (let x = 5; x < 10; x++) person.mask[y * 10 + x] = 0;
    expect(associateFaces([face], [person], 10, 'overlap', low)[0].trackId).toBe('person');
    expect(associateFaces([face], [person], 10, 'overlap', high)[0].ambiguous).toBe(true);
  });
  it('applies coverage even in center mode instead of bypassing it for one center pixel', () => {
    const person = track('person', 0, 5);
    const face = { box: { x: 0.1, y: 0.2, width: 0.6, height: 0.3 }, score: 0.9 };
    const low = { coverage: 0.7, margin: 0.2, centerMaskConfidence: 0.65 };
    expect(associateFaces([face], [person], 10, 'center', low)[0].trackId).toBe('person');
    expect(associateFaces([face], [person], 10, 'center', { ...low, coverage: 0.9 })[0].ambiguous).toBe(true);
  });
  it('prefers face-mask pixels over a different person with a larger shoulder patch nearby', () => {
    const owner = track('face-owner', 0, 10);
    const shoulder = track('shoulder', 0, 10);
    owner.mask.fill(0);
    shoulder.mask.fill(0);
    owner.mask[2 * 10 + 3] = 0.5;
    owner.mask[3 * 10 + 3] = 0.5;
    for (let y = 5; y < 9; y++) for (let x = 1; x < 8; x++) shoulder.mask[y * 10 + x] = 0.9;
    const face = { box: { x: 0.1, y: 0.1, width: 0.6, height: 0.5 }, score: 0.9 };
    const thresholds = { coverage: 0.1, margin: 0.05, centerMaskConfidence: 0.65 };
    expect(associateFaces([face], [owner, shoulder], 10, 'overlap', thresholds))
      .toEqual([{ faceIndex: 0, trackId: 'face-owner', ambiguous: false }]);
  });
  it('uses detector and shoulder evidence to resolve overlapping duplicate masks', () => {
    const front = track('front', 0, 10);
    const duplicate = track('duplicate', 0, 10);
    front.score = 0.6;
    duplicate.score = 0.3;
    const face = { box: { x: 0.2, y: 0.2, width: 0.2, height: 0.2 }, score: 0.9,
      nose: { x: 0.3, y: 0.3 } };
    expect(associateFaces([face], [front, duplicate], 10))
      .toEqual([{ faceIndex: 0, trackId: 'front', ambiguous: false }]);
  });
  it('keeps the better-owned face when one merged person mask covers two faces', () => {
    const person = track('person', 0, 10);
    const front = { box: { x: 0.2, y: 0.2, width: 0.2, height: 0.2 }, score: 0.9 };
    const behind = { box: { x: 0.6, y: 0.2, width: 0.2, height: 0.2 }, score: 0.9 };
    for (let y = 2; y < 5; y++) for (let x = 6; x < 9; x++) person.mask[y * 10 + x] = 0.4;
    expect(associateFaces([front, behind], [person], 10))
      .toEqual([{ faceIndex: 0, trackId: 'person', ambiguous: false },
        { faceIndex: 1, ambiguous: true }]);
  });
  it('recovers a uniquely fitting head fragment after a full mask is assigned to another face', () => {
    const merged = track('merged', 0, 10);
    const fragment = track('fragment', 0, 10);
    fragment.box = { x: 0.59, y: 0.18, width: 0.22, height: 0.21 };
    fragment.score = 0.2;
    fragment.mask.fill(0);
    for (let y = 2; y < 4; y++) fragment.mask[y * 10 + 6] = 0.6;
    for (let y = 2; y < 5; y++) for (let x = 6; x < 9; x++) merged.mask[y * 10 + x] = 0.4;
    const faces = [
      { box: { x: 0.2, y: 0.2, width: 0.2, height: 0.2 }, score: 0.9 },
      { box: { x: 0.6, y: 0.2, width: 0.2, height: 0.2 }, score: 0.9 },
    ];
    expect(associateFaces(faces, [merged, fragment], 10))
      .toEqual([{ faceIndex: 0, trackId: 'merged', ambiguous: false },
        { faceIndex: 1, trackId: 'fragment', ambiguous: false }]);
  });
  it('associates a face inside a person box when the head mask is missing but shoulders are present', () => {
    const person = track('person', 0, 5);
    for (let y = 0; y < 3; y++) person.mask.fill(0, y * 10, (y + 1) * 10);
    const face = { box: { x: 0.12, y: 0.05, width: 0.2, height: 0.2 }, score: 0.9 };
    expect(associateFaces([face], [person], 10))
      .toEqual([{ faceIndex: 0, trackId: 'person', ambiguous: false }]);
  });
  it('associates a face just above a torso-only segmentation box', () => {
    const person = track('person', 0, 5);
    person.box = { x: 0, y: 0.3, width: 0.5, height: 0.65 };
    for (let y = 0; y < 3; y++) person.mask.fill(0, y * 10, (y + 1) * 10);
    const face = { box: { x: 0.12, y: 0.12, width: 0.2, height: 0.2 }, score: 0.9 };
    expect(associateFaces([face], [person], 10))
      .toEqual([{ faceIndex: 0, trackId: 'person', ambiguous: false }]);
  });
  it('does not guess from the person box when two people plausibly own a headless face', () => {
    const left = track('left', 0, 6), right = track('right', 1, 7);
    for (const person of [left, right]) for (let y = 0; y < 3; y++) person.mask.fill(0, y * 10, (y + 1) * 10);
    const face = { box: { x: 0.22, y: 0.05, width: 0.2, height: 0.2 }, score: 0.9 };
    expect(associateFaces([face], [left, right], 10)[0].ambiguous).toBe(true);
  });
  it('supports assigning by the face-box center pixel', () => {
    const face = { box: { x: 0.45, y: 0.2, width: 0.2, height: 0.3 }, score: 0.9 };
    expect(associateFaces([face], [track('left', 0, 5), track('right', 5, 10)], 10, 'center'))
      .toEqual([{ faceIndex: 0, trackId: 'right', ambiguous: false }]);
  });
  it('abstains in center mode when no single person owns the center pixel', () => {
    const face = { box: { x: 0.4, y: 0.2, width: 0.2, height: 0.3 }, score: 0.9 };
    expect(associateFaces([face], [track('left', 0, 6), track('right', 4, 10)], 10, 'center')[0].ambiguous).toBe(true);
  });
  it('abstains when masks overlap and when two faces claim one person', () => {
    const face = { box: { x: 0.1, y: 0.2, width: 0.2, height: 0.3 }, score: 0.9 };
    expect(associateFaces([face], [track('a', 0, 5), track('b', 0, 5)], 10)[0].ambiguous).toBe(true);
    expect(associateFaces([face, face], [track('a', 0, 5)], 10).every(x => x.ambiguous)).toBe(true);
  });
  it('keeps a profile face whose nose extends beyond every mask, but rejects a nose owned by another person', () => {
    const face = { box: { x: 0.1, y: 0.2, width: 0.4, height: 0.3 }, score: 0.9,
      nose: { x: 0.55, y: 0.35 } };
    expect(associateFaces([face], [track('left', 0, 5), track('right', 6, 10)], 10))
      .toEqual([{ faceIndex: 0, trackId: 'left', ambiguous: false }]);
    expect(associateFaces([{ ...face, nose: { x: 0.75, y: 0.35 } }], [track('left', 0, 5), track('right', 6, 10)], 10)[0].ambiguous)
      .toBe(true);
  });
  it('assigns faces to unique upper-body boxes and abstains on overlap', () => {
    const left = track('left', 0, 5), right = track('right', 5, 10);
    const face = { box: { x: 0.12, y: 0.1, width: 0.16, height: 0.15 }, score: 0.95 };
    expect(associateFacesToBoxes([face], [left, right]))
      .toEqual([{ faceIndex: 0, trackId: 'left', ambiguous: false }]);
    expect(associateFacesToBoxes([face], [left, { ...right, box: { ...left.box } }])[0].ambiguous).toBe(true);
  });
});
