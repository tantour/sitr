import {areaIds,conditionPasses,ruleConditions} from '../rules/conditions';
// SPDX-License-Identifier: AGPL-3.0-only
import {personExpansion} from './expansion';
import { BODY_REGIONS, type Settings } from '../config/settings';
import { policyFor } from '../config/personPolicy';
import type { Rect, TrackObservation } from '../state/contracts';
import { personSelected } from '../rules/evaluate';
import { dilate } from './compositor';
import { openThresholdFace } from './skinThreshold';

/** Count skin / all visible anatomy, including clothes, only where instance
 * ownership is confident. Never borrow another person's skin or body area. */
function thresholdPeople(observations: TrackObservation[], settings: Settings, regions?: Uint8Array): Array<{
  person: TrackObservation; mask: Uint8Array; showFace: boolean; blackFace:boolean; effect:'black'|'smart';
}> | undefined {
  if (!regions || settings.imageBodyRegionMode === 'off' || settings.imageCoverage !== 'regions') return;
  if (!settings.personPolicies || !Object.values(settings.personPolicies).some(policy => policy.partThresholds?.length)) return;
  const result: Array<{ person: TrackObservation; mask: Uint8Array; showFace: boolean; blackFace:boolean; effect:'black'|'smart' }> = [];
  for (const person of observations) {
    if (!personSelected(person, settings, 'image') || person.state !== 'active' || !person.exposure.reliable) continue;
    const rules = policyFor(settings, person).partThresholds;
    if (!rules?.length) continue;
    const total = new Uint32Array(BODY_REGIONS.length + 1), skin = total.slice();
    for (let p = 0; p < regions.length; p++) if (person.ownedMask[p] && regions[p]) {
      total[regions[p]]++;
      if (person.bodySkinMask[p]) skin[regions[p]]++;
    }
    for(const rule of rules){
      if(rule.enabled===false)continue;
      const clauses=ruleConditions(rule);if(!clauses.length)continue;
      const passed=rule.match==='any'?clauses.some(clause=>conditionPasses(clause,total,skin)):clauses.every(clause=>conditionPasses(clause,total,skin));
      if(!passed)continue;
      const ids=areaIds(rule.coverAreas?.length?rule.coverAreas:clauses.flatMap(clause=>clause.areas));
      const mask=new Uint8Array(regions.length),body=rule.target==='body';
      for(let p=0;p<mask.length;p++)if(person.ownedMask[p]&&(body||ids.has(regions[p]))&&(rule.target!=='skin'||person.bodySkinMask[p]))mask[p]=255;
      result.push({person,mask,showFace:body&&rule.face==='show',blackFace:body&&rule.face!=='show',effect:rule.effect==='smart'?'smart':'black'});
    }
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
  side: number, facesFor: (id: string) => Rect[] = () => []): { mask: Uint8Array; blackMask:Uint8Array; smartMask:Uint8Array; showFaceIds: Set<string> } | undefined {
  const people = thresholdPeople(observations, settings, regions);
  if (!people || !regions) return;
  const mask = new Uint8Array(regions.length), blackMask=mask.slice(),smartMask=mask.slice(), showFaceIds = new Set<string>();
  for (const entry of people) {
    const expanded = dilate(entry.mask, side, side, personExpansion(settings.imageExpansion, side, entry.person.box));
    if (entry.showFace) {
      openThresholdFace(expanded, entry.person, side, facesFor(entry.person.id));
      showFaceIds.add(entry.person.id);
    }
    if(entry.blackFace&&entry.effect==='smart'){
      const withoutFace=expanded.slice();openThresholdFace(withoutFace,entry.person,side,facesFor(entry.person.id));
      for(let p=0;p<expanded.length;p++)if(expanded[p]&&!withoutFace[p])blackMask[p]=255;
    }
    const target=entry.effect==='smart'?smartMask:blackMask;
    for (let p = 0; p < mask.length; p++) {mask[p] = Math.max(mask[p], expanded[p]);target[p]=Math.max(target[p],expanded[p]);}
  }
  return { mask, blackMask, smartMask, showFaceIds };
}
