import type { Track } from '../state/contracts';
import type { FaceBox } from './semantic';
import type { FaceAssociationMode } from '../config/settings';

export interface FaceAssociation { faceIndex: number; trackId?: string; ambiguous: boolean }
export interface FaceAssociationThresholds { coverage: number; margin: number; centerMaskConfidence: number }
const DEFAULT_THRESHOLDS: FaceAssociationThresholds = { coverage: 0.7, margin: 0.2, centerMaskConfidence: 0.65 };

/** Assigns only faces whose central region has a clear, unique instance-mask owner. */
export function associateFaces(faces: FaceBox[], tracks: Track[], size: number, mode: FaceAssociationMode = 'overlap', thresholds: FaceAssociationThresholds = DEFAULT_THRESHOLDS): FaceAssociation[] {
  const results = faces.map((face, faceIndex): FaceAssociation => {
    const { x, y, width, height } = face.box;
    if (mode === 'center') {
      const px = Math.floor((x + width / 2) * size);
      const py = Math.floor((y + height / 2) * size);
      if (px < 0 || px >= size || py < 0 || py >= size) return { faceIndex, ambiguous: true };
      const owners = tracks.filter(track => track.mask[py * size + px] >= thresholds.centerMaskConfidence);
      return owners.length === 1
        ? { faceIndex, trackId: owners[0].id, ambiguous: false }
        : { faceIndex, ambiguous: true };
    }
    const x0 = Math.max(0, Math.floor((x + width * 0.25) * size));
    const x1 = Math.min(size, Math.ceil((x + width * 0.75) * size));
    const y0 = Math.max(0, Math.floor((y + height * 0.25) * size));
    const y1 = Math.min(size, Math.ceil((y + height * 0.75) * size));
    const area = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    if (area < 4) return { faceIndex, ambiguous: true };
    const scores = tracks.map(track => {
      let covered = 0;
      for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) {
        if (track.mask[py * size + px] >= thresholds.centerMaskConfidence) covered++;
      }
      return covered / area;
    });
    const ranked = tracks.map((track, index) => ({ track, score: scores[index] })).sort((a, b) => b.score - a.score);
    if (!ranked[0] || ranked[0].score < thresholds.coverage || ranked[0].score - (ranked[1]?.score ?? 0) < thresholds.margin) return { faceIndex, ambiguous: true };
    // A profile nose can extend beyond the person's YOLO mask even when the
    // face's central region is fully owned. Abstain if another person owns
    // the nose, but do not reject an otherwise unique face for empty pixels.
    if (face.nose) {
      const nx = Math.floor(face.nose.x * size), ny = Math.floor(face.nose.y * size);
      if (nx >= 0 && nx < size && ny >= 0 && ny < size &&
        tracks.some(track => track.id !== ranked[0].track.id && track.mask[ny * size + nx] >= thresholds.centerMaskConfidence)) {
        return { faceIndex, ambiguous: true };
      }
    }
    return { faceIndex, trackId: ranked[0].track.id, ambiguous: false };
  });
  const conflicts = new Set(results.filter(result => result.trackId && results.filter(other => other.trackId === result.trackId).length > 1).map(result => result.trackId));
  for (const result of results) {
    if (result.trackId && conflicts.has(result.trackId)) {
      result.trackId = undefined;
      result.ambiguous = true;
    }
  }
  return results;
}
