// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { ENGINE, type Label } from '../config/settings';
import type { PersonDetection, Rect, Track } from '../state/contracts';
import { appearanceSimilarity } from './appearance';

function area(b: Rect): number { return Math.max(0, b.width) * Math.max(0, b.height); }
function iou(a: Rect, b: Rect): number {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width), y1 = Math.min(a.y + a.height, b.y + b.height);
  const overlap = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return overlap / Math.max(1e-6, area(a) + area(b) - overlap);
}
function predicted(track: Track, at: number): Rect {
  const dt = Math.min(0.5, Math.max(0, at - track.lastSeen) / 1000);
  return { ...track.box, x: track.box.x + track.velocityX * dt, y: track.box.y + track.velocityY * dt };
}

/** Two-stage ByteTrack-style detection association. Labels are invalidated on doubtful motion. */
export class ByteTracker {
  private tracks = new Map<string, Track>();
  private nextId = 1;
  constructor(private readonly sessionId: string) {}

  update(detections: PersonDetection[], now: number, isStatic = false, motionBoxes?: Map<string, Rect>,
    includeLowConfidenceStatic = false): Track[] {
    const high = detections.filter(d => d.score >= 0.25);
    const low = detections.filter(d => d.score >= 0.1 && d.score < 0.25);
    const existing = [...this.tracks.values()].filter(t => now - t.lastSeen <= ENGINE.lostTrackMs);
    const matchedTracks = new Set<string>();
    const matchedDetections = new Set<PersonDetection>();
    const matchStage = (candidates: PersonDetection[], threshold: number, allowLost: boolean, poseRecovery = false) => {
      // Consider every feasible pair. Selecting only each detection's favorite
      // track could strand another person when two boxes overlap during a pan.
      const availableTracks = existing.filter(track => !matchedTracks.has(track.id) && (allowLost || track.state !== 'lost'));
      const availableDetections = candidates.filter(detection => !matchedDetections.has(detection));
      const alone = availableTracks.length === 1 && availableDetections.length === 1;
      const proposals: Array<{ track: Track; detection: PersonDetection; overlap: number; score: number; appearance: number; poseRecovery: boolean }> = [];
      for (const detection of availableDetections) for (const track of availableTracks) {
        const anchor = motionBoxes?.get(track.id) ?? predicted(track, now);
        const matchOverlap = iou(anchor, detection.box);
        if (matchOverlap < threshold) continue;
        const appearance = appearanceSimilarity(track.appearance, detection.appearance);
        // A cut can replace someone at exactly the same coordinates. Position
        // alone must not carry their labels onto a clearly different appearance.
        if (!isStatic && track.appearance && detection.appearance && appearance < 0.55) continue;
        if (track.state === 'lost' && now - track.lastSeen > 400 &&
            (!track.appearance || !detection.appearance || appearance < 0.6)) continue;
        if (poseRecovery) {
          // When someone bends or lies down, the old tall box and new wide
          // box can have little IoU. Recover only a spatially connected,
          // visually matching person; abstain in a crowded ambiguous scene.
          const horizontalOverlap = Math.max(0, Math.min(anchor.x + anchor.width, detection.box.x + detection.box.width) -
            Math.max(anchor.x, detection.box.x)) / Math.max(0.001, Math.min(anchor.width, detection.box.width));
          const centerDistance = Math.hypot(anchor.x + anchor.width / 2 - detection.box.x - detection.box.width / 2,
            anchor.y + anchor.height / 2 - detection.box.y - detection.box.height / 2);
          const scale = Math.hypot(Math.max(anchor.width, detection.box.width), Math.max(anchor.height, detection.box.height));
          if (!track.appearance || !detection.appearance || appearance < (alone ? 0.62 : 0.8) ||
              horizontalOverlap < 0.5 || centerDistance > scale * 0.55) continue;
        }
        proposals.push({ track, detection, overlap: matchOverlap,
          score: matchOverlap + 0.8 * appearance, appearance, poseRecovery });
      }
      proposals.sort((a, b) => b.score - a.score);
      for (const proposal of proposals) {
        if (matchedTracks.has(proposal.track.id) || matchedDetections.has(proposal.detection)) continue;
        const { track, detection } = proposal;
        const dt = Math.max(0.001, (now - track.lastSeen) / 1000);
        const anchor = motionBoxes?.get(track.id) ?? track.box;
        const cxOld = anchor.x + anchor.width / 2;
        const cyOld = anchor.y + anchor.height / 2;
        const cxNew = detection.box.x + detection.box.width / 2;
        const cyNew = detection.box.y + detection.box.height / 2;
        const jump = Math.hypot(cxOld - cxNew, cyOld - cyNew);
        const rival = proposals.find(other => other !== proposal &&
          (other.track.id === track.id || other.detection === detection) &&
          !matchedTracks.has(other.track.id) && !matchedDetections.has(other.detection));
        const shapeScale = Math.hypot(Math.max(anchor.width, detection.box.width), Math.max(anchor.height, detection.box.height));
        const continuousPose = proposal.poseRecovery || (!!track.appearance && !!detection.appearance &&
          proposal.appearance >= 0.8 && !rival && proposal.overlap > 0.1 && jump <= shapeScale * 0.6);
        const ambiguous = (!!rival && proposal.score - rival.score < 0.06) ||
          (jump > 0.3 && !motionBoxes?.has(track.id) && !continuousPose) ||
          (track.state === 'lost' && proposal.overlap < 0.5 && proposal.appearance < 0.65 && !proposal.poseRecovery);
        if (ambiguous) {
          track.labelUsable = false;
          track.state = 'ambiguous';
          track.identityGeneration++;
          track.lastGenderCheckAt = undefined;
          if ((rival || proposal.appearance < 0.55) && track.labelSource === 'automatic') {
            track.label = 'unknown';
            track.labelSource = 'none';
            track.genderEvidence = 0;
            track.genderConfidence = 0;
            track.genderModelSource = undefined;
          }
        }
        else { track.state = isStatic || track.hits >= 1 ? 'active' : 'tentative'; }
        track.velocityX = 0.7 * track.velocityX + 0.3 * (cxNew - cxOld) / dt;
        track.velocityY = 0.7 * track.velocityY + 0.3 * (cyNew - cyOld) / dt;
        track.box = detection.box;
        track.mask = detection.mask;
        track.maskWidth = detection.maskWidth;
        track.maskHeight = detection.maskHeight;
        track.score = detection.score;
        if (detection.appearance) {
          if (!track.appearance) track.appearance = detection.appearance.slice();
          else for (let i = 0; i < track.appearance.length; i++)
            track.appearance[i] = 0.8 * track.appearance[i] + 0.2 * detection.appearance[i];
        }
        track.lastSeen = now;
        track.hits++;
        if (track.hits >= 2 && track.state === 'tentative') track.state = 'active';
        if (track.state === 'active' && track.labelSource === 'automatic' &&
            track.label === (track.genderEvidence > 0 ? 'male' : 'female') &&
            (Math.abs(track.genderEvidence) >= 2 ||
              (Math.abs(track.genderEvidence) === 1 && track.genderConfidence >= 0.95))) track.labelUsable = true;
        if (track.state === 'active' && track.labelSource === 'user') track.labelUsable = true;
        matchedTracks.add(track.id);
        matchedDetections.add(detection);
      }
    };
    matchStage(high, 0.3, true);
    matchStage(low, 0.4, false);
    matchStage(high, 0.07, true, true);
    // A still image has no later frame in which a weak but real person can
    // become a high-confidence detection. Keep detections above the configured
    // YOLO floor; video still requires the stronger first-frame threshold.
    for (const detection of isStatic && includeLowConfidenceStatic ? [...high, ...low] : high) {
      if (matchedDetections.has(detection)) continue;
      const id = `${this.sessionId}:${this.nextId++}`;
      this.tracks.set(id, {
        id, box: detection.box, mask: detection.mask, maskWidth: detection.maskWidth,
        maskHeight: detection.maskHeight, score: detection.score, appearance: detection.appearance?.slice(), firstSeen: now,
        lastSeen: now, hits: isStatic ? 2 : 1, state: isStatic ? 'active' : 'tentative', label: 'unknown',
        labelUsable: false, labelSource: 'none', genderConfidence: 0, genderEvidence: 0,
        identityGeneration: 0, velocityX: 0, velocityY: 0,
      });
    }
    for (const track of this.tracks.values()) {
      if (matchedTracks.has(track.id) || track.lastSeen === now) continue;
      if (now - track.lastSeen > ENGINE.lostTrackMs) this.tracks.delete(track.id);
      else { track.state = 'lost'; }
    }
    return [...this.tracks.values()].filter(t => t.lastSeen === now);
  }

  label(id: string, label: Label): boolean {
    const track = this.tracks.get(id);
    if (!track || track.state !== 'active') return false;
    track.label = label;
    track.labelUsable = label !== 'unknown';
    track.labelSource = label === 'unknown' ? 'none' : 'user';
    track.genderConfidence = track.labelUsable ? 1 : 0;
    track.genderEvidence = 0;
    track.genderModelSource = undefined;
    track.lastGenderCheckAt = undefined;
    return true;
  }

  estimateGender(id: string, label: 'male' | 'female', confidence: number, isStatic: boolean, minimumConfidence = 0.85,
    source: NonNullable<Track['genderModelSource']> = 'face'): boolean {
    const track = this.tracks.get(id);
    if (!track || track.state === 'lost' || track.state === 'ambiguous' || track.labelSource === 'user' || confidence < minimumConfidence) return false;
    const vote = label === 'male' ? 1 : -1;
    // Do not spend several seconds unwinding saturated evidence after a cut.
    // Opposite evidence invalidates the old video label immediately; a second
    // matching sample confirms the replacement. Face votes supersede body votes.
    if (!isStatic && track.labelSource === 'automatic' &&
        ((track.genderEvidence > 0 && vote < 0) || (track.genderEvidence < 0 && vote > 0) ||
          (track.genderModelSource !== undefined && track.genderModelSource !== source))) track.genderEvidence = 0;
    track.genderEvidence = Math.max(-6, Math.min(6, track.genderEvidence + vote));
    track.labelSource = 'automatic';
    track.genderModelSource = source;
    track.genderConfidence = confidence;
    // Keep the previous label unusable until repeat evidence confirms a change.
    if (isStatic || (track.genderEvidence >= 2 && vote > 0) || (track.genderEvidence <= -2 && vote < 0)) {
      track.label = label;
    } else if (track.label === 'unknown') {
      track.label = label;
    }
    track.labelUsable = track.state === 'active' && (isStatic || Math.abs(track.genderEvidence) >= 2 ||
      (Math.abs(track.genderEvidence) === 1 && confidence >= 0.95)) &&
      (track.label === (track.genderEvidence > 0 ? 'male' : 'female'));
    return track.labelUsable;
  }
  get(): Track[] { return [...this.tracks.values()]; }
  /** Adopt an already-cloned still-image snapshot. IDs stay stable for its
   * face associations; mutable labels belong exclusively to this tracker. */
  restoreImage(tracks: Track[]): void {
    this.tracks = new Map(tracks.map(track => [track.id, track]));
  }
  reset(): void { this.tracks.clear(); }
}
