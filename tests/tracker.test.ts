import { describe, expect, it } from 'vitest';
import { ByteTracker } from '../src/vision/tracker';
import type { PersonDetection } from '../src/state/contracts';

function detection(x: number): PersonDetection {
  return { box: { x, y: 0.2, width: 0.2, height: 0.5 }, score: 0.9,
    mask: new Float32Array(100).fill(0.9), maskWidth: 10, maskHeight: 10 };
}

describe('temporary track labels', () => {
  it('allows a directly observed static-image track to be labelled', () => {
    const tracker = new ByteTracker('still');
    const still = tracker.update([detection(0.1)], 0, true)[0];
    expect(still.state).toBe('active');
    expect(tracker.label(still.id, 'male')).toBe(true);
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
});
