// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { VideoPersonCadence } from '../src/vision/videoPersonCadence';
import { ByteTracker } from '../src/vision/tracker';
import type { FramePacket } from '../src/state/contracts';

const frame = (at: number): FramePacket => ({ key: { mediaSessionId: 'video', epoch: 1, sequence: at },
  kind: 'video', mediaTimeSec: at / 1000, capturedAtMs: at, width: 10, height: 10, rgba: new Uint8Array(400) });
function fixture() {
  const tracker = new ByteTracker('video'), mask = new Float32Array(100);
  mask[22] = 1;
  const track = tracker.update([{ box: { x: .2, y: .2, width: .2, height: .5 }, score: .9,
    mask, maskWidth: 10, maskHeight: 10 }], 1000, true)[0];
  tracker.label(track.id, 'female');
  const cadence = new VideoPersonCadence(); cadence.detected(frame(1000), '10:segment:.1');
  const next = { ...frame(1100), motionTracks: [{ id: track.id, box: { ...track.box, x: .3, y: .1 } }] };
  return { cadence, track, next, tracker };
}

it('moves ownership using reliable motion without adding hits, votes or detector freshness', () => {
  const { cadence, track, next, tracker } = fixture();
  const projected = cadence.project(next, '10:segment:.1', tracker.get())!;
  expect(projected).toHaveLength(1);
  expect(projected[0].mask[13]).toBe(1);
  expect(projected[0].mask[22]).toBe(0);
  expect(projected[0]).toMatchObject({ label: 'female', labelUsable: true, hits: track.hits, lastSeen: 1000 });
  expect(track.box.x).toBe(.2); expect(track.mask[22]).toBe(1);
  // Project again from the detector anchor: rounding must not accumulate drift.
  const later = cadence.project({ ...next, capturedAtMs: 1200 }, '10:segment:.1', tracker.get())!;
  expect(later[0].mask).toEqual(projected[0].mask);
});

it('forces detection when its bounded interval expires, or motion is missing or uncertain', () => {
  const { cadence, track, next } = fixture();
  for (const changed of [ { capturedAtMs: 1250 }, { mediaTimeSec: 1.25 }, { mediaTimeSec: .8 },
    { motionTracks: [] }, { paused: true }, { width: 20 }, { kind: 'image' as const },
    { key: { ...next.key, epoch: 2 } }, { key: { ...next.key, mediaSessionId: 'replacement' } } ])
    expect(cadence.project({ ...next, ...changed }, '10:segment:.1', [track])).toBeUndefined();
  expect(cadence.project(next, '10:fast-box:.1', [track])).toBeUndefined();
  expect(cadence.project(next, '10:segment:.1', [])).toBeUndefined();
  for (const state of ['tentative', 'ambiguous', 'lost'] as const)
    expect(cadence.project(next, '10:segment:.1', [{ ...track, state }])).toBeUndefined();
});

it('requires every person to have reliable finite motion, including when another person appears', () => {
  const { cadence, track, next } = fixture();
  expect(cadence.project(next, '10:segment:.1', [track, { ...track, id: 'new' }])).toBeUndefined();
  for (const box of [{ ...track.box, x: NaN }, { ...track.box, x: .8 }, { ...track.box, width: .5 }])
    expect(cadence.project({ ...next, motionTracks: [{ id: track.id, box }] }, '10:segment:.1', [track])).toBeUndefined();
});

it('clips translated masks at the border without wrapping rows', () => {
  const { cadence, track, next } = fixture();
  track.mask.fill(0); track.mask[20] = 1; track.mask[22] = 1;
  const projected = cadence.project({ ...next, motionTracks: [{ id: track.id, box: { ...track.box, x: .1 } }] }, '10:segment:.1', [track])!;
  expect(projected[0].mask[21]).toBe(1);
  expect(projected[0].mask[19]).toBe(0);
  expect(projected[0].mask.reduce((a, b) => a + b, 0)).toBe(1);
});
it('accepts tiny detector box jitter in buffered motion without rescaling mask ownership',()=>{
 const {cadence,track,next}=fixture();
 const projected=cadence.project({...next,motionTracks:[{id:track.id,box:{...next.motionTracks![0].box,width:track.box.width+.005}}]},'10:segment:.1',[track])!;
 expect(projected).toHaveLength(1);expect(projected[0].box.width).toBe(track.box.width);expect(projected[0].labelUsable).toBe(true);
});
