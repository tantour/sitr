// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { BODY_REGIONS, type BodyRegion, type Settings } from '../config/settings';
import type { TrackObservation } from '../state/contracts';
import { hasBodyCoverage, policyFor } from '../config/personPolicy';
import { estimatePelvis, estimatePosePelvis, pelvicRegion, regionOwner, type RegionPerson, type PoseHeads, type PelvisEstimate } from './pelvis';

/** Official channel order: left upper front/back, right upper front/back,
 * left lower front/back, right lower front/back. IDs 1–8 follow BODY_REGIONS;
 * groin is appended as ID 9 and estimated separately.
 * https://github.com/tensorflow/tfjs-models/blob/master/body-pix/src/part_channels.ts */
export const BODYPIX_REGION_IDS = new Uint8Array([8, 8, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4,
  1, 1, 5, 5, 5, 5, 6, 6, 6, 6, 7, 7]);
export function bodyRegionsEnabled(settings: Settings, kind: 'image' | 'video'): boolean {
  return kind === 'image' && settings.imageCoverage === 'regions' && hasBodyCoverage(settings) && settings.imageBodyRegionMode !== 'off';
}
export function allowedRegionIds(observation: Pick<TrackObservation, 'label' | 'labelUsable'>, settings: Settings): Uint8Array {
  const allowed = new Uint8Array(BODY_REGIONS.length + 1);
  if (settings.personPolicies) {
    const policy = policyFor(settings, observation);
    allowed[0] = Number(policy.otherSkin === 'show');
    BODY_REGIONS.forEach((area, index) => { allowed[index + 1] = Number(policy.skin[area] === 'show'); });
    return allowed;
  }
  if (!observation.labelUsable || observation.label === 'unknown') return allowed;
  const regions = observation.label === 'female' ? settings.imageFemaleAllowedRegions : settings.imageMaleAllowedRegions;
  for (const region of regions) allowed[BODY_REGIONS.indexOf(region) + 1] = 1;
  return allowed;
}
export function regionName(id: number): BodyRegion | undefined { return BODY_REGIONS[id - 1]; }

/** Bilinear interpolation matches the original graph's align-corners upsampling.
 * Decode only skin, retaining unknown regions for conservative coverage. */
export function decodeBodyRegions(parts: Float32Array, foreground: Float32Array, grid: number,
  semantic: Uint8Array, side: number, people: readonly RegionPerson[] = [], pose?: PoseHeads,
  geometry?: { pelvis: Array<PelvisEstimate | undefined> }): Uint8Array {
  const plane = grid * grid;
  if (parts.length !== plane * 24 || foreground.length !== plane || semantic.length !== side * side || grid < 2 || side < 2)
    throw new Error('BodyPix output grid mismatch');
  const regions = new Uint8Array(semantic.length);
  // The existing dense heads predict anatomy through clothing. Keep a small
  // confident grid for geometry; output remains strictly semantic body skin.
  const labels = new Uint8Array(plane);
  if (people.length) for (let p = 0; p < plane; p++) {
    if (!Number.isFinite(foreground[p]) || foreground[p] < 0) continue;
    let best = -Infinity, second = -Infinity, label = -1;
    for (let part = 0; part < 24; part++) {
      const score = parts[part * plane + p];
      if (!Number.isFinite(score)) { label = -1; break; }
      if (score > best) { second = best; best = score; label = part; }
      else if (score > second) second = score;
    }
    if (label >= 0 && best - second >= .35) labels[p] = label + 1;
  }
  const dense = estimatePelvis(labels, grid, people);
  const pelvis = pose ? estimatePosePelvis(pose, grid, people, dense) : dense;
  if (geometry) geometry.pelvis = pelvis;
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const pixel = y * side + x;
    if (semantic[pixel] !== 2) continue;
    const gx = x * (grid - 1) / (side - 1), gy = y * (grid - 1) / (side - 1);
    const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(grid - 1, x0 + 1), y1 = Math.min(grid - 1, y0 + 1);
    const fx = gx - x0, fy = gy - y0;
    const a = y0 * grid + x0, b = y0 * grid + x1, c = y1 * grid + x0, d = y1 * grid + x1;
    const score = (data: Float32Array, channel: number) => {
      const offset = channel * plane;
      return (data[offset + a] * (1 - fx) + data[offset + b] * fx) * (1 - fy) +
        (data[offset + c] * (1 - fx) + data[offset + d] * fx) * fy;
    };
    const confidence = score(foreground, 0);
    if (!Number.isFinite(confidence) || confidence < 0) continue;
    let best = -Infinity, label = -1;
    for (let part = 0; part < 24; part++) {
      const value = score(parts, part);
      if (!Number.isFinite(value)) { label = -1; break; }
      if (value > best) { best = value; label = part; }
    }
    if (label >= 0) {
      const region = BODYPIX_REGION_IDS[label];
      const nx = x / (side - 1), ny = y / (side - 1);
      regions[pixel] = region === 1 || region === 5 || region === 6
        ? pelvicRegion(region, nx, ny, pelvis[regionOwner(people, nx, ny)]) : region;
    }
  }
  return regions;
}
