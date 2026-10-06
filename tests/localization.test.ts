// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { afterEach, describe, expect, it } from 'vitest';
import { mediaSummary, number, percent, setLanguage, t } from '../src/ui/localization';
import { normalizeUiPreferences } from '../src/ui/preferences';

afterEach(() => setLanguage('en'));
describe('display preferences', () => {
  it('uses the browser language for new users and preserves explicit choices', () => {
    expect(normalizeUiPreferences(undefined, 'ar-SA')).toEqual({ theme: 'system', language: 'ar' });
    expect(normalizeUiPreferences({ theme: 'dark', language: 'en' }, 'ar-SA')).toEqual({ theme: 'dark', language: 'en' });
    expect(normalizeUiPreferences({ theme: 'bad', language: 'bad' }, 'en-US')).toEqual({ theme: 'system', language: 'en' });
  });
});
describe('Arabic UI language', () => {
  it('formats measurements and translates templated text', () => {
    setLanguage('ar');
    expect(t('Version {version}', { version: '0.4.2' })).toBe('الإصدار 0.4.2');
    expect(t('{value} px', { value: number(24) })).toBe('٢٤ بكسل');
    expect(percent(0.7)).toContain('٧٠');
  });
  it('handles Arabic zero, singular, dual, few, many, and other plurals', () => {
    setLanguage('ar');
    const counts = [0, 1, 2, 3, 11, 100];
    const people = ['لم يُكتشف أشخاص', 'اكتُشف شخص واحد', 'اكتُشف شخصان', 'اكتُشف ٣ أشخاص', 'اكتُشف ١١ شخصًا', 'اكتُشف ١٠٠ شخص'];
    counts.forEach((count, index) => expect(mediaSummary(count, count, count)).toContain(people[index]));
  });
  it('restores English text and numbers when switching back', () => {
    setLanguage('ar');
    expect(t('All settings')).toBe('كل الإعدادات');
    setLanguage('en');
    expect(t('All settings')).toBe('All settings');
    expect(mediaSummary(1, 1, 2)).toBe('1 media item · 1 analyzed · 2 people detected');
  });
  it('translates the new skin exposure controls and their boundaries', () => {
    setLanguage('ar');
    expect(t('Skin exposure rules')).toBe('قواعد نسبة البشرة المكشوفة');
    expect(t('Skin above (%)')).toContain('أكبر من');
    expect(t('Skin at least (%)')).toContain('لا تقل');
    expect(t('More than (people)')).toContain('أكبر من');
  });
});
