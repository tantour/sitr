// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
/** Reproduce YOLO26's two-stage TopK(300) without GPU/CPU graph boundaries.
 * Input rows contain xyxy, 80 class scores, and 32 mask coefficients.
 * Rank across ALL classes before filtering people, as the original export does.
 */
function topK(scores: Float32Array, limit: number): number[] {
  const heap: number[] = [];
  const worse = (a: number, b: number) => scores[a] < scores[b] || (scores[a] === scores[b] && a > b);
  for (let i = 0; i < scores.length; i++) {
    if (heap.length < limit) {
      let at = heap.length;
      heap.push(i);
      while (at > 0) {
        const parent = (at - 1) >> 1;
        if (!worse(heap[at], heap[parent])) break;
        [heap[at], heap[parent]] = [heap[parent], heap[at]];
        at = parent;
      }
    } else if (worse(heap[0], i)) {
      heap[0] = i;
      let at = 0;
      while (at * 2 + 1 < limit) {
        let child = at * 2 + 1;
        if (child + 1 < limit && worse(heap[child + 1], heap[child])) child++;
        if (!worse(heap[child], heap[at])) break;
        [heap[at], heap[child]] = [heap[child], heap[at]];
        at = child;
      }
    }
  }
  return heap.sort((a, b) => scores[b] - scores[a] || a - b);
}

export function selectYoloRecords(head: Float32Array, rows: number, fields: number, limit = 300): Float32Array {
  const classes = 80;
  const channels = fields - 4 - classes;
  if (channels !== 32 || head.length !== rows * fields || rows < limit) throw new Error('YOLO GPU head shape mismatch');
  const maxima = new Float32Array(rows);
  for (let r = 0; r < rows; r++) {
    let maximum = -Infinity;
    for (let c = 0; c < classes; c++) maximum = Math.max(maximum, head[r * fields + 4 + c]);
    maxima[r] = maximum;
  }
  const anchors = topK(maxima, limit);
  const scores = new Float32Array(limit * classes);
  for (let r = 0; r < limit; r++) scores.set(head.subarray(anchors[r] * fields + 4, anchors[r] * fields + 4 + classes), r * classes);
  const candidates = topK(scores, limit);
  const result = new Float32Array(limit * (6 + channels));
  for (let r = 0; r < limit; r++) {
    const candidate = candidates[r];
    const source = anchors[Math.floor(candidate / classes)] * fields;
    const offset = r * (6 + channels);
    result.set(head.subarray(source, source + 4), offset);
    result[offset + 4] = scores[candidate];
    result[offset + 5] = candidate % classes;
    result.set(head.subarray(source + 4 + classes, source + fields), offset + 6);
  }
  return result;
}
