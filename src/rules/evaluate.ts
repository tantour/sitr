import type { Settings } from '../config/settings';
import type { TrackObservation } from '../state/contracts';

export function personSelected(observation: Pick<TrackObservation, 'label' | 'labelUsable'>, settings: Settings): boolean {
  if (settings.filter === 'off') return false;
  const label = observation.labelUsable ? observation.label : 'unknown';
  return label === 'unknown' ? settings.unknown !== 'allow' : settings.filter === 'both' || settings.filter === label;
}

export function selectedMask(observation: TrackObservation, settings: Settings): Uint8Array {
  const n = observation.ownedMask.length;
  const out = new Uint8Array(n);
  if (!personSelected(observation, settings)) return out;
  const label = observation.labelUsable ? observation.label : 'unknown';
  for (let i = 0; i < n; i++) {
    out[i] = (settings.bodySkin && observation.bodySkinMask[i]) || (settings.hair && observation.hairMask[i]) || (settings.faceSkin && observation.faceSkinMask[i]) ? 255 : 0;
  }
  return out;
}
