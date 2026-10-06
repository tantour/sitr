// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { describe, expect, it } from 'vitest';
import { selectYoloRecords } from '../src/vision/yoloRecords';

describe('YOLO GPU head selection', () => {
  it('ranks anchors then all classes, retaining source boxes and coefficients', () => {
    const head = new Float32Array(4 * 116);
    for (let r = 0; r < 4; r++) { head[r * 116] = r; head[r * 116 + 84] = r + 10; }
    head[4] = 0.6;
    head[116 + 4] = 0.7;
    head[116 + 5] = 0.9;
    head[232 + 4] = 0.8;
    head[348 + 6] = 0.95;
    const result = selectYoloRecords(head, 4, 116, 2);
    // Anchor 2's person score is excluded by the first TopK, even though it
    // would beat anchor 1's person score. Both selected records are non-person.
    expect([...result.slice(0, 4)]).toEqual([3, 0, 0, 0]);
    expect(result[5]).toBe(2);
    expect(result[6]).toBe(13);
    expect(result[38]).toBe(1);
    expect(result[43]).toBe(1);
    expect(result[44]).toBe(11);
  });
  it('breaks equal-score ties by lower index, matching ONNX TopK', () => {
    const head = new Float32Array(3 * 116);
    for (let r = 0; r < 3; r++) { head[r * 116] = r; head[r * 116 + 4] = 0.5; head[r * 116 + 5] = 0.5; }
    const result = selectYoloRecords(head, 3, 116, 2);
    expect([result[0], result[5], result[38], result[43]]).toEqual([0, 0, 0, 1]);
  });
  it('rejects an incompatible export', () => {
    expect(() => selectYoloRecords(new Float32Array(300 * 38), 300, 38)).toThrow('shape');
  });
  it('matches a full-sort reference on varied scores with ties', () => {
    const rows = 400, limit = 300, fields = 116;
    const head = new Float32Array(rows * fields);
    let seed = 42;
    for (let i = 0; i < head.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; head[i] = (seed % 1000) / 1000; }
    const anchors = Array.from({ length: rows }, (_, i) => i);
    const maxima = anchors.map(r => Math.max(...head.subarray(r * fields + 4, r * fields + 84)));
    anchors.sort((a, b) => maxima[b] - maxima[a] || a - b);
    const score = (i: number) => head[anchors[Math.floor(i / 80)] * fields + 4 + i % 80];
    const candidates = Array.from({ length: limit * 80 }, (_, i) => i).sort((a, b) => score(b) - score(a) || a - b).slice(0, limit);
    const actual = selectYoloRecords(head, rows, fields);
    for (let r = 0; r < limit; r++) {
      const index = candidates[r], source = anchors[Math.floor(index / 80)] * fields;
      expect([...actual.subarray(r * 38, (r + 1) * 38)]).toEqual([
        ...head.subarray(source, source + 4), score(index), index % 80, ...head.subarray(source + 84, source + 116),
      ]);
    }
  });
});
