// SPDX-License-Identifier: AGPL-3.0-only
import type { FaceEffect, Settings } from '../config/settings';
import { editablePolicies, genderPolicy, videoSkinAction } from '../config/personPolicy';
import { t } from './localization';

type Area = 'body' | 'face' | 'hair' | 'whole';
const NAMES: Record<Area, string> = { body: 'Body skin', face: 'Face', hair: 'Hair', whole: 'Whole body' };
const ACTIONS = { show: 'Show', hide: 'Hide', black: 'Black', blur: 'Blur', checkerboard: 'Pixelate' };
const FIELDS = { body: 'videoSkin', face: 'videoFace', hair: 'videoHair' } as const;

export function initializeVideoEditor(getSettings: () => Settings,
  save: (patch: Partial<Settings>, control: HTMLButtonElement | HTMLSelectElement) => Promise<boolean>): { refresh: () => void } {
  let gender: 'female' | 'male' = 'female', area: Area = 'whole';
  const root = document.getElementById('videoEditor')!;
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-video-gender]'));
  const regions = Array.from(root.querySelectorAll<SVGElement>('[data-video-area]'));
  const actions = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-video-action]'));
  const picker = document.getElementById('videoAreaSelect') as HTMLSelectElement;
  const advanced = () => getSettings().advancedVideoMode;
  const value = (part: Area): keyof typeof ACTIONS => {
    const policy = genderPolicy(getSettings(), gender);
    return part === 'whole' ? policy.video : part === 'body' ? videoSkinAction(policy) : policy[FIELDS[part]] ?? 'show';
  };
  const refresh = () => {
    if (!getSettings()) return;
    if (advanced() && area === 'whole') area = 'body';
    if (!advanced()) area = 'whole';
    root.dataset.gender = gender;
    root.dataset.mode = advanced() ? 'advanced' : 'standard';
    for (const tab of tabs) {
      const selected = tab.dataset.videoGender === gender;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    }
    document.getElementById('videoPolicyPanel')!.setAttribute('aria-labelledby', gender === 'female' ? 'videoFemaleTab' : 'videoMaleTab');
    document.getElementById('videoPolicySummary')!.textContent = t('Video choices for {gender}', { gender: t(gender === 'female' ? 'Female' : 'Male') });
    document.getElementById('videoAreaReset')!.hidden = !advanced();
    document.getElementById('videoAreaLabel')!.hidden = picker.hidden = !advanced();
    if (advanced()) picker.value = area;
    for (const option of Array.from(picker.options)) option.textContent = `${t(NAMES[option.value as Area])} · ${t(ACTIONS[value(option.value as Area)])}`;
    for (const region of regions) {
      const part = region.dataset.videoArea as Area;
      region.style.display = (part === 'whole') === advanced() ? 'none' : '';
      region.dataset.action = value(part);
      region.classList.toggle('selected', part === area);
      region.setAttribute('aria-pressed', String(part === area));
      region.setAttribute('aria-label', `${t(NAMES[part])}: ${t(ACTIONS[value(part)])}`);
    }
    document.getElementById('videoAreaTitle')!.textContent = t(NAMES[area]);
    document.getElementById('videoCurrentAction')!.textContent = t(ACTIONS[value(area)]);
    for (const action of actions) {
      const name = action.dataset.videoAction as keyof typeof ACTIONS;
      action.hidden = advanced() ? !['show', 'hide'].includes(name) : name === 'hide';
      action.setAttribute('aria-pressed', String(value(area) === name));
    }
    document.getElementById('videoAreaHelp')!.textContent = t(!advanced() ? 'Videos cover the whole person, including the face.'
      : area === 'body' ? 'Body skin excludes face and hair. Clothes stay visible.'
      : area === 'face' ? 'Face is separate from body skin in advanced video mode.' : 'This choice covers hair only, independently of skin.');
    document.getElementById('videoEffectOptions')!.hidden = advanced() || !['blur', 'checkerboard'].includes(value('whole'));
    for (const name of ['show', 'hide']) document.getElementById(name === 'show' ? 'showAllVideoAreas' : 'hideAllVideoAreas')!
      .setAttribute('aria-pressed', String(['body', 'face', 'hair'].every(part => value(part as Area) === name)));
  };
  tabs.forEach(tab => {
    const choose = (next: 'female' | 'male', focus = false) => {
      gender = next; refresh(); if (focus) tabs.find(item => item.dataset.videoGender === next)?.focus();
    };
    tab.onclick = () => choose(tab.dataset.videoGender as 'female' | 'male');
    tab.onkeydown = event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); choose(event.key === 'Home' ? 'female' : event.key === 'End' ? 'male' : tab.dataset.videoGender === 'female' ? 'male' : 'female', true);
    } };
  });
  regions.forEach(region => {
    const choose = () => { area = region.dataset.videoArea as Area; refresh(); };
    region.onclick = choose;
    region.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); } };
  });
  picker.onchange = () => { area = picker.value as Area; refresh(); };
  actions.forEach(button => { button.onclick = async () => {
    const policies = editablePolicies(getSettings()), policy = policies[gender];
    if (area === 'whole') policy.video = button.dataset.videoAction as FaceEffect;
    else policy[FIELDS[area]] = button.dataset.videoAction as 'show' | 'hide';
    await save({ personPolicies: policies }, button); refresh();
  }; });
  for (const action of ['show', 'hide'] as const) {
    const button = document.getElementById(action === 'show' ? 'showAllVideoAreas' : 'hideAllVideoAreas') as HTMLButtonElement;
    button.onclick = async () => {
      const policies = editablePolicies(getSettings());
      for (const field of Object.values(FIELDS)) policies[gender][field] = action;
      await save({ personPolicies: policies }, button); refresh();
    };
  }
  return { refresh };
}
