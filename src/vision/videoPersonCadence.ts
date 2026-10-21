// SPDX-License-Identifier: AGPL-3.0-only
import type { FramePacket, Track } from '../state/contracts';

/** Fresh semantic masks need not rerun YOLO when local motion still anchors
 * every person. Never manufacture detector hits or new identity evidence. */
export class VideoPersonCadence {
  private detection?: { session: string; epoch: number; at: number; mediaTime: number; signature: string };

  detected(frame: FramePacket, signature: string): void {
    this.detection = frame.kind === 'video' && frame.mediaTimeSec !== undefined ? {
      session: frame.key.mediaSessionId, epoch: frame.key.epoch, at: frame.capturedAtMs,
      mediaTime: frame.mediaTimeSec, signature,
    } : undefined;
  }

  project(frame: FramePacket, signature: string, tracks: Track[]): Track[] | undefined {
    const prior = this.detection;
    if (!prior || frame.kind !== 'video' || frame.paused || frame.mediaTimeSec === undefined ||
        prior.session !== frame.key.mediaSessionId || prior.epoch !== frame.key.epoch || prior.signature !== signature ||
        frame.capturedAtMs <= prior.at || frame.capturedAtMs - prior.at >= 250 ||
        frame.mediaTimeSec < prior.mediaTime || frame.mediaTimeSec - prior.mediaTime >= .25 || !tracks.length) return;
    const boxes = new Map(frame.motionTracks?.map(track => [track.id, track.box]));
    if (tracks.some(track => track.state !== 'active' || track.maskWidth !== frame.width || track.maskHeight !== frame.height || !boxes.has(track.id))) return;
    const projected: Track[] = [];
    for (const track of tracks) {
      const box = boxes.get(track.id)!;
      if (![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
          Math.abs(box.width - track.box.width) > .0001 || Math.abs(box.height - track.box.height) > .0001 ||
          Math.abs(box.x - track.box.x) > .2 || Math.abs(box.y - track.box.y) > .2) return;
      const dx = Math.round((box.x - track.box.x) * frame.width), dy = Math.round((box.y - track.box.y) * frame.height);
      const mask = new Float32Array(track.mask.length);
      const left = Math.max(0, dx), right = Math.min(frame.width, frame.width + dx);
      for (let y = Math.max(0, dy); y < Math.min(frame.height, frame.height + dy); y++) {
        if (right <= left) break;
        const source = (y - dy) * frame.width + left - dx;
        mask.set(track.mask.subarray(source, source + right - left), y * frame.width + left);
      }
      projected.push({ ...track, box: { ...box }, mask });
    }
    return projected;
  }
}
