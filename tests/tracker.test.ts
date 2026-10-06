// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { describe, expect, it } from 'vitest';
import { ByteTracker } from '../src/vision/tracker';
import type { PersonDetection } from '../src/state/contracts';

function detection(x: number): PersonDetection {
  return { box: { x, y: 0.2, width: 0.2, height: 0.5 }, score: 0.9,
    mask: new Float32Array(100).fill(0.9), maskWidth: 10, maskHeight: 10 };
}

function posed(x: number, y: number, width: number, height: number, appearance?: Float32Array): PersonDetection {
  return { ...detection(x), box: { x, y, width, height }, appearance };
}

describe('temporary track labels', () => {
  it('keeps manual labels independent in adopted identical images', () => {
    const original = new ByteTracker('source');
    const tracks = original.update([detection(0.1)], 0, true);
    original.estimateGender(tracks[0].id, 'female', .99, true);
    const duplicate = new ByteTracker('duplicate');
    const snapshot = structuredClone(tracks);
    duplicate.restoreImage(snapshot);
    expect(duplicate.label(snapshot[0].id, 'male')).toBe(true);
    expect(snapshot[0].label).toBe('male');
    expect(tracks[0].label).toBe('female');
    expect(tracks[0].labelSource).toBe('automatic');
    original.reset();
    expect(duplicate.get()[0].label).toBe('male');
  });
  it('allows a directly observed static-image track to be labelled', () => {
    const tracker = new ByteTracker('still');
    const still = tracker.update([detection(0.1)], 0, true)[0];
    expect(still.state).toBe('active');
    expect(tracker.label(still.id, 'male')).toBe(true);
  });
  it('retains weak person detections in a still image but not as new video tracks', () => {
    const weak = { ...detection(0.1), score: 0.2 };
    expect(new ByteTracker('image').update([weak], 0, true, undefined, true)).toHaveLength(1);
    expect(new ByteTracker('body-only-image').update([weak], 0, true)).toHaveLength(0);
    expect(new ByteTracker('video').update([weak], 0)).toHaveLength(0);
  });
  it('keeps a label on consistent observations and never moves it to a new track', () => {
    const tracker = new ByteTracker('test');
    const first = tracker.update([detection(0.1)], 0)[0];
    expect(tracker.label(first.id, 'male')).toBe(false);
    const second = tracker.update([detection(0.11)], 100)[0];
    expect(second.id).toBe(first.id);
    expect(tracker.label(first.id, 'male')).toBe(true);
    expect(tracker.update([detection(0.12)], 200)[0].labelUsable).toBe(true);
    const newTrack = tracker.update([detection(0.7)], 300)[0];
    expect(newTrack.id).not.toBe(first.id);
    expect(newTrack.labelUsable).toBe(false);
    expect(newTrack.label).toBe('unknown');
  });
  it('restores a label after a brief, unambiguous missed detection', () => {
    const tracker = new ByteTracker('return');
    const first = tracker.update([detection(0.1)], 0, true)[0];
    tracker.label(first.id, 'male');
    expect(tracker.update([], 100)).toEqual([]);
    const found = tracker.update([detection(0.11)], 200)[0];
    expect(found.id).toBe(first.id);
    expect(found.label).toBe('male');
    expect(found.labelUsable).toBe(true);
  });
  it('estimates several people independently and requires repeat video evidence', () => {
    const tracker = new ByteTracker('automatic');
    const first = tracker.update([detection(0.1), detection(0.6)], 0);
    expect(tracker.estimateGender(first[0].id, 'male', 0.96, false)).toBe(false);
    expect(tracker.estimateGender(first[1].id, 'female', 0.95, false)).toBe(false);
    const second = tracker.update([detection(0.11), detection(0.61)], 100);
    expect(tracker.estimateGender(second[0].id, 'male', 0.96, false)).toBe(true);
    expect(tracker.estimateGender(second[1].id, 'female', 0.95, false)).toBe(true);
    expect(second.map(track => track.label)).toEqual(['male', 'female']);
    expect(second.every(track => track.labelSource === 'automatic' && track.labelUsable)).toBe(true);
  });
  it('lets a user override an estimate and invalidates estimates on ambiguous reassociation', () => {
    const tracker = new ByteTracker('override');
    const first = tracker.update([detection(0.1)], 0, true)[0];
    expect(tracker.estimateGender(first.id, 'male', 0.96, true)).toBe(true);
    expect(tracker.label(first.id, 'female')).toBe(true);
    expect(tracker.estimateGender(first.id, 'male', 0.99, true)).toBe(false);
    expect(first.label).toBe('female');
    expect(first.labelSource).toBe('user');
  });
  it('keeps a strong appearance estimate when the same person turns away', () => {
    const tracker = new ByteTracker('turn');
    const first = tracker.update([detection(0.1)], 0)[0];
    expect(tracker.estimateGender(first.id, 'female', 0.98, false)).toBe(false);
    const second = tracker.update([detection(0.12)], 100)[0];
    expect(second.id).toBe(first.id);
    expect(second.label).toBe('female');
    expect(second.labelUsable).toBe(true);
    expect(tracker.update([detection(0.14)], 200)[0].labelUsable).toBe(true);
  });
  it('requires repeated contrary evidence before changing an established estimate', () => {
    const tracker = new ByteTracker('contradiction');
    const first = tracker.update([detection(0.1)], 0, true)[0];
    expect(tracker.estimateGender(first.id, 'female', 0.98, false)).toBe(true);
    expect(tracker.estimateGender(first.id, 'male', 0.98, false)).toBe(false);
    expect(first.label).toBe('female');
    expect(tracker.update([detection(0.1)], 100)[0].labelUsable).toBe(false);
    expect(tracker.estimateGender(first.id, 'male', 0.98, false)).toBe(true);
    expect(first.label).toBe('male');
  });
  it('invalidates saturated evidence on the first opposite video estimate', () => {
    const tracker = new ByteTracker('saturated');
    const first = tracker.update([detection(0.1)], 0, true)[0];
    for (let i = 0; i < 10; i++) tracker.estimateGender(first.id, 'female', 0.98, false);
    expect(first.genderEvidence).toBe(-6);
    expect(tracker.estimateGender(first.id, 'male', 0.98, false)).toBe(false);
    expect(first.genderEvidence).toBe(1);
    expect(tracker.update([detection(0.1)], 100)[0].labelUsable).toBe(false);
    expect(tracker.estimateGender(first.id, 'male', 0.98, false)).toBe(true);
  });
  it('does not transfer classification or its cadence to a different appearance in the same box', () => {
    const shirt = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    const other = new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0]);
    const tracker = new ByteTracker('same-position');
    const first = tracker.update([posed(0.4, 0.2, 0.2, 0.5, shirt)], 0, true)[0];
    tracker.estimateGender(first.id, 'male', 0.98, true, 0.85, 'body-intel');
    first.lastGenderCheckAt = 0;
    const next = tracker.update([posed(0.4, 0.2, 0.2, 0.5, other)], 100)[0];
    expect(next.id).not.toBe(first.id);
    expect(next.label).toBe('unknown');
    expect(next.labelUsable).toBe(false);
    expect(next.genderModelSource).toBeUndefined();
    expect(next.lastGenderCheckAt).toBeUndefined();
  });
  it('keeps an automatic label across a brief miss when the same appearance returns', () => {
    const tracker = new ByteTracker('memory');
    const first = tracker.update([detection(0.1)], 0, true)[0];
    expect(tracker.estimateGender(first.id, 'female', 0.98, true)).toBe(true);
    tracker.update([], 100);
    const found = tracker.update([detection(0.11)], 200)[0];
    expect(found.id).toBe(first.id);
    expect(found.label).toBe('female');
    expect(found.labelUsable).toBe(true);
  });
  it('uses appearance to retain two identities when boxes overlap', () => {
    const tracker = new ByteTracker('crossing');
    const red = detection(0.1), blue = detection(0.2);
    red.appearance = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    blue.appearance = new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]);
    const first = tracker.update([red, blue], 0, true);
    tracker.label(first[0].id, 'male');
    tracker.label(first[1].id, 'female');
    const movingRed = detection(0.2), movingBlue = detection(0.1);
    movingRed.appearance = red.appearance;
    movingBlue.appearance = blue.appearance;
    const second = tracker.update([movingBlue, movingRed], 100);
    const trackedRed = second.find(track => track.id === first[0].id);
    const trackedBlue = second.find(track => track.id === first[1].id);
    expect(trackedRed?.box.x).toBe(0.2);
    expect(trackedRed?.label).toBe('male');
    expect(trackedBlue?.box.x).toBe(0.1);
    expect(trackedBlue?.label).toBe('female');
  });
  it('matches a moved person using a reliable motion prediction', () => {
    const tracker = new ByteTracker('motion');
    const first = tracker.update([detection(0.1)], 0, true)[0];
    tracker.label(first.id, 'male');
    const moved = tracker.update([detection(0.46)], 200, false,
      new Map([[first.id, { x: 0.46, y: 0.2, width: 0.2, height: 0.5 }]]))[0];
    expect(moved.id).toBe(first.id);
    expect(moved.label).toBe('male');
    expect(moved.labelUsable).toBe(true);
  });
  it('retains an automatic label as one person goes from standing to a push-up', () => {
    const shirt = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    const tracker = new ByteTracker('pushup');
    const standing = tracker.update([posed(0.44, 0.12, 0.15, 0.74, shirt)], 0, true)[0];
    expect(tracker.estimateGender(standing.id, 'male', 0.98, true)).toBe(true);
    const prone = tracker.update([posed(0.24, 0.66, 0.58, 0.20, shirt)], 250)[0];
    expect(prone.id).toBe(standing.id);
    expect(prone.label).toBe('male');
    expect(prone.labelUsable).toBe(true);
  });
  it('keeps the label through a high-overlap crouch with a large center jump', () => {
    const shirt = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    const tracker = new ByteTracker('crouch');
    const standing = tracker.update([posed(0.4, 0.05, 0.15, 0.8, shirt)], 0, true)[0];
    tracker.estimateGender(standing.id, 'male', 0.98, true);
    const crouched = tracker.update([posed(0.4, 0.57, 0.15, 0.4, shirt)], 200)[0];
    expect(crouched.id).toBe(standing.id);
    expect(crouched.labelUsable).toBe(true);
  });
  it('recovers the same pose after a brief detector dropout', () => {
    const shirt = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    const tracker = new ByteTracker('pushup-gap');
    const standing = tracker.update([posed(0.44, 0.12, 0.15, 0.74, shirt)], 0, true)[0];
    tracker.estimateGender(standing.id, 'male', 0.98, true);
    tracker.update([], 500);
    const prone = tracker.update([posed(0.24, 0.66, 0.58, 0.20, shirt)], 1500)[0];
    expect(prone.id).toBe(standing.id);
    expect(prone.labelUsable).toBe(true);
  });
  it('does not give a standing man’s label to a different nearby appearance', () => {
    const shirt = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    const other = new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0]);
    const tracker = new ByteTracker('pose-safety');
    const standing = tracker.update([posed(0.44, 0.12, 0.15, 0.74, shirt)], 0, true)[0];
    tracker.estimateGender(standing.id, 'male', 0.98, true);
    const newcomer = tracker.update([posed(0.24, 0.66, 0.58, 0.20, other)], 250)[0];
    expect(newcomer.id).not.toBe(standing.id);
    expect(newcomer.labelUsable).toBe(false);
  });
  it('does not transfer a label to a replacement person after a long miss', () => {
    const shirt = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    const other = new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0]);
    const tracker = new ByteTracker('replacement');
    const standing = tracker.update([posed(0.4, 0.2, 0.2, 0.5, shirt)], 0, true)[0];
    tracker.estimateGender(standing.id, 'male', 0.98, true);
    tracker.update([], 500);
    const replacement = tracker.update([posed(0.4, 0.2, 0.2, 0.5, other)], 1500)[0];
    expect(replacement.id).not.toBe(standing.id);
    expect(replacement.labelUsable).toBe(false);
  });
});
