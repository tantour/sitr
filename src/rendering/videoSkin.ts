// SPDX-License-Identifier: AGPL-3.0-only
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
  for (let p = 0; p < count; p++) {
    let top = .5, owner = -1;
    for (let t = 0; t < tracks.length; t++) if (tracks[t].mask[p] > top) { top = tracks[t].mask[p]; owner = t; }
    if (owner < 0) continue; // Detection is still required in advanced mode.
    let hasSelected = false, hidden = false;
    for (let t = 0; t < tracks.length; t++) if (selected[t] && tracks[t].mask[p] >= .5 && top - tracks[t].mask[p] < ENGINE.ownershipMargin) {
      hasSelected = true;
      if (hiddenCategories[t][categories[p]]) { masks[t][p] = 255; hidden = true; }
    }
    // Expansion may enter clothing, but must respect explicitly shown face,
    // hair or skin and confidently exempt people.
    if (!hasSelected || categories[p] >= 1 && categories[p] <= 3 && !hidden) exempt[p] = 255;
  }
  return tracks.flatMap((track, index) => {
    if (!selected[index]) return [];
    const alpha = dilate(masks[index], side, side, settings.videoSkinExpansion);
    for (let p = 0; p < count; p++) if (exempt[p]) alpha[p] = 0;
    return [{ id: track.id, alpha }];
  });
}
