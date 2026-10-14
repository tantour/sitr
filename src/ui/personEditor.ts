// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { BODY_REGIONS, type FaceEffect, type PersonArea, type Settings } from '../config/settings';
import { editablePolicies, faceStrength, genderPolicy, groupedBodySkin, uniformPolicy } from '../config/personPolicy';
import { number, t } from './localization';

export const AREA_NAMES: Record<PersonArea, string> = { body: 'Body skin', hair: 'Hair', face: 'Face', neck: 'Neck', torso: 'Torso (chest and belly)',
  'upper-arms': 'Upper arms', forearms: 'Forearms', hands: 'Hands', thighs: 'Thighs', 'lower-legs': 'Lower legs', feet: 'Feet', 'other-skin': 'Unrecognized skin' };
const ACTION_NAMES = { show: 'Show', hide: 'Hide', black: 'Black', blur: 'Blur', checkerboard: 'Pixelate' };

export function initializePersonEditor(getSettings: () => Settings,
  save: (patch: Partial<Settings>, control: HTMLButtonElement | HTMLSelectElement | HTMLInputElement) => Promise<boolean>): { refresh: () => void } {
  let gender: 'female' | 'male' = 'female', area: PersonArea = 'body';
  const root = document.getElementById('personEditor')!;
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-person-gender]'));
  const regions = Array.from(root.querySelectorAll<SVGElement>('[data-person-area]'));
  const actions = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-person-action]'));
  const picker = document.getElementById('personAreaSelect') as HTMLSelectElement;
  const model = document.getElementById('imageBodyRegionMode') as HTMLSelectElement;
  const toggle = document.getElementById('bodyPixEnabled') as HTMLInputElement;
  const strength = document.getElementById('imageFaceEffectIntensity') as HTMLInputElement;
  const available = (part: PersonArea, enabled: boolean) => part === 'hair' || part === 'face' || (enabled ? part !== 'body' : part === 'body');
  const refresh = () => {
    if (!getSettings()) return;
    const policy = genderPolicy(getSettings(), gender);
    const enabled = getSettings().imageBodyRegionMode !== 'off';
    if (!available(area, enabled)) area = enabled ? 'torso' : 'body';
    toggle.checked = enabled;
    model.hidden = !enabled;
    root.dataset.bodypix = enabled ? 'on' : 'off';
    document.getElementById('bodyPixModeHelp')!.textContent = t(enabled ? getSettings().imageBodyRegionMode === 'finer' ? 'Images only · slower, finer detail' : 'Images only · slower processing' : 'Off · body skin together');
    document.getElementById('imageFaceEffectOptions')!.hidden = area !== 'face' || !['blur', 'checkerboard'].includes(policy.face);
    strength.value = String(faceStrength(getSettings(), policy));
    document.getElementById('imageFaceEffectIntensityValue')!.textContent = number(Number(strength.value));
    document.getElementById('personResetHelp')!.textContent = t(enabled ? 'Outlined: show · Filled: cover' : 'Body skin only · face and hair separate');
    const value = (part: PersonArea) => part === 'body' ? Object.values(policy.skin).some(action => action === 'hide') || policy.otherSkin === 'hide' ? 'hide' : 'show'
      : part === 'face' ? policy.face : part === 'hair' ? policy.hair : part === 'other-skin' ? policy.otherSkin : policy.skin[part];
    tabs.forEach(tab => { const active = tab.dataset.personGender === gender; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; });
    root.dataset.gender = gender;
    document.getElementById('personPolicyPanel')!.setAttribute('aria-labelledby', gender === 'female' ? 'femalePolicyTab' : 'malePolicyTab');
    document.getElementById('personAreaTitle')!.textContent = t(AREA_NAMES[area]);
    document.getElementById('personCurrentAction')!.textContent = t(ACTION_NAMES[value(area)]);
    document.getElementById('personPolicySummary')!.textContent = t('Image choices for {gender}', { gender: t(gender === 'female' ? 'Female' : 'Male') });
    regions.forEach(region => {
      const part = region.dataset.personArea as PersonArea;
      region.style.display = available(part, enabled) ? '' : 'none';
      region.dataset.action = value(part);
      region.setAttribute('aria-label', `${t(AREA_NAMES[part])}: ${t(ACTION_NAMES[value(part)])}`);
      region.setAttribute('aria-pressed', String(area === part));
      region.classList.toggle('selected', part === area);
    });
    picker.value = area;
    for (const option of Array.from(picker.options)) {
      option.hidden = option.disabled = !available(option.value as PersonArea, enabled);
      option.textContent = `${t(AREA_NAMES[option.value as PersonArea])} · ${t(ACTION_NAMES[value(option.value as PersonArea)])}`;
    }
    actions.forEach(button => {
      const action = button.dataset.personAction!;
      button.hidden = area === 'body' ? true : area === 'face' ? action === 'hide' : !['show', 'hide'].includes(action);
      button.setAttribute('aria-pressed', String(value(area) === action));
    });
    for (const appearance of ['female', 'male'] as const) (document.getElementById(`videoPolicy-${appearance}`) as HTMLSelectElement).value = genderPolicy(getSettings(), appearance).video;
    document.getElementById('personAreaHelp')!.textContent = t(area === 'body' ? 'Use Show all or Hide all above. Face and hair keep their own choices.' : area === 'face' ? 'Face effects are separate for each gender.'
      : area === 'hair' ? 'This choice covers hair only, independently of skin.'
      : area === 'other-skin' ? 'Skin the body model cannot recognize uses this choice.'
      : area === 'neck' ? 'Neck boundaries are approximate and can be imperfect.'
      : 'Only exposed skin in this area is affected. Clothes stay visible.');
    model.value = getSettings().imageBodyRegionMode;
    for (const action of ['show', 'hide']) document.getElementById(action === 'show' ? 'showAllAreas' : 'hideAllAreas')!.setAttribute('aria-pressed', String(!enabled && value('body') === action));
  };
  const selectArea = (part: PersonArea) => { area = part; refresh(); };
  const selectGender = (value: 'female' | 'male', focus = false) => { gender = value; refresh(); if (focus) tabs.find(tab => tab.dataset.personGender === gender)?.focus(); };
  tabs.forEach(tab => {
    tab.onclick = () => selectGender(tab.dataset.personGender as 'female' | 'male');
    tab.onkeydown = event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); selectGender(event.key === 'Home' ? 'female' : event.key === 'End' ? 'male' : tab.dataset.personGender === 'male' ? 'female' : 'male', true);
    } };
  });
  regions.forEach(region => {
    region.onclick = () => selectArea(region.dataset.personArea as PersonArea);
    region.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectArea(region.dataset.personArea as PersonArea); } };
  });
  picker.onchange = () => selectArea(picker.value as PersonArea);
  strength.oninput = () => { document.getElementById('imageFaceEffectIntensityValue')!.textContent = number(Number(strength.value)); };
  strength.onchange = async () => {
    const policies = editablePolicies(getSettings()); policies[gender].faceStrength = Number(strength.value);
    await save({ personPolicies: policies }, strength); refresh();
  };
  toggle.onchange = async () => {
    const enabled = toggle.checked, policies = editablePolicies(getSettings());
    if (!enabled) for (const appearance of ['female', 'male'] as const) {
      const policy = policies[appearance];
      policies[appearance] = groupedBodySkin(policy, Object.values(policy.skin).includes('hide') || policy.otherSkin === 'hide' ? 'hide' : 'show');
    }
    toggle.disabled = true;
    try { await save({ imageBodyRegionMode: enabled ? 'faster' : 'off', personPolicies: policies }, model); }
    finally { toggle.disabled = false; refresh(); }
  };
  actions.forEach(button => { button.onclick = async () => {
    const current = getSettings(), policies = editablePolicies(current), policy = policies[gender];
    const action = button.dataset.personAction!;
    if (area === 'face') policy.face = action as FaceEffect;
    else if (area === 'body') policies[gender] = groupedBodySkin(policy, action as 'show' | 'hide');
    else if (area === 'hair') policy.hair = action as 'show' | 'hide';
    else if (area === 'other-skin') policy.otherSkin = action as 'show' | 'hide';
    else policy.skin[area] = action as 'show' | 'hide';
    const usesAnatomy = BODY_REGIONS.includes(area as typeof BODY_REGIONS[number]);
    await save({ personPolicies: policies, ...(area !== 'face' && area !== 'hair' ? { imageCoverage: 'regions' as const } : {}), ...(usesAnatomy && current.imageBodyRegionMode === 'off' ? { imageBodyRegionMode: 'faster' } : {}) }, button);
    refresh();
  }; });
  for (const action of ['show', 'hide'] as const) {
    const button = document.getElementById(action === 'show' ? 'showAllAreas' : 'hideAllAreas') as HTMLButtonElement;
    button.onclick = async () => {
      const policies = editablePolicies(getSettings()), video = policies[gender].video;
      policies[gender] = getSettings().imageBodyRegionMode === 'off' ? groupedBodySkin(policies[gender], action) : { ...uniformPolicy(action), video };
      await save({ personPolicies: policies }, button); refresh();
    };
  }
  for (const appearance of ['female', 'male'] as const) {
    const control = document.getElementById(`videoPolicy-${appearance}`) as HTMLSelectElement;
    control.onchange = async () => { const policies = editablePolicies(getSettings()); policies[appearance].video = control.value as FaceEffect;
      await save({ personPolicies: policies }, control); refresh(); };
  }
  return { refresh };
}
