// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { BODY_REGIONS, type BodyRegion, type FaceEffect, type Label, type PersonPolicies, type PersonPolicy, type Settings } from './settings';

export function uniformPolicy(action: 'show' | 'hide'): PersonPolicy {
  return { skin: Object.fromEntries(BODY_REGIONS.map(area => [area, action])) as PersonPolicy['skin'],
    hair: action, otherSkin: action, face: action === 'show' ? 'show' : 'black', video: action === 'show' ? 'show' : 'black' };
}
export function genderPolicy(settings: Settings, gender: 'female' | 'male'): PersonPolicy {
  if (settings.personPolicies) return settings.personPolicies[gender];
  const selected = settings.filter === 'both' || settings.filter === gender;
  if (!selected) return uniformPolicy('show');
  const allowed = gender === 'female' ? settings.imageFemaleAllowedRegions : settings.imageMaleAllowedRegions;
  const allAllowed = settings.imageBodyRegionMode !== 'off' && BODY_REGIONS.filter(area => area !== 'neck').every(area => allowed.includes(area));
  return { skin: Object.fromEntries(BODY_REGIONS.map(area => [area, !settings.bodySkin || allAllowed ||
      settings.imageBodyRegionMode !== 'off' && (allowed.includes(area) || area === 'neck' && allowed.includes('torso')) ? 'show' : 'hide'])) as PersonPolicy['skin'],
    otherSkin: !settings.bodySkin || allAllowed ? 'show' : 'hide', hair: settings.hair && !allAllowed ? 'hide' : 'show',
    face: settings.imageCoverage === 'regions' ? settings.imageRegionFaceEffect : settings.imageWholeBodyFaceEffect, video: settings.videoEffect };
}
export function editablePolicies(settings: Settings): PersonPolicies {
  return structuredClone({ female: genderPolicy(settings, 'female'), male: genderPolicy(settings, 'male') });
}
export function groupedBodySkin(policy: PersonPolicy, action: 'show' | 'hide'): PersonPolicy {
  return { ...policy, skin: uniformPolicy(action).skin, otherSkin: action };
}
export function faceStrength(settings: Settings, policy: PersonPolicy): number {
  return policy.faceStrength ?? settings.imageFaceEffectIntensity;
}
export function policyFor(settings: Settings, person: { label: Label; labelUsable: boolean }): PersonPolicy {
  if (person.labelUsable && person.label !== 'unknown') return genderPolicy(settings, person.label);
  const female = genderPolicy(settings, 'female'), male = genderPolicy(settings, 'male');
  const strictEffect = (a: FaceEffect, b: FaceEffect): FaceEffect => a === 'black' || b === 'black' ? 'black'
    : a === 'blur' || b === 'blur' ? 'blur' : a === 'checkerboard' || b === 'checkerboard' ? 'checkerboard' : 'show';
  return { skin: Object.fromEntries(BODY_REGIONS.map(area => [area, female.skin[area] === 'hide' || male.skin[area] === 'hide' ? 'hide' : 'show'])) as PersonPolicy['skin'],
    otherSkin: female.otherSkin === 'hide' || male.otherSkin === 'hide' ? 'hide' : 'show',
    hair: female.hair === 'hide' || male.hair === 'hide' ? 'hide' : 'show', face: strictEffect(female.face, male.face), video: strictEffect(female.video, male.video),
    faceStrength: Math.max(...[female, male].filter(policy => policy.face === strictEffect(female.face, male.face)).map(policy => faceStrength(settings, policy))) };
}
export function hasImageCoverage(policy: PersonPolicy): boolean {
  return policy.hair === 'hide' || policy.face !== 'show' || policy.otherSkin === 'hide' || BODY_REGIONS.some(area => policy.skin[area] === 'hide');
}
export function hasBodyCoverage(settings: Settings): boolean {
  if (!settings.personPolicies) return settings.bodySkin;
  return ['female', 'male'].some(gender => { const policy = genderPolicy(settings, gender as 'female' | 'male');
    return policy.otherSkin === 'hide' || BODY_REGIONS.some(area => policy.skin[area] === 'hide'); });
}
export function hasFaceEffects(settings: Settings): boolean {
  return genderPolicy(settings, 'female').face !== 'show' || genderPolicy(settings, 'male').face !== 'show';
}
export function skinHidden(policy: PersonPolicy, region: number | undefined, hasMap: boolean): boolean {
  // A missing model must not turn a requested hide into an accidental exemption.
  if (!hasMap) return policy.otherSkin === 'hide' || BODY_REGIONS.some(area => policy.skin[area] === 'hide');
  const area: BodyRegion | undefined = BODY_REGIONS[(region ?? 0) - 1];
  return area ? policy.skin[area] === 'hide' : policy.otherSkin === 'hide';
}
