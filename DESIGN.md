---
name: Sitr
description: Light and dark controls for private on-device media protection, in English and Arabic.
colors:
  ink: "#123e3a"
  ink-deep: "#0c302e"
  sea: "#28786d"
  sea-soft: "#e8f3ef"
  paper: "#f6f8f6"
  white: "#fff"
  line: "#dbe5e0"
  muted: "#536e68"
  focus: "#138b7b"
  danger: "#a12f27"
  button-border: "#b4c9c1"
  field-border: "#bccfc6"
  control-active: "#d7eae2"
  dark-ink: "#d4eee4"
  dark-ink-deep: "#e1eee8"
  dark-sea: "#83d4b5"
  dark-sea-soft: "#203b31"
  dark-paper: "#111b17"
  dark-surface: "#18251f"
  dark-line: "#34483d"
  dark-muted: "#adc3b7"
  dark-danger: "#ffb2a8"
  dark-action-ink: "#10291e"
typography:
  title-popup: {fontFamily: '"Segoe UI", Arial, sans-serif', fontSize: "19px", fontWeight: 700, lineHeight: 1.1, letterSpacing: "-.025em"}
  title-settings: {fontFamily: '"Segoe UI", Arial, sans-serif', fontSize: "23px", fontWeight: 650, lineHeight: 1.45, letterSpacing: "-.025em"}
  headline: {fontFamily: '"Segoe UI", Arial, sans-serif', fontSize: "14px", fontWeight: 650, lineHeight: 1.45}
  body: {fontFamily: '"Segoe UI", Arial, sans-serif', fontSize: "13px", fontWeight: 400, lineHeight: 1.45}
  body-settings: {fontFamily: '"Segoe UI", Arial, sans-serif', fontSize: "14px", fontWeight: 400, lineHeight: 1.45}
  label: {fontFamily: '"Segoe UI", Arial, sans-serif', fontSize: "12px", fontWeight: 600, lineHeight: 1.45}
  hint: {fontFamily: '"Segoe UI", Arial, sans-serif', fontSize: "11px", fontWeight: 400, lineHeight: 1.45}
rounded: {field: "6px", button: "7px", disclosure: "8px", panel: "10px", switch: "15px"}
spacing: {"6": "6px", "8": "8px", "10": "10px", "12": "12px", "14": "14px", "16": "16px", "18": "18px", "20": "20px", "22": "22px", "28": "28px", "30": "30px", "38": "38px"}
components:
  button-primary: {backgroundColor: "{colors.ink}", textColor: "{colors.white}", rounded: "{rounded.button}", padding: "6px 11px"}
  button-primary-hover: {backgroundColor: "{colors.sea}"}
  button-secondary: {backgroundColor: "{colors.white}", textColor: "{colors.ink}", rounded: "{rounded.button}", padding: "6px 11px"}
  button-secondary-hover: {backgroundColor: "{colors.sea-soft}"}
  button-text: {textColor: "{colors.sea}", rounded: "{rounded.button}", padding: "5px 2px", typography: "{typography.label}"}
  field-select: {backgroundColor: "{colors.white}", textColor: "{colors.ink-deep}", rounded: "{rounded.field}", padding: "6px 9px"}
  field-textarea: {backgroundColor: "{colors.white}", textColor: "{colors.ink-deep}", rounded: "{rounded.field}", padding: "6px 9px"}
  appearance-tabs: {textColor: "{colors.muted}", padding: "7px 10px"}
  settings-nav: {textColor: "{colors.ink}", rounded: "{rounded.button}", padding: "10px 12px"}
  media-option: {backgroundColor: "{colors.white}", textColor: "{colors.ink-deep}", rounded: "{rounded.field}", padding: "5px 9px"}
  protection-panel: {backgroundColor: "{colors.sea-soft}", textColor: "{colors.ink-deep}", rounded: "{rounded.panel}", padding: "12px 14px"}
  protection-panel-dark: {backgroundColor: "{colors.dark-sea-soft}", textColor: "{colors.dark-ink-deep}", rounded: "{rounded.panel}", padding: "12px 14px"}
  button-primary-dark: {backgroundColor: "{colors.dark-sea}", textColor: "{colors.dark-action-ink}", rounded: "{rounded.button}", padding: "6px 11px"}
---

# Design System: Sitr

## Overview

Sitr uses its existing green identity and logo with white surfaces, compact native controls, and quiet dividers. Daily protection controls and full-page settings share the same visual language; the settings view increases spacing and type size for longer forms.

The header exposes System, Light, and Dark themes alongside English and Arabic. The supplied transparent PNG logo replaces the header's JPG; it is used unchanged, with origin recorded in `.impeccable/logo-provenance.json`.

This records the implemented system in `popup.css`, `popup.html`, and `src/ui/popup.ts`, informed by the popup brief. CSS is the token authority; no creative metaphor has been established.

**Key Characteristics:**

- Green selected states and dark green text.
- System typography and compact native form controls.
- Flat white surfaces separated by subtle borders.
- Persistent status feedback and visible keyboard focus.

## Colors

Sea marks selected controls, links, outputs, and the enabled switch. Ink provides strong text and the filled save action; deep ink is the body text. Soft sea fills selected navigation, checked media options, and protection status.
White is the main surface; paper distinguishes the footer, settings canvas, and technical disclosures. Line supplies dividers; muted carries supporting copy. Focus and danger are semantic colors. Paused, warning, and switch-off colors remain component-specific CSS values.

Dark theme overrides the same semantic CSS variables: dark surface and paper form the canvas, pale ink supplies text, and mint sea marks selection. Native fields follow `color-scheme`; border, paused, warning, selection, and scrollbar colors also adapt. The filled save action uses a separate primary/action-ink pair so its contrast stays correct in both themes. System follows the device's color-scheme preference and updates when it changes.

## Typography

Use Segoe UI with Arial and sans-serif fallbacks throughout; native controls inherit this stack. Semibold labels contrast with regular field values, and range outputs use tabular figures. Popup headings use the headline role. Settings coverage headings grow to 17–18px; the settings brand is 22px, becoming 20px at the narrow breakpoint. No decorative display font is used.

## Layout

The popup is a fixed 400 × 590px flex column with 18px horizontal main padding. Header, current-site section, and footer do not shrink; only the main controls scroll. Default daily controls fit without scrolling, while expanded effect details can scroll.
Settings fill the viewport height with a centered workspace capped at 1120px, a 215px sidebar, and main padding of 30px vertical / 38px horizontal. Coverage caps at 440px; technical forms cap at 720px. Appearance groups use two equal columns with a 30px gap.
At widths of 760px or less, navigation moves above content and wraps, main padding becomes 22px, and appearance groups stack with a divider.

Arabic sets `lang="ar"` and `dir="rtl"` on the document. Logical spacing, navigation borders, outputs, checkbox groups, and switch motion mirror. Domains and website-list inputs stay LTR with bidi isolation; external-link icons mirror. Theme/language selects stay visible in the header, which wraps on narrow full-settings screens. Default Arabic popup controls still fit without scrolling.

## Elevation & Depth

Surfaces are flat, grouped by pale fills and thin borders. The switch thumb alone uses `0 1px 3px #123e3a26`. Its color and movement transitions are 160ms ease-out; reduced-motion preference disables transitions.

## Shapes

Fields and media options use the field radius; buttons and logo use the button radius. Disclosures use the disclosure radius, and protection panels and fieldsets use the panel radius. The switch has a rounded track and circular thumb; tabs use square corners and a bottom selection rule.

## Components

Standard buttons are white with ink labels, thin borders, and minimum height 34px. Hover uses soft sea and a sea border; pressed state uses control-active. Website saving uses filled ink with white text and sea hover. Text actions underline on hover.
Native fields use white fill, a thin field border, and regular-weight values. Popup fields are at least 34px high; settings selects are at least 38px high. Select/textarea hover strengthens the border; invalid website entries use danger.
Appearance tabs use muted labels, ink selected text, and a sea bottom rule. Preserve tab semantics, roving focus, and arrow/Home/End keyboard behavior. Settings navigation uses soft-sea current-page fill and `aria-current="page"`; both appearance groups remain visible there.
Media options pair native checkboxes with outline SVGs; their enclosing label gains soft-sea fill when checked. Protection pairs explanatory status copy with a 44 × 26px switch and 20px thumb; neutral paused styling accompanies a textual reason.
Controls retain a 2px focus outline with 3px offset. Disabled controls use opacity .55. Relevant native disclosures expose effect details. The live footer reports saving, success, drafts, and errors; preferences save automatically, while website drafts require explicit saving.

Theme and language use native header selects and a separate `uiPreferences` storage key, with live synchronization between open views. Locale changes translate existing text nodes, accessible names, options, helper copy, outputs, and dynamic errors without replacing form controls or drafts. Arabic measurements use Arabic digits and plural rules; version identifiers and domain text keep their original format.

## Do's and Don'ts

### Do:

- **Do** retain Sitr's logo, green identity, system font stack, and native control affordances.
- **Do** use pale fills and quiet dividers to distinguish groups and selected states.
- **Do** preserve visible keyboard focus, semantic selected states, and live save feedback.
- **Do** keep the popup footer and current-site action reachable while optional controls scroll.

### Don't:

- **Don't** introduce decorative display fonts, gradients, or card shadows into these control surfaces.
- **Don't** communicate protection, selection, or save failure through color alone.
- **Don't** flatten automatic saves and explicit website-list saves into the same interaction.

