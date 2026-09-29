import { describe, expect, it } from 'vitest';
import { associateFaces } from '../src/vision/faceAssociation';
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
});
