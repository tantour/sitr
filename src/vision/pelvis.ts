// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import type { PersonDetection } from '../state/contracts';

type Point = { x: number; y: number };
export interface PelvisEstimate {
  origin: Point;
  down: Point;
  height: number;
  width: number;
  thighs?: Array<{ hip: Point; knee: Point }>;
}
export type RegionPerson = Pick<PersonDetection, 'mask' | 'maskWidth' | 'maskHeight'>;
export interface PoseHeads { heatmaps: Float32Array; offsets: Float32Array; inputSide: number }

/** Use instance masks, never a frame-wide body box: adjacent people must not
 * contribute each other's torso or leg evidence. Reject ambiguous overlaps. */
export function regionOwner(people: readonly RegionPerson[], x: number, y: number): number {
  let owner = -1, best = .5, second = 0;
  for (let i = 0; i < people.length; i++) {
    const person = people[i];
    const value = person.mask[Math.min(person.maskHeight - 1, Math.round(y * (person.maskHeight - 1))) * person.maskWidth +
      Math.min(person.maskWidth - 1, Math.round(x * (person.maskWidth - 1)))];
    if (value > best) { second = Math.max(second, owner < 0 ? 0 : best); best = value; owner = i; }
    else if (value > second) second = value;
  }
  return owner >= 0 && best - second >= .15 ? owner : -1;
}

const quantile = (sorted: number[], fraction: number) => sorted[Math.round((sorted.length - 1) * fraction)];
const mean = (points: Point[]): Point => ({ x: points.reduce((n, p) => n + p.x, 0) / points.length,
  y: points.reduce((n, p) => n + p.y, 0) / points.length });

/** BodyPix has no groin class. Locate the pelvis from its clothed torso and
 * upper-leg predictions, using a local torso axis rather than image vertical.
 * Sparse, cropped, overlapping or implausible evidence yields no estimate. */
export function estimatePelvis(labels: Uint8Array, grid: number, people: readonly RegionPerson[]): Array<PelvisEstimate | undefined> {
  const evidence = people.map(() => ({ torso: [] as Point[], legs: [] as Point[] }));
  for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
    const label = labels[y * grid + x];
    if (label < 13 || label > 18) continue; // channels 12–17 stored as IDs 13–18
    const point = { x: x / (grid - 1), y: y / (grid - 1) };
    const owner = regionOwner(people, point.x, point.y);
    if (owner >= 0) (label <= 14 ? evidence[owner].torso : evidence[owner].legs).push(point);
  }
  return evidence.map(({ torso, legs }) => {
    if (torso.length < 6 || legs.length < 4) return;
    const center = mean(torso), legCenter = mean(legs);
    let dx = legCenter.x - center.x, dy = legCenter.y - center.y;
    const length = Math.hypot(dx, dy);
    if (length < 2 / (grid - 1)) return;
    dx /= length; dy /= length;
    // The torso principal axis handles leaning/rotated bodies and bent legs.
    let xx = 0, xy = 0, yy = 0;
    for (const p of torso) { const x = p.x - center.x, y = p.y - center.y; xx += x * x; xy += x * y; yy += y * y; }
    const spread = Math.hypot(xx - yy, 2 * xy), major = (xx + yy + spread) / 2, minor = (xx + yy - spread) / 2;
    if (major > 1.5 * minor) {
      const angle = .5 * Math.atan2(2 * xy, xx - yy);
      let ax = Math.cos(angle), ay = Math.sin(angle);
      const alignment = ax * dx + ay * dy;
      if (Math.abs(alignment) < .35) return;
      if (alignment < 0) { ax = -ax; ay = -ay; }
      dx = ax; dy = ay;
    }
    const along = (p: Point) => (p.x - center.x) * dx + (p.y - center.y) * dy;
    const across = (p: Point) => (p.x - center.x) * dy - (p.y - center.y) * dx;
    const positions = torso.map(along).sort((a, b) => a - b);
    const top = quantile(positions, .02), bottom = quantile(positions, .98), height = bottom - top;
    if (height < 3 / (grid - 1) || along(legCenter) < top + .65 * height) return;
    const hip = torso.filter(p => along(p) >= top + .6 * height).map(across).sort((a, b) => a - b);
    if (hip.length < 4) return;
    const left = quantile(hip, .05), right = quantile(hip, .95), width = right - left;
    if (width < 1 / (grid - 1) || width / height < .2 || width / height > 1.6) return;
    const middle = (left + right) / 2;
    return { origin: { x: center.x + top * dx + middle * dy, y: center.y + top * dy - middle * dx },
      down: { x: dx, y: dy }, height, width };
  });
}

/** Original BodyPix/PoseNet keypoint order and short offsets: Y in channels
 * 0–16, X in 17–33. Decode each person's maxima inside its own instance mask.
 * No new weights or separate model run. Corrected points must still be owned
 * by that person; uncertain or implausible landmark pairs are rejected. */
export function estimatePosePelvis(pose: PoseHeads, grid: number, people: readonly RegionPerson[],
  dense: Array<PelvisEstimate | undefined>): Array<PelvisEstimate | undefined> {
  const plane = grid * grid;
  if (pose.heatmaps.length !== 17 * plane || pose.offsets.length !== 34 * plane || pose.inputSide < 2)
    throw new Error('BodyPix pose output grid mismatch');
  return people.map((_, person) => {
    const keypoint = (channel: number): Point | undefined => {
      let best = -Infinity, point: Point | undefined;
      for (let p = 0; p < plane; p++) {
        const score = pose.heatmaps[channel * plane + p];
        if (!Number.isFinite(score) || score < -.4 || score <= best) continue; // sigmoid >= .40
        const gx = p % grid / (grid - 1), gy = Math.floor(p / grid) / (grid - 1);
        if (regionOwner(people, gx, gy) !== person) continue;
        const y = gy + pose.offsets[channel * plane + p] / (pose.inputSide - 1);
        const x = gx + pose.offsets[(channel + 17) * plane + p] / (pose.inputSide - 1);
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1 ||
            regionOwner(people, x, y) !== person) continue;
        best = score; point = { x, y };
      }
      return point;
    };
    const leftHip = keypoint(11), rightHip = keypoint(12);
    const leftShoulder = keypoint(5), rightShoulder = keypoint(6);
    if (!leftHip || !rightHip || !leftShoulder || !rightShoulder) return;
    const hip = mean([leftHip, rightHip]), shoulder = mean([leftShoulder, rightShoulder]);
    const height = Math.hypot(hip.x - shoulder.x, hip.y - shoulder.y);
    if (height < 1.5 / (grid - 1)) return;
    const dx = (hip.x - shoulder.x) / height, dy = (hip.y - shoulder.y) / height;
    const separation = Math.hypot(leftHip.x - rightHip.x, leftHip.y - rightHip.y);
    if (separation > 1.2 * height || Math.abs((leftHip.x - rightHip.x) * dx + (leftHip.y - rightHip.y) * dy) > .4 * height) return;
    // Hip joints sit inside the silhouette. Dense torso width supports profile
    // views where the left/right joints nearly coincide, but never moves hips.
    const width = Math.max(separation * 1.65, dense[person]?.width ?? 0);
    if (width < 1 / (grid - 1) || width / height > 1.6) return;
    const thighs: Array<{ hip: Point; knee: Point }> = [];
    for (const [hip, channel] of [[leftHip, 13], [rightHip, 14]] as const) {
      const knee = keypoint(channel);
      if (!knee) continue;
      const length = Math.hypot(knee.x - hip.x, knee.y - hip.y);
      if (length >= .3 * height && length <= 1.8 * height) thighs.push({ hip, knee });
    }
    return { origin: shoulder, down: { x: dx, y: dy }, height, width, thighs };
  });
}

/** Groin/pelvis is a tapering band over the lower torso and proximal legs.
 * Repair the outer upper thighs that BodyPix often includes in its torso.
 * Other learned parts (especially hands over the pelvis) retain their labels. */
export function pelvicRegion(region: number, x: number, y: number, pelvis?: PelvisEstimate): number {
  if (!pelvis || ![1, 5, 6].includes(region)) return region;
  const px = x - pelvis.origin.x, py = y - pelvis.origin.y;
  const along = (px * pelvis.down.x + py * pelvis.down.y) / pelvis.height;
  let cross = px * pelvis.down.y - py * pelvis.down.x;
  let groinEnd = 1.45;
  if (pelvis.thighs?.length) {
    const direction = mean(pelvis.thighs.map(t => ({ x: t.knee.x - t.hip.x, y: t.knee.y - t.hip.y })));
    const forward = (direction.x * pelvis.down.x + direction.y * pelvis.down.y) / pelvis.height;
    if (forward > .2) {
      // Follow bent/crossed legs below the hips; extrapolating torso lean
      // straight down would displace the crotch sideways. Stop above knees.
      groinEnd = Math.min(1.7, 1 + forward * .8);
      cross -= Math.max(0, along - 1) / forward * (direction.x * pelvis.down.y - direction.y * pelvis.down.x);
    }
  }
  const across = Math.abs(cross) / pelvis.width;
  if (along >= .9 && along <= groinEnd && across <= .65) {
    const halfWidth = .46 - Math.max(0, along - 1) / (groinEnd - 1) * .24;
    if (region !== 6 && across <= halfWidth) return 9;
    if (region === 1) return 5;
  }
  // Hip-to-knee segments recover the upper thighs even when dense parsing
  // drifts into torso or lower-leg labels. Arms/hands and unknowns are exempt.
  for (const thigh of pelvis.thighs ?? []) {
    const vx = thigh.knee.x - thigh.hip.x, vy = thigh.knee.y - thigh.hip.y;
    const length = Math.hypot(vx, vy);
    const t = ((x - thigh.hip.x) * vx + (y - thigh.hip.y) * vy) / (length * length);
    const distance = Math.abs((x - thigh.hip.x) * vy - (y - thigh.hip.y) * vx) / length;
    if (t >= 0 && t <= .98 && distance <= pelvis.width * .28) return 5;
  }
  return region;
}
