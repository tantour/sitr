// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import type { Rect, TrackObservation } from '../state/contracts';
import { openAssociatedFaces, videoPersonMask } from './videoMask';

/** Clear both semantic face skin and the matched face box after expansion. */
export function openThresholdFace(mask: Uint8Array, observation: TrackObservation, side: number, faces: Rect[]): void {
  for (let p = 0; p < mask.length; p++) if (observation.faceSkinMask[p]) mask[p] = 0;
  openAssociatedFaces(mask, side, faces);
}

export function skinThresholdMask(person: Float32Array, observation: TrackObservation, side: number,
  expansion: number, includeFace: boolean, faces: Rect[]): Uint8Array {
  const mask = videoPersonMask(person, side, expansion);
  if (!includeFace) openThresholdFace(mask, observation, side, faces);
  return mask;
}
