import { DEFAULT_SETTINGS, ENGINE, type Settings } from '../config/settings';
import type { Track, TrackObservation } from '../state/contracts';
import { personSelected } from '../rules/evaluate';

export interface Composition { observations: TrackObservation[]; ambiguous: Uint8Array; ambiguousByTrack: Uint8Array[]; unassignedMask: Uint8Array; uncertainMask: Uint8Array; uncertainByTrack: Uint8Array[]; unassignedForeground: number }

/** Input masks and semantic categories must describe the same frame and grid. */
export function compose(tracks: Track[], semantic: Uint8Array, width: number, height: number, settings: Settings = DEFAULT_SETTINGS): Composition {
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
      const selectedCategory = (category === 1 && settings.hair) || (category === 2 && settings.bodySkin) || (category === 3 && settings.faceSkin);
      if (selectedCategory && settings.filter !== 'off') {
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
          nearbySelected = personSelected(track, settings);
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
    if (semantic[p] === 1) hair[best][p] = 255;
    if (semantic[p] === 2) body[best][p] = 255;
    if (semantic[p] === 3) face[best][p] = 255;
  }
  const observations = tracks.map((track, i): TrackObservation => {
    let area = 0, skin = 0;
    for (let p = 0; p < count; p++) {
      if (owned[i][p]) area++;
      if (body[i][p]) skin++;
    }
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
  for (let start = 0; start < source.length; start++) {
    if (!source[start] || seen[start]) continue;
    let head = 0, tail = 1;
    queue[0] = start; seen[start] = 1;
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (source[next] && !seen[next]) { seen[next] = 1; queue[tail++] = next; }
      }
    }
    if (tail < minArea) for (let i = 0; i < tail; i++) out[queue[i]] = 0;
  }
  return out;
}

export function dilate(source: Uint8Array, width: number, height: number, radius = 2): Uint8Array {
  const out = source.slice();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!source[y * width + x]) continue;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) out[ny * width + nx] = 255;
    }
  }
  return out;
}
