// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import type { Settings } from '../config/settings';
import type { Track, TrackObservation } from '../state/contracts';
import { hasImageCoverage, policyFor, skinHidden } from '../config/personPolicy';
import { personSelected, selectedMask } from '../rules/evaluate';
import { dilate, pruneIslands, type Composition } from './compositor';

/** Expand hidden regions, then clip expansion against explicitly shown regions.
 * Original coverage from another person always wins at a real overlap. */
export function regionCoverage(composition: Composition, tracks: Track[], settings: Settings,
  side: number, regions?: Uint8Array): Uint8Array {
  const core = composition.unassignedMask.slice(), visible = new Uint8Array(side * side);
  const exempt = new Uint8Array(side * side);
  composition.observations.forEach((person: TrackObservation, index) => {
    const policy = policyFor(settings, person);
    const selected = personSelected(person, settings, 'image');
    const covered = hasImageCoverage(policy);
    if (selected) {
      const hidden = selectedMask(person, settings, regions);
      for (let p = 0; p < core.length; p++) if (hidden[p] || composition.ambiguousByTrack[index][p] || composition.uncertainByTrack[index][p]) core[p] = 255;
    }
    if (!covered || !selected) {
      for (let p = 0; p < exempt.length; p++) if (tracks[index].mask[p] >= 0.05) exempt[p] = 255;
    }
    for (let p = 0; p < visible.length; p++) if (person.ownedMask[p] && (
      !selected || !covered || person.bodySkinMask[p] && !skinHidden(policy, regions?.[p], !!regions)
      || person.hairMask[p] && policy.hair === 'show' || person.faceSkinMask[p])) visible[p] = 255;
  });
  const expanded = dilate(pruneIslands(core, side, side), side, side, settings.imageExpansion);
  const exemptEdge = dilate(exempt, side, side, settings.imageExpansion + 2);
  for (let p = 0; p < expanded.length; p++) if (!core[p] && (visible[p] || exemptEdge[p])) expanded[p] = 0;
  return expanded;
}
