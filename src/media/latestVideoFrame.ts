// SPDX-License-Identifier: AGPL-3.0-only
import type { FramePacket } from '../state/contracts';

/** One replaceable decoded frame, never a FIFO backlog of obsolete work. */
export class LatestVideoFrame {
  private pending?: FramePacket;
  offer(frame: FramePacket): void {
    if (frame.kind !== 'video' || frame.paused) return;
    this.pending = frame;
  }
  take(sessionId: string, epoch: number, now: number): FramePacket | undefined {
    const frame = this.pending; this.pending = undefined;
    if (!frame || frame.key.mediaSessionId !== sessionId || frame.key.epoch !== epoch ||
      now < frame.capturedAtMs || now - frame.capturedAtMs > 100) return;
    return frame;
  }
  clear(): void { this.pending = undefined; }
}
