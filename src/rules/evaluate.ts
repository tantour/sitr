// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import type { PersonPolicy, Settings } from '../config/settings';
import type { TrackObservation } from '../state/contracts';
import { allowedRegionIds } from '../vision/bodyRegionMap';
import { hasImageCoverage, policyFor, skinHidden } from '../config/personPolicy';

export function imageDetectionGatePass(settings: Settings, hasFace: boolean, hasPerson: boolean): boolean {
  switch (settings.imageDetectionGate) {
    case 'face': return hasFace;
    case 'person': return hasPerson;
    case 'either': return hasFace || hasPerson;
    case 'both': return hasFace && hasPerson;
    default: return true;
  }
}

export function personSelected(observation: Pick<TrackObservation, 'label' | 'labelUsable'>,
  settings: Settings, kind: 'image' | 'video'): boolean {
  const label = observation.labelUsable ? observation.label : 'unknown';
  const unknownPolicy = kind === 'image' ? settings.imageUnknown : settings.videoUnknown;
  if (settings.personPolicies) {
    if (label === 'unknown' && unknownPolicy === 'allow') return false;
    const policy = policyFor(settings, observation);
    return kind === 'video' ? policy.video !== 'show' : hasImageCoverage(policy);
  }
  if (settings.filter === 'off') return false;
  return label === 'unknown' ? unknownPolicy !== 'allow' : settings.filter === 'both' || settings.filter === label;
}

export function selectedMask(observation: TrackObservation, settings: Settings, bodyRegions?: Uint8Array): Uint8Array {
  const n = observation.ownedMask.length;
  const out = new Uint8Array(n);
  if (!personSelected(observation, settings, 'image')) return out;
  if (bodyRegions && bodyRegions.length !== n) throw new Error('Body region policy grid mismatch');
  const allowed = bodyRegions ? allowedRegionIds(observation, settings) : undefined;
  if (settings.personPolicies) {
    const policy = policyFor(settings, observation);
    for (let i = 0; i < n; i++) out[i] = observation.bodySkinMask[i] && skinHidden(policy, bodyRegions?.[i], !!bodyRegions)
      || observation.hairMask[i] && policy.hair === 'hide' ? 255 : 0;
    return out;
  }
  for (let i = 0; i < n; i++) {
    out[i] = (settings.bodySkin && observation.bodySkinMask[i] && !allowed?.[bodyRegions![i]]) || (settings.hair && observation.hairMask[i]) ? 255 : 0;
  }
  return out;
}

export function categoryHidden(settings: Settings, person: Pick<TrackObservation, 'label' | 'labelUsable'>,
  category: number, region: number | undefined, hasMap: boolean, cachedPolicy?: PersonPolicy): boolean {
  if (!settings.personPolicies) return category === 1 && settings.hair || category === 2 && settings.bodySkin || category === 3 && settings.faceSkin;
  if ((!person.labelUsable || person.label === 'unknown') && settings.imageUnknown === 'allow') return false;
  const policy = cachedPolicy ?? policyFor(settings, person);
  return category === 1 ? policy.hair === 'hide' : category === 2 ? skinHidden(policy, region, hasMap) : false;
}

/** Only trustworthy, selected people can escalate skin coverage to a body or
 * image blackout. The skin ratio uses body-skin pixels, excluding face skin. */
export function imageSkinThresholds(observations: TrackObservation[], settings: Settings): {
  bodyIds: Set<string>; blackImage: boolean; groupCount: number;
} {
  const bodyIds = new Set<string>();
  let groupCount = 0;
  for (const observation of observations) {
    const ratio = observation.exposure.ratio;
    if (!personSelected(observation, settings, 'image') || observation.state !== 'active' || !observation.exposure.reliable ||
        !Number.isFinite(ratio) || ratio < 0 || ratio > 1) continue;
    if (settings.imageSkinThresholdEnabled && ratio > settings.imageSkinThresholdPercent / 100) bodyIds.add(observation.id);
    if (settings.imageGroupSkinThresholdEnabled && ratio >= settings.imageGroupSkinThresholdPercent / 100) groupCount++;
  }
  return { bodyIds, groupCount, blackImage: settings.imageGroupSkinThresholdEnabled && groupCount > settings.imageGroupSkinPeopleLimit };
}
