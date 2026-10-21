# Changelog

## 0.5.2 — October 20, 2026

- Add per-gender, per-part image skin thresholds that cover the entire part or body, with Black/Show face choices for whole-body rules. Measure skin against the visible clothed part area and preserve existing Show/Hide actions.
- Split torso into chest and belly using a body-relative half cut from existing pose/dense anatomy, including rotated and lying-down cases. Inherit saved torso choices and retain an unresolved fallback.
- Add Advanced video mode, off by default, combining either existing detector with one MediaPipe pass for independent body skin, face and hair masks. Add separate expansion, respect shown regions and skip body-part inference. Clearly label its performance cost.
- Remove the inherited 4–8 Hz advanced-video cap; analyze available source frames as quickly as inference permits with one request outstanding. Reuse reliably motion-tracked person ownership for at most 250 ms while computing fresh semantic masks, capture face input only when classification is due, request high-performance MediaPipe graphics, and report the actual semantic GPU adapter. Add a reproducible playing-video benchmark.
- Replace video dropdowns with a visual person editor, gender tabs, keyboard-accessible areas, action buttons and advanced Show all / Hide all. Preserve independent image and standard/advanced video settings.
- Refresh release notes, README, guides, English/Arabic screenshots and regression checks. Keep model weights and extension permissions unchanged from 0.5.1.

## 0.5.1 — October 15, 2026

- Show real startup preparation progress and elapsed time in the popup, with ready, limited-feature, and retry states in English and Arabic.

- Prepare all model variants on browser/extension startup using two synthetic inference passes; retain sessions across pages and setting changes. Gate the analysis queue until preparation completes and repeat preparation after engine recovery.

- Add a separate Groin (pelvis) skin choice, in English and Arabic, using the existing BodyPix weights' hip/shoulder landmarks. Correct thigh coverage using hip-to-knee landmarks; preserve hands, face, hair, clothing, and independent torso choices.
- Restore the original pose/short-offset heads in both BodyPix exports without retraining or changing dense segmentation outputs. Saved groin choices inherit the old torso action; settings migrate to schema 20.
- Add modest, mostly male anatomy probes, mirrored standing/seated/crossed-leg fixtures, source-head parity checks, and confidence/overlap/crop tests.

## 0.5.0 — October 14, 2026

- Replace the global people filter with Female/Male tabs and a clickable, keyboard-accessible body editor. Choose Show/Hide per image area, face Show/Black/Blur/Pixelate, and independent video effects.
- Add optional image-only Advanced segmentation powered by two pinned BodyPix ONNX models: Fast (stride 16) and Quality (stride 8, slower with finer detail). Reuse MediaPipe to detect exposed skin; no pose estimation or TensorFlow.js dependency is added.
- Correct both upper-arm and forearm channels, including left/right and front/back. Keep hair and face choices in basic mode; switching off groups body skin conservatively.
- Fix unwanted hair/neck coverage and black expansion borders around fully shown people. Shown areas remain exempt while real hidden overlaps stay covered; unrecognized skin has an explicit choice.
- Move Cover area above the editor, widen the popup, and put per-gender face strength immediately below Blur/Pixelate. Remove the shared face-effect mode and skin-exposure rules; disable saved rules and migrate existing policies.
- Add region colors, backend/variant/status/timing diagnostics, cached policy edits, and conservative fallback when the optional model fails. Videos never run the anatomy model.
- Support rotating analysis of Google Meet participant videos and shared screens, live stream/track changes, ended/static streams, and scene resets.
- Refresh English/Arabic UI screenshots, instructions, provenance, corresponding-source assets, validation, and release packaging. The model bundle now contains fifteen models.

## 0.4.2 — release preparation, October 5, 2026

- Local image and sampled-video protection with independent coverage/effects.
- YOLO silhouettes, faster video boxes, semantic image masks, temporary tracking,
  face estimates, and optional Intel/Paddle whole-person appearance models.
- English/Arabic controls, RTL layout, theme preferences, website exceptions,
  advanced thresholds, resolution/thread controls, and diagnostics.
- Commit the overlay mask before removing the initial blackout.
- GNU AGPL v3 licensing, dependency notices, privacy/security/contribution docs,
  screenshots, verified model installation, release archives, and GitHub CI.

Performance and accuracy limits remain documented in README.md and BENCHMARK.md.
Earlier research measurements in BENCHMARK.md describe their historical builds.
