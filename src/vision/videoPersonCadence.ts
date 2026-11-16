// SPDX-License-Identifier: AGPL-3.0-only
import type { FramePacket, Track } from '../state/contracts';

/** Fresh semantic masks need not rerun YOLO when local motion still anchors
 * every person. Never manufacture detector hits or new identity evidence. */
export class VideoPersonCadence {
  reason = 'uninitialized';
  private detection?: { session: string; epoch: number; at: number; mediaTime: number; signature: string };

  detected(frame: FramePacket, signature: string): void {
    this.detection = frame.kind === 'video' && frame.mediaTimeSec !== undefined ? {
      session: frame.key.mediaSessionId, epoch: frame.key.epoch, at: frame.capturedAtMs,
      mediaTime: frame.mediaTimeSec, signature,
    } : undefined;
  }

  project(frame: FramePacket, signature: string, tracks: Track[]): Track[] | undefined {
    this.reason = 'anchor-expired';
    const prior = this.detection;
    if (!prior || frame.kind !== 'video' || frame.paused || frame.mediaTimeSec === undefined ||
        prior.session !== frame.key.mediaSessionId || prior.epoch !== frame.key.epoch || prior.signature !== signature ||
        frame.capturedAtMs <= prior.at || frame.capturedAtMs - prior.at >= 250 ||
        frame.mediaTimeSec < prior.mediaTime || frame.mediaTimeSec - prior.mediaTime >= .25 || !tracks.length) return;
    const boxes = new Map(frame.motionTracks?.map(track => [track.id, track.box]));
    this.reason = 'untrusted-tracks';
    if (tracks.some(track => track.state !== 'active' || track.maskWidth !== frame.width || track.maskHeight !== frame.height || !boxes.has(track.id))) return;
    const projected: Track[] = [];
    this.reason = 'geometry';
    for (const track of tracks) {
      const motion = boxes.get(track.id)!;
      // A buffered frame may reference the preceding detector box. Small box
      // jitter does not invalidate its measured center; never rescale a stale mask.
      if (![motion.x, motion.y, motion.width, motion.height].every(Number.isFinite) ||
          Math.abs(motion.width - track.box.width) > Math.max(2 / frame.width, track.box.width * .15) ||
          Math.abs(motion.height - track.box.height) > Math.max(2 / frame.height, track.box.height * .15)) return;
      const shiftX = motion.x + motion.width / 2 - track.box.x - track.box.width / 2;
      const shiftY = motion.y + motion.height / 2 - track.box.y - track.box.height / 2;
      if (Math.abs(shiftX) > .2 || Math.abs(shiftY) > .2) return;
      const box = { ...track.box, x: track.box.x + shiftX, y: track.box.y + shiftY };
      const dx = Math.round(shiftX * frame.width), dy = Math.round(shiftY * frame.height);
      const mask = new Float32Array(track.mask.length);
      const left = Math.max(0, dx), right = Math.min(frame.width, frame.width + dx);
      for (let y = Math.max(0, dy); y < Math.min(frame.height, frame.height + dy); y++) {
        if (right <= left) break;
        const source = (y - dy) * frame.width + left - dx;
        mask.set(track.mask.subarray(source, source + right - left), y * frame.width + left);
      }
      projected.push({ ...track, box: { ...box }, mask });
    }
    this.reason = 'motion';
    return projected;
  }
}
