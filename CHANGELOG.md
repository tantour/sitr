# Changelog

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
