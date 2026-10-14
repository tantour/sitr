# Sitr v0.5.0 — Choose what to cover

The second Sitr release makes coverage choices independent for Female and Male.
Use the interactive person diagram to show or hide image areas, with separate
face and hair choices. Blur and Pixelate reveal face strength directly below
the buttons, independently for each gender.

## New and improved

- Optional **Advanced segmentation** for images, powered by local BodyPix models.
  **Fast** adds less processing; **Quality** is slower with finer detail. Body skin
  still comes from MediaPipe, and video never runs the anatomy model.
- Individual torso, upper-arm, forearm, hand, thigh, lower-leg, foot, neck, hair,
  and face choices. Torso combines chest and belly; neck boundaries are approximate.
- Correct coverage on both upper arms and forearms. Shown people and areas resist
  mask expansion, fixing unwanted hair/neck coverage and black borders.
- A wider popup, visible Cover area controls, and clearer English/Arabic UI.
  Skin-exposure rules and the shared face-effect mode are removed. Existing
  settings migrate; saved exposure rules are disabled.
- Body-region colors, backend/status/timing diagnostics, cached policy redraws,
  and fallback when an optional model fails.
- Live stream/track handling and rotating analysis of Google Meet tiles and
  presentations, with controls applying only to your local view.
- Updated screenshots, user guide, provenance, and fifteen-model release bundle.

## Download and install

Download **sitr-0.5.0-chrome.zip** and **SHA256SUMS.txt**. Verify the checksum,
extract the ZIP into a permanent folder, then open `chrome://extensions`, enable
Developer mode, and use Load unpacked on the folder containing `manifest.json`.
Requires **Chrome 148+**. All models and inference runtimes are included.

For an existing installation, replace the files in the same extension folder,
click Reload, and refresh website tabs, including Meet. Keeping the same folder
preserves the unpacked extension identity and settings.

**sitr-0.5.0-source.zip** is the matching source; **sitr-0.5.0-models.zip** contains
the verified weights and original export inputs for rebuilding. The old 0.4.2
model bundle cannot build this version. Publish all three ZIPs and the checksums
together under tag **v0.5.0**.

## Validation

TypeScript, all 148 current unit tests, all 15 browser checks, model hashes,
release structure, and documentation links passed locally. npm audit reported
zero vulnerabilities. Browser checks include CSS backgrounds, both segmentation
variants, cached edits, independent face strengths, video compatibility, and
local WebRTC Meet fixtures.

## Performance and limits

Advanced segmentation is off by default. In the measured warm WebGPU fixture on
an Intel i5-8250U/UHD 620, its added stage was approximately **34 ms for Fast**
and **94 ms for Quality**. Both models together add roughly **9.84 MB** of packaged
weights. Cold startup can take seconds; actual results depend on the device and
image. Area and face-strength edits reuse cached inference.

Overlapping parts and appearance estimates can be wrong. This release does not
guarantee complete coverage or zero-frame exposure. Meet regression tests use
local WebRTC fixtures, rather than an actual meeting. See the README, user guide,
and benchmark document for supported media and practical limits.

Sitr processes media locally, with no account, analytics, or inference service.
Original project files remain licensed under **AGPL-3.0-only**; bundled third-party
models and dependencies retain their documented licenses.
