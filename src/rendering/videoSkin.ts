// SPDX-License-Identifier: AGPL-3.0-only
import {personExpansion} from './expansion';
import { ENGINE, type Settings } from '../config/settings';
import type { Track } from '../state/contracts';
import { personSelected } from '../rules/evaluate';
import { policyFor, videoSkinAction } from '../config/personPolicy';
import { dilate } from './compositor';

/** MediaPipe identifies skin; detector masks/boxes assign it to people. Keep
 * per-track masks so existing video motion propagation can move skin too. */
export function videoSkinMasks(tracks: Track[], categories: Uint8Array, settings: Settings, side: number): Array<{ id: string; alpha: Uint8Array }> {
  const count = side * side;
  if (categories.length !== count || tracks.some(track => track.mask.length !== count)) throw new Error('Video skin grid mismatch');
  const selected = tracks.map(track => personSelected(track, settings, 'video'));
  const hiddenCategories = tracks.map(track => {
    const policy = policyFor(settings, track);
    return [false, policy.videoHair === 'hide', videoSkinAction(policy) === 'hide', policy.videoFace === 'hide'];
  });
  const masks = tracks.map(() => new Uint8Array(count)), exempt = new Uint8Array(count);
  const bounds = tracks.map(() => ({ left: side, top: side, right: -1, bottom: -1 }));
  for (let p = 0; p < count; p++) {
    let top = .5, owner = -1;
    for (let t = 0; t < tracks.length; t++) if (tracks[t].mask[p] > top) { top = tracks[t].mask[p]; owner = t; }
    if (owner < 0) continue; // Detection is still required in advanced mode.
    let hasSelected = false, hidden = false;
    for (let t = 0; t < tracks.length; t++) if (selected[t] && tracks[t].mask[p] >= .5 && top - tracks[t].mask[p] < ENGINE.ownershipMargin) {
      hasSelected = true;
      if (hiddenCategories[t][categories[p]]) {
        masks[t][p] = 255; hidden = true;
        const x = p % side, y = Math.floor(p / side), box = bounds[t];
        box.left = Math.min(box.left, x); box.right = Math.max(box.right, x);
        box.top = Math.min(box.top, y); box.bottom = Math.max(box.bottom, y);
      }
    }
    // Expansion may enter clothing, but must respect explicitly shown face,
    // hair or skin and confidently exempt people.
    if (!hasSelected || categories[p] >= 1 && categories[p] <= 3 && !hidden) exempt[p] = 255;
  }
  return tracks.flatMap((track, index) => {
    const box = bounds[index];
    if (!selected[index] || box.right < 0) return [];
    // Exact same dilation, restricted to the skin ROI plus its full expansion
    // margin. Scanning a full frame once per person dominates crowded videos.
    const radius = personExpansion(settings.videoSkinExpansion, side, track.box);
    const left = Math.max(0, box.left - radius), top = Math.max(0, box.top - radius);
    const right = Math.min(side - 1, box.right + radius), bottom = Math.min(side - 1, box.bottom + radius);
    const width = right - left + 1, height = bottom - top + 1;
    const crop = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) crop.set(masks[index].subarray((top + y) * side + left, (top + y) * side + right + 1), y * width);
    const expanded = dilate(crop, width, height, radius), alpha = new Uint8Array(count);
    let covered = false;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = (top + y) * side + left + x;
      if (!exempt[p] && expanded[y * width + x]) { alpha[p] = 255; covered = true; }
    }
    return covered ? [{ id: track.id, alpha }] : [];
  });
}
