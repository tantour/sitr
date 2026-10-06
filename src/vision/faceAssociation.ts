// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import type { Track } from '../state/contracts';
import type { FaceBox } from './semantic';
import type { FaceAssociationMode } from '../config/settings';

export interface FaceAssociation { faceIndex: number; trackId?: string; ambiguous: boolean }
export interface FaceAssociationThresholds { coverage: number; margin: number; centerMaskConfidence: number }
const DEFAULT_THRESHOLDS: FaceAssociationThresholds = { coverage: 0.7, margin: 0.2, centerMaskConfidence: 0.65 };

function maskCoverage(track: Track, size: number, x0: number, y0: number, x1: number, y1: number, confidence: number): number {
  const left = Math.max(0, Math.floor(x0 * size));
  const top = Math.max(0, Math.floor(y0 * size));
  const right = Math.min(size, Math.ceil(x1 * size));
  const bottom = Math.min(size, Math.ceil(y1 * size));
  const area = Math.max(0, right - left) * Math.max(0, bottom - top);
  if (area < 1) return 0;
  let covered = 0;
  for (let py = top; py < bottom; py++) for (let px = left; px < right; px++) {
    if (track.mask[py * size + px] >= confidence) covered++;
  }
  return covered / area;
}

function plausibleHeadBox(face: FaceBox, track: Track): boolean {
  const { x, y, width, height } = face.box;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const box = track.box;
  return centerX >= box.x && centerX <= box.x + box.width &&
    centerY >= box.y - Math.max(height * 0.75, box.height * 0.18) &&
    centerY <= box.y + box.height * 0.58 &&
    width <= box.width * 0.9;
}

function faceInsideBox(face: FaceBox, box: Track['box']): number {
  const x0 = Math.max(face.box.x, box.x), y0 = Math.max(face.box.y, box.y);
  const x1 = Math.min(face.box.x + face.box.width, box.x + box.width);
  const y1 = Math.min(face.box.y + face.box.height, box.y + box.height);
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0) /
    Math.max(1e-6, face.box.width * face.box.height);
}

/** Associates a face using mask ownership, then unique head-box evidence when the head mask is absent. */
export function associateFaces(faces: FaceBox[], tracks: Track[], size: number, mode: FaceAssociationMode = 'overlap', thresholds: FaceAssociationThresholds = DEFAULT_THRESHOLDS): FaceAssociation[] {
  const proposals = faces.map((face, faceIndex) => {
    const { x, y, width, height } = face.box;
    const px = Math.floor((x + width / 2) * size);
    const py = Math.floor((y + height / 2) * size);
    const centerInFrame = px >= 0 && px < size && py >= 0 && py < size;
    const core = [x + width * 0.25, y + height * 0.25, x + width * 0.75, y + height * 0.75] as const;
    const softConfidence = Math.min(0.35, thresholds.centerMaskConfidence);
    const ranked = tracks.map(track => ({
      track,
      strong: maskCoverage(track, size, ...core, thresholds.centerMaskConfidence),
      coverage: maskCoverage(track, size, ...core, softConfidence),
      nearby: maskCoverage(track, size, x - width * 0.15, y + height * 0.65,
        x + width * 1.15, y + height * 1.55, softConfidence),
      plausible: plausibleHeadBox(face, track),
      centerValue: centerInFrame ? track.mask[py * size + px] : 0,
    }));
    // A person detector can emit several overlapping masks for one person.
    // Mask ownership remains the gate, but detector confidence and the pixels
    // below the face distinguish duplicate/merged instances in crowded shots.
    const score = (candidate: typeof ranked[number]): number =>
      1.4 * candidate.coverage + 0.5 * candidate.strong + candidate.nearby +
      0.5 * candidate.centerValue + 2.5 * candidate.track.score;
    ranked.sort((a, b) => score(b) - score(a));
    const winner = ranked[0];
    if (!winner) return undefined;
    let owner: typeof winner | undefined;
    if (ranked.some(candidate => candidate.coverage > 0)) {
      // Coverage is the actual slider gate for every mask-based association.
      // Compare only eligible owners, so a mask that merely brushes a face
      // cannot block a genuine owner with a higher detector score.
      const eligible = ranked.filter(candidate => candidate.coverage >= thresholds.coverage);
      if (mode === 'center') {
        const centerOwners = eligible.filter(candidate => candidate.centerValue >= thresholds.centerMaskConfidence);
        if (centerOwners.length !== 1) return undefined;
        owner = centerOwners[0];
      } else {
        const best = eligible[0];
        if (!best || (eligible[1] && score(best) - score(eligible[1]) < thresholds.margin)) return undefined;
        owner = best;
      }
    } else {
      // YOLO sometimes omits a head while retaining the shoulders. Use box
      // geometry only when there is no measurable face-mask ownership.
      const plausible = ranked.filter(candidate => candidate.plausible && candidate.nearby >= 0.12);
      if (plausible.length !== 1) return undefined;
      owner = plausible[0];
    }
    // A profile nose can extend beyond the person's YOLO mask even when the
    // face's central region is fully owned. Abstain if another person owns
    // the nose, but do not reject an otherwise unique face for empty pixels.
    if (face.nose) {
      const nx = Math.floor(face.nose.x * size), ny = Math.floor(face.nose.y * size);
      if (nx >= 0 && nx < size && ny >= 0 && ny < size &&
        ranked.some(candidate => candidate.track.id !== owner.track.id &&
          candidate.coverage < thresholds.coverage &&
          candidate.track.mask[ny * size + nx] >= thresholds.centerMaskConfidence)) {
        return undefined;
      }
    }
    return { faceIndex, trackId: owner.track.id, score: score(owner) };
  });
  const byTrack = new Map<string, NonNullable<typeof proposals[number]>[]>();
  for (const proposal of proposals) if (proposal) {
    const group = byTrack.get(proposal.trackId) ?? [];
    group.push(proposal);
    byTrack.set(proposal.trackId, group);
  }
  const accepted = new Set<number>();
  for (const group of byTrack.values()) {
    group.sort((a, b) => b.score - a.score);
    // A shared mask can cover two faces. Give it to the face with clearly
    // stronger ownership instead of discarding both; tied faces still abstain.
    if (group.length === 1 || group[0].score - group[1].score >= thresholds.margin)
      accepted.add(group[0].faceIndex);
  }
  const owners = new Map<number, string>();
  const usedTracks = new Set<string>();
  for (const index of accepted) {
    const id = proposals[index]!.trackId;
    owners.set(index, id);
    usedTracks.add(id);
  }
  // YOLO can emit a separate, low-score mask for just the visible top of a
  // head. Recover it only when its small box uniquely fits one unmatched face;
  // this avoids giving a shared full-body mask to two different people.
  for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
    if (owners.has(faceIndex)) continue;
    const face = faces[faceIndex];
    const { x, y, width, height } = face.box;
    const core = [x + width * 0.25, y + height * 0.25,
      x + width * 0.75, y + height * 0.75] as const;
    const fragments = tracks.flatMap(track => {
      if (usedTracks.has(track.id) || track.score < 0.15 ||
          track.box.width > width * 1.7 || track.box.height > height * 1.4) return [];
      const overlap = faceInsideBox(face, track.box);
      if (overlap < 0.55 || faces.some((other, index) => index !== faceIndex && faceInsideBox(other, track.box) > 0.35)) return [];
      const coverage = maskCoverage(track, size, ...core, Math.min(0.35, thresholds.centerMaskConfidence));
      if (coverage < Math.max(0.4, thresholds.coverage * 0.6)) return [];
      return [{ track, score: coverage + overlap + track.score }];
    }).sort((a, b) => b.score - a.score);
    if (!fragments[0] || (fragments[1] && fragments[0].score - fragments[1].score < thresholds.margin)) continue;
    owners.set(faceIndex, fragments[0].track.id);
    usedTracks.add(fragments[0].track.id);
  }
  return faces.map((_, faceIndex) => owners.has(faceIndex)
    ? { faceIndex, trackId: owners.get(faceIndex), ambiguous: false }
    : { faceIndex, ambiguous: true });
}

/** Box-only detector: associate a face with a unique upper-body box. */
export function associateFacesToBoxes(faces: FaceBox[], tracks: Track[]): FaceAssociation[] {
  const results = faces.map((face, faceIndex): FaceAssociation => {
    const cx = face.box.x + face.box.width / 2;
    const cy = face.box.y + face.box.height / 2;
    const ranked = tracks.flatMap(track => {
      const box = track.box;
      if (cx < box.x || cx > box.x + box.width || cy < box.y - box.height * 0.06 ||
          cy > box.y + box.height * 0.48 || face.box.width > box.width * 0.9) return [];
      const horizontal = Math.abs(cx - (box.x + box.width / 2)) / Math.max(0.01, box.width / 2);
      const vertical = Math.abs(cy - (box.y + box.height * 0.16)) / Math.max(0.01, box.height * 0.35);
      return [{ track, score: 1 - 0.55 * horizontal - 0.35 * vertical }];
    }).sort((a, b) => b.score - a.score);
    if (!ranked[0] || ranked[0].score < 0.35 || ranked[0].score - (ranked[1]?.score ?? 0) < 0.12)
      return { faceIndex, ambiguous: true };
    return { faceIndex, trackId: ranked[0].track.id, ambiguous: false };
  });
  const ownerCounts = new Map<string, number>();
  for (const result of results) if (result.trackId) ownerCounts.set(result.trackId, (ownerCounts.get(result.trackId) ?? 0) + 1);
  for (const result of results) if (result.trackId && ownerCounts.get(result.trackId)! > 1) {
    result.trackId = undefined;
    result.ambiguous = true;
  }
  return results;
}
