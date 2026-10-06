// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import type { Track } from '../state/contracts';

export const VIDEO_GENDER_INTERVAL_MS = 1000;

/** New identities are checked immediately; existing identities get their own one-second cadence. */
export function genderCheckDue(track: Track, now: number): boolean {
  return track.labelSource !== 'user' && track.state !== 'lost' && track.state !== 'ambiguous' &&
    (track.lastGenderCheckAt === undefined || now - track.lastGenderCheckAt >= VIDEO_GENDER_INTERVAL_MS);
}

export function canUseBodyGender(track: Track, kind: 'image' | 'video', fallback: boolean,
  faceVisible: boolean, faceClassified: boolean): boolean {
  if (track.state === 'lost' || track.state === 'ambiguous' || track.labelSource === 'user') return false;
  if (!fallback) return true; // Explicit body-only model selection remains supported.
  if (faceClassified) return false;
  if (kind === 'image') return !track.labelUsable;
  // A missing or uncertain face must never replace a face-derived video label.
  if (track.genderModelSource === 'face') return false;
  // Continue refreshing a body-derived identity even if its face is hidden.
  if (track.genderModelSource?.startsWith('body-')) return true;
  // A brand-new face-first identity without a visible face stays unclassified.
  return faceVisible && !track.labelUsable;
}
