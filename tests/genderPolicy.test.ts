// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { describe, expect, it } from 'vitest';
import { ByteTracker } from '../src/vision/tracker';
import { canUseBodyGender, genderCheckDue } from '../src/vision/genderPolicy';

function trackedPerson() {
  const tracker = new ByteTracker('policy');
  const track = tracker.update([{
    box: { x: 0.1, y: 0.1, width: 0.3, height: 0.8 }, score: 0.9,
    mask: new Float32Array(100).fill(1), maskWidth: 10, maskHeight: 10,
  }], 0, true)[0];
  return { tracker, track };
}

describe('video classification policy', () => {
  it('checks new identities immediately and each existing identity once per second', () => {
    const { track } = trackedPerson();
    expect(genderCheckDue(track, 0)).toBe(true);
    track.lastGenderCheckAt = 100;
    expect(genderCheckDue(track, 1099)).toBe(false);
    expect(genderCheckDue(track, 1100)).toBe(true);
    expect(genderCheckDue(trackedPerson().track, 101)).toBe(true);
  });
  it('does not classify lost, ambiguous, or manually labelled tracks', () => {
    const { tracker, track } = trackedPerson();
    track.state = 'lost';
    expect(genderCheckDue(track, 1000)).toBe(false);
    track.state = 'ambiguous';
    expect(genderCheckDue(track, 1000)).toBe(false);
    track.state = 'active';
    tracker.label(track.id, 'male');
    expect(genderCheckDue(track, 1000)).toBe(false);
  });
  it('never uses body fallback for a previous face result, even when it becomes uncertain', () => {
    const { tracker, track } = trackedPerson();
    tracker.estimateGender(track.id, 'male', 0.98, false);
    track.labelUsable = false;
    expect(track.genderModelSource).toBe('face');
    expect(canUseBodyGender(track, 'video', true, false, false)).toBe(false);
    expect(canUseBodyGender(track, 'video', true, true, false)).toBe(false);
  });
  it.each(['body-intel', 'body-paddle'] as const)('refreshes a previous %s result with a hidden face', source => {
    const { tracker, track } = trackedPerson();
    tracker.estimateGender(track.id, 'male', 0.98, false, 0.85, source);
    expect(canUseBodyGender(track, 'video', true, false, false)).toBe(true);
    expect(canUseBodyGender(track, 'video', true, true, true)).toBe(false);
    tracker.estimateGender(track.id, 'male', 0.98, false, 0.85, 'face');
    expect(canUseBodyGender(track, 'video', true, false, false)).toBe(false);
  });
  it('keeps a new hidden-face identity unknown in face-first modes', () => {
    const { track } = trackedPerson();
    expect(canUseBodyGender(track, 'video', true, false, false)).toBe(false);
    expect(canUseBodyGender(track, 'video', true, true, false)).toBe(true);
  });
  it('does not use old body confidence to validate a weaker first face result', () => {
    const { tracker, track } = trackedPerson();
    tracker.estimateGender(track.id, 'male', 0.98, false, 0.85, 'body-intel');
    expect(tracker.estimateGender(track.id, 'male', 0.87, false, 0.85, 'face')).toBe(false);
    const next = tracker.update([{
      box: track.box, score: 0.9, mask: track.mask, maskWidth: 10, maskHeight: 10,
    }], 100)[0];
    expect(next.labelUsable).toBe(false);
    expect(next.genderConfidence).toBe(0.87);
  });
  it('preserves explicit body-only modes and image fallback', () => {
    const { track } = trackedPerson();
    expect(canUseBodyGender(track, 'video', false, false, false)).toBe(true);
    expect(canUseBodyGender(track, 'image', true, false, false)).toBe(true);
    track.labelUsable = true;
    expect(canUseBodyGender(track, 'image', true, false, false)).toBe(false);
  });
});
