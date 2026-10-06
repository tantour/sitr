// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { captureStaticTranslations, setLanguage, type Language } from './localization';

export type Theme = 'system' | 'light' | 'dark';
export interface UiPreferences { theme: Theme; language: Language }
const key = 'uiPreferences';
export function normalizeUiPreferences(value: unknown, browserLanguage = navigator.language): UiPreferences {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<UiPreferences>;
  return {
    theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : 'system',
    language: raw.language === 'en' || raw.language === 'ar' ? raw.language : browserLanguage.toLowerCase().startsWith('ar') ? 'ar' : 'en',
  };
}

export function initializeUiPreferences(onChange: () => void, onError: (message: string) => void, onSaved: () => void): void {
  const theme = document.getElementById('uiTheme') as HTMLSelectElement;
  const language = document.getElementById('uiLanguage') as HTMLSelectElement;
  const translateStatic = captureStaticTranslations();
  let preferences = normalizeUiPreferences(undefined);
  let saving = false;
  let interacted = false;
  // A synchronous local cache avoids a light/English flash when reopening the popup.
  try { preferences = normalizeUiPreferences(JSON.parse(localStorage.getItem(key) || 'null')); } catch { /* Storage cache is optional. */ }
  const apply = (value: UiPreferences) => {
    preferences = value;
    document.documentElement.dataset.theme = value.theme;
    document.documentElement.lang = value.language;
    document.documentElement.dir = value.language === 'ar' ? 'rtl' : 'ltr';
    setLanguage(value.language);
    theme.value = value.theme;
    language.value = value.language;
    translateStatic();
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Chrome storage remains authoritative. */ }
    onChange();
  };
  apply(preferences);
  const change = async () => {
    interacted = true;
    const previous = preferences;
    const next = normalizeUiPreferences({ theme: theme.value, language: language.value });
    saving = true;
    theme.disabled = language.disabled = true;
    apply(next);
    try { await chrome.storage.local.set({ [key]: next }); onSaved(); }
    catch {
      apply(previous);
      onError('Could not save display settings. Try again.');
    } finally {
      saving = false;
      theme.disabled = language.disabled = false;
    }
  };
  theme.onchange = language.onchange = change;
  void chrome.storage.local.get(key).then(result => {
    if (!interacted) apply(normalizeUiPreferences(result[key]));
  }).catch(() => onError('Could not load display settings. Try again.'));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[key] && !saving) apply(normalizeUiPreferences(changes[key].newValue));
  });
}
