// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import type { Settings } from '../config/settings';
import type { TrackObservation } from '../state/contracts';

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
  if (settings.filter === 'off') return false;
  const label = observation.labelUsable ? observation.label : 'unknown';
  const unknownPolicy = kind === 'image' ? settings.imageUnknown : settings.videoUnknown;
  return label === 'unknown' ? unknownPolicy !== 'allow' : settings.filter === 'both' || settings.filter === label;
}

export function selectedMask(observation: TrackObservation, settings: Settings): Uint8Array {
  const n = observation.ownedMask.length;
  const out = new Uint8Array(n);
  if (!personSelected(observation, settings, 'image')) return out;
  for (let i = 0; i < n; i++) {
    out[i] = (settings.bodySkin && observation.bodySkinMask[i]) || (settings.hair && observation.hairMask[i]) ? 255 : 0;
  }
  return out;
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
