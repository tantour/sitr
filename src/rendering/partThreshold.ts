// SPDX-License-Identifier: AGPL-3.0-only
import { BODY_REGIONS, type Settings } from '../config/settings';
import { policyFor } from '../config/personPolicy';
import type { Rect, TrackObservation } from '../state/contracts';
import { personSelected } from '../rules/evaluate';
import { dilate } from './compositor';
import { openThresholdFace } from './skinThreshold';

/** Count skin / all visible anatomy, including clothes, only where instance
 * ownership is confident. Never borrow another person's skin or body area. */
function thresholdPeople(observations: TrackObservation[], settings: Settings, regions?: Uint8Array): Array<{
  person: TrackObservation; mask: Uint8Array; showFace: boolean;
}> | undefined {
  if (!regions || settings.imageBodyRegionMode === 'off' || settings.imageCoverage !== 'regions') return;
  if (!settings.personPolicies || !Object.values(settings.personPolicies).some(policy => policy.partThresholds?.length)) return;
  const result: Array<{ person: TrackObservation; mask: Uint8Array; showFace: boolean }> = [];
  for (const person of observations) {
    if (!personSelected(person, settings, 'image') || person.state !== 'active' || !person.exposure.reliable) continue;
    const rules = policyFor(settings, person).partThresholds;
    if (!rules?.length) continue;
    const total = new Uint32Array(BODY_REGIONS.length + 1), skin = total.slice();
    for (let p = 0; p < regions.length; p++) if (person.ownedMask[p] && regions[p]) {
      total[regions[p]]++;
      if (person.bodySkinMask[p]) skin[regions[p]]++;
    }
    const triggered = rules.filter(rule => {
      const id = BODY_REGIONS.indexOf(rule.area) + 1;
      return total[id] >= 4 && skin[id] / total[id] > rule.percent / 100;
    });
    const body = triggered.some(rule => rule.target === 'body');
    if (!triggered.length) continue;
    const showFace = body && !triggered.some(rule => rule.target === 'body' && rule.face !== 'show');
    const parts = new Set(triggered.map(rule => BODY_REGIONS.indexOf(rule.area) + 1));
    const mask = new Uint8Array(regions.length);
    for (let p = 0; p < regions.length; p++) if (person.ownedMask[p] && (body || parts.has(regions[p]))) mask[p] = 255;
    result.push({ person, mask, showFace });
  }
  return result;
}

export function partThresholdMask(observations: TrackObservation[], settings: Settings, regions?: Uint8Array): Uint8Array | undefined {
  const people = thresholdPeople(observations, settings, regions);
  if (!people || !regions) return;
  const mask = new Uint8Array(regions.length);
  for (const entry of people) for (let p = 0; p < mask.length; p++)
    if (entry.mask[p] && !(entry.showFace && entry.person.faceSkinMask[p])) mask[p] = 255;
  return mask;
}

/** Open each person's face after expansion, then union the masks so another
 * person's real coverage can never be erased by a face opening. */
export function partThresholdCoverage(observations: TrackObservation[], settings: Settings, regions: Uint8Array | undefined,
  side: number, facesFor: (id: string) => Rect[] = () => []): { mask: Uint8Array; showFaceIds: Set<string> } | undefined {
  const people = thresholdPeople(observations, settings, regions);
  if (!people || !regions) return;
  const mask = new Uint8Array(regions.length), showFaceIds = new Set<string>();
  for (const entry of people) {
    const expanded = dilate(entry.mask, side, side, settings.imageExpansion);
    if (entry.showFace) {
      openThresholdFace(expanded, entry.person, side, facesFor(entry.person.id));
      showFaceIds.add(entry.person.id);
    }
    for (let p = 0; p < mask.length; p++) mask[p] = Math.max(mask[p], expanded[p]);
  }
  return { mask, showFaceIds };
}
