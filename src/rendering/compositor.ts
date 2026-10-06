// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { DEFAULT_SETTINGS, ENGINE, type Settings } from '../config/settings';
import type { Track, TrackObservation } from '../state/contracts';
import { personSelected } from '../rules/evaluate';

export interface Composition { observations: TrackObservation[]; ambiguous: Uint8Array; ambiguousByTrack: Uint8Array[]; unassignedMask: Uint8Array; uncertainMask: Uint8Array; uncertainByTrack: Uint8Array[]; unassignedForeground: number }

/** Input masks and semantic categories must describe the same frame and grid. */
export function compose(tracks: Track[], semantic: Uint8Array, width: number, height: number,
  settings: Settings = DEFAULT_SETTINGS, fallbackCoverage: Settings['imageCoverage'] = 'regions'): Composition {
  const count = width * height;
  if (semantic.length !== count || tracks.some(t => t.mask.length !== count)) throw new Error('Mask grid mismatch');
  const owned = tracks.map(() => new Uint8Array(count));
  const body = tracks.map(() => new Uint8Array(count));
  const hair = tracks.map(() => new Uint8Array(count));
  const face = tracks.map(() => new Uint8Array(count));
  const ambiguous = new Uint8Array(count);
  const ambiguousByTrack = tracks.map(() => new Uint8Array(count));
  const unassignedMask = new Uint8Array(count);
  const uncertainMask = new Uint8Array(count);
  const uncertainByTrack = tracks.map(() => new Uint8Array(count));
  const ambiguousCounts = tracks.map(() => 0);
  const ownedCounts = tracks.map(() => 0);
  const skinCounts = tracks.map(() => 0);
  let unassignedForeground = 0;
  for (let p = 0; p < count; p++) {
    let best = -1, top = 0.5, second = 0;
    for (let t = 0; t < tracks.length; t++) {
      const value = tracks[t].mask[p];
      if (value > top) { second = top; top = value; best = t; }
      else if (value > second) second = value;
    }
    if (best < 0) {
      const category = semantic[p];
      const selectedCategory = fallbackCoverage === 'regions'
        ? (category === 1 && settings.hair) || (category === 2 && settings.bodySkin) || (category === 3 && settings.faceSkin)
        : category !== 0 && (category !== 3 || fallbackCoverage === 'whole-body-face');
      if (selectedCategory && settings.filter !== 'off' && settings.imageUnknown !== 'allow') {
        // A few semantic pixels just outside a known exempt person's instance
        // are not evidence for a different person. Do not paint a black halo.
        const x = p % width, y = Math.floor(p / width);
        let nearbyCount = 0;
        let nearbySelected = true;
        for (const track of tracks) {
          if (x < track.box.x * width - 2 || x >= (track.box.x + track.box.width) * width + 2 ||
            y < track.box.y * height - 2 || y >= (track.box.y + track.box.height) * height + 2) continue;
          nearbyCount++;
          if (nearbyCount > 1) break;
          nearbySelected = personSelected(track, settings, 'image');
        }
        if (nearbyCount !== 1 || nearbySelected) {
          unassignedForeground++; unassignedMask[p] = 255;
        }
      }
      continue;
    }
    if (second >= 0.5 && top - second < ENGINE.ownershipMargin) {
      ambiguous[p] = 255;
      const selectedCategory = (semantic[p] === 1 && settings.hair) || (semantic[p] === 2 && settings.bodySkin) || (semantic[p] === 3 && settings.faceSkin);
      for (let t = 0; t < tracks.length; t++) if (tracks[t].mask[p] >= 0.5) {
        ambiguousCounts[t]++;
        if (selectedCategory && settings.filter !== 'off') ambiguousByTrack[t][p] = 255;
      }
      continue;
    }
    owned[best][p] = 255;
    ownedCounts[best]++;
    if (semantic[p] === 1) hair[best][p] = 255;
    if (semantic[p] === 2) { body[best][p] = 255; skinCounts[best]++; }
    if (semantic[p] === 3) face[best][p] = 255;
  }
  const observations = tracks.map((track, i): TrackObservation => {
    const area = ownedCounts[i], skin = skinCounts[i];
    const uncertain = ambiguousCounts[i] / Math.max(1, area + ambiguousCounts[i]);
    return {
      id: track.id, box: track.box, label: track.label, labelUsable: track.labelUsable,
      state: track.state, ownedMask: owned[i], bodySkinMask: body[i], hairMask: hair[i], faceSkinMask: face[i],
      exposure: { ratio: skin / Math.max(1, area), ownedPixels: area, ambiguousFraction: uncertain,
        reliable: area >= ENGINE.minOwnedPixels && uncertain <= ENGINE.maxAmbiguousFraction },
    };
  });
  for (let i = 0; i < tracks.length; i++) {
    if (observations[i].exposure.reliable && tracks[i].state !== 'ambiguous') continue;
    for (let p = 0; p < count; p++) {
      const selectedCategory = (semantic[p] === 1 && settings.hair) || (semantic[p] === 2 && settings.bodySkin) || (semantic[p] === 3 && settings.faceSkin);
      if (tracks[i].mask[p] >= 0.25 && selectedCategory && settings.filter !== 'off') {
        uncertainMask[p] = 255;
        uncertainByTrack[i][p] = 255;
      }
    }
  }
  return { observations, ambiguous, ambiguousByTrack, unassignedMask, uncertainMask, uncertainByTrack, unassignedForeground };
}

/** Drop isolated one-to-three-pixel model artifacts before edge expansion. */
export function pruneIslands(source: Uint8Array, width: number, height: number, minArea = 4): Uint8Array {
  const out = source.slice();
  const seen = new Uint8Array(source.length);
  const queue = new Int32Array(source.length);
  let head = 0, tail = 0, area = 0;
  // Enqueue whole horizontal runs. Each protected pixel is marked once,
  // instead of testing all eight neighbors for every pixel in a large mask.
  const enqueue = (seed: number, rowStart: number, rowEnd: number): number => {
    let left = seed, right = seed + 1;
    while (left > rowStart && source[left - 1]) left--;
    while (right < rowEnd && source[right]) right++;
    seen.fill(1, left, right);
    queue[tail++] = left;
    area += right - left;
    return right;
  };
  for (let start = 0; start < source.length; start++) {
    if (!source[start] || seen[start]) continue;
    head = tail = area = 0;
    const firstRow = Math.floor(start / width) * width;
    enqueue(start, firstRow, firstRow + width);
    while (head < tail) {
      const left = queue[head++], rowStart = Math.floor(left / width) * width;
      let right = left + 1;
      while (right < rowStart + width && source[right]) right++;
      const x0 = Math.max(0, left - rowStart - 1);
      const x1 = Math.min(width, right - rowStart + 1);
      for (let neighborRow = rowStart - width; neighborRow <= rowStart + width; neighborRow += 2 * width) {
        if (neighborRow < 0 || neighborRow >= width * height) continue;
        for (let next = neighborRow + x0; next < neighborRow + x1;) {
          if (source[next] && !seen[next]) next = enqueue(next, neighborRow, neighborRow + width);
          else next++;
        }
      }
    }
    if (area < minArea) for (let i = 0; i < tail; i++) {
      const left = queue[i], rowEnd = (Math.floor(left / width) + 1) * width;
      let right = left + 1;
      while (right < rowEnd && source[right]) right++;
      out.fill(0, left, right);
    }
  }
  return out;
}

export function dilate(source: Uint8Array, width: number, height: number, radius = 2): Uint8Array {
  if (radius <= 0) return source.slice();
  // A square dilation is separable. This avoids a (2r+1)^2 write loop for
  // each protected pixel when video masks need a wider motion margin.
  const horizontal = new Uint8Array(source.length);
  const out = new Uint8Array(source.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let count = 0;
    for (let x = 0; x < width; x++) {
      if (x === 0) {
        for (let i = 0; i <= Math.min(radius, width - 1); i++) if (source[row + i]) count++;
      } else {
        if (x + radius < width && source[row + x + radius]) count++;
        if (x > radius && source[row + x - radius - 1]) count--;
      }
      horizontal[row + x] = count ? 255 : 0;
    }
  }
  // Sweep contiguous rows in the vertical pass too, avoiding strided reads
  // across the entire grid for each column.
  const counts = new Int32Array(width);
  for (let y = 0; y <= Math.min(radius, height - 1); y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) if (horizontal[row + x]) counts[x]++;
  }
  for (let y = 0; y < height; y++) {
    const row = y * width, addRow = (y + radius) * width, removeRow = (y - radius - 1) * width;
    for (let x = 0; x < width; x++) {
      if (y > 0 && y + radius < height && horizontal[addRow + x]) counts[x]++;
      if (y > radius && horizontal[removeRow + x]) counts[x]--;
      out[row + x] = counts[x] ? 255 : 0;
    }
  }
  return out;
}
