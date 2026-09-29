import { ENGINE, type Label } from '../config/settings';
import type { PersonDetection, Rect, Track } from '../state/contracts';

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

  update(detections: PersonDetection[], now: number, isStatic = false): Track[] {
    const high = detections.filter(d => d.score >= 0.25);
    const low = detections.filter(d => d.score >= 0.1 && d.score < 0.25);
    const existing = [...this.tracks.values()].filter(t => now - t.lastSeen <= ENGINE.lostTrackMs);
    const matchedTracks = new Set<string>();
    const matchedDetections = new Set<PersonDetection>();
    const matchStage = (candidates: PersonDetection[], threshold: number, allowLost: boolean) => {
      const proposals: Array<{ track: Track; detection: PersonDetection; score: number; margin: number }> = [];
      for (const detection of candidates) {
        const possibilities = existing
          .filter(t => !matchedTracks.has(t.id) && (allowLost || t.state !== 'lost'))
          .map(track => ({ track, score: iou(predicted(track, now), detection.box) }))
          .sort((a, b) => b.score - a.score);
        const best = possibilities[0];
        if (best && best.score >= threshold) proposals.push({ track: best.track, detection, score: best.score, margin: best.score - (possibilities[1]?.score ?? 0) });
      }
      proposals.sort((a, b) => b.score - a.score);
      for (const proposal of proposals) {
        if (matchedTracks.has(proposal.track.id) || matchedDetections.has(proposal.detection)) continue;
        const { track, detection, margin } = proposal;
        const dt = Math.max(0.001, (now - track.lastSeen) / 1000);
        const cxOld = track.box.x + track.box.width / 2;
        const cyOld = track.box.y + track.box.height / 2;
        const cxNew = detection.box.x + detection.box.width / 2;
        const cyNew = detection.box.y + detection.box.height / 2;
        const jump = Math.hypot(cxOld - cxNew, cyOld - cyNew);
        const ambiguous = margin < 0.08 || jump > 0.3 || (track.state === 'lost' && proposal.score < 0.5);
        if (ambiguous) {
          track.labelUsable = false;
          track.genderEvidence = 0;
          if (track.labelSource === 'automatic') { track.label = 'unknown'; track.labelSource = 'none'; track.genderConfidence = 0; }
          track.state = 'ambiguous';
          track.identityGeneration++;
        }
        else { track.state = isStatic || track.hits >= 1 ? 'active' : 'tentative'; }
        track.velocityX = 0.7 * track.velocityX + 0.3 * (cxNew - cxOld) / dt;
        track.velocityY = 0.7 * track.velocityY + 0.3 * (cyNew - cyOld) / dt;
        track.box = detection.box;
        track.mask = detection.mask;
        track.maskWidth = detection.maskWidth;
        track.maskHeight = detection.maskHeight;
        track.score = detection.score;
        track.lastSeen = now;
        track.hits++;
        if (track.hits >= 2 && track.state === 'tentative') track.state = 'active';
        matchedTracks.add(track.id);
        matchedDetections.add(detection);
      }
    };
    matchStage(high, 0.3, true);
    matchStage(low, 0.4, false);
    for (const detection of high) {
      if (matchedDetections.has(detection)) continue;
      const id = `${this.sessionId}:${this.nextId++}`;
      this.tracks.set(id, {
        id, box: detection.box, mask: detection.mask, maskWidth: detection.maskWidth,
        maskHeight: detection.maskHeight, score: detection.score, firstSeen: now,
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
    return true;
  }

  estimateGender(id: string, label: 'male' | 'female', confidence: number, isStatic: boolean, minimumConfidence = 0.85): boolean {
    const track = this.tracks.get(id);
    if (!track || track.state === 'lost' || track.state === 'ambiguous' || track.labelSource === 'user' || confidence < minimumConfidence) return false;
    if (track.label !== label || track.labelSource !== 'automatic') {
      track.label = label;
      track.labelSource = 'automatic';
      track.genderEvidence = 1;
      track.genderConfidence = confidence;
      track.labelUsable = isStatic && track.state === 'active';
    } else {
      track.genderEvidence++;
      track.genderConfidence = Math.min(track.genderConfidence, confidence);
      track.labelUsable = track.state === 'active' && (isStatic || track.genderEvidence >= 2);
    }
    return track.labelUsable;
  }
  get(): Track[] { return [...this.tracks.values()]; }
  reset(): void { this.tracks.clear(); }
}
