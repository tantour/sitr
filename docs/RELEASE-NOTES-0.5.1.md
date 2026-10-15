# Sitr v0.5.1 — Separate coverage, ready models

Independent groin coverage, improved upper-thigh boundaries, and models prepared
ahead of browsing work. The popup now shows actual startup progress and elapsed
seconds in English and Arabic.

## New and improved

- **Groin (pelvis)** is a separate image-area choice for Female and Male. Hide
  groin and thighs while leaving the torso shown, or choose each independently.
- Upper thighs use hip-to-knee landmarks to reduce the gap near the pelvis.
  Existing BodyPix weights expose original pose/short-offset outputs, with no
  retraining or additional model family. Skin-only coverage excludes clothing.
  Cropped, overlapping, or low-confidence anatomy can remain uncertain.
- All model variants run synthetic warmup at browser/extension startup and stay
  loaded across pages and setting changes. Engine recovery repeats preparation.
- The popup shows completed steps and elapsed time, then **Ready for images and
  videos**. Limited-feature and failure states offer **Retry**. Progress measures
  work completed, not estimated time remaining.
- Saved groin choices inherit the former torso choice. Updated English/Arabic
  controls, screenshots, user guide, model provenance, and regression checks.

## Install or update

Download **sitr-0.5.1-chrome.zip** and **SHA256SUMS.txt**, verify the checksum,
and extract into a permanent folder. Open `chrome://extensions`, enable
Developer mode, and **Load unpacked** the folder containing `manifest.json`.
Requires **Chrome 148+**; models and runtimes are included.

To update, replace files in the same extension folder, click **Reload**, and
refresh website tabs. Keeping the folder preserves settings and the unpacked
extension identity. Watch preparation progress in the popup.

Developers: **sitr-0.5.1-source.zip** is the matching source;
**sitr-0.5.1-models.zip** contains pinned models, original export inputs, and
licenses. Use the **new model ZIP**: 0.5.0 BodyPix files have different output
heads and hashes and cannot build this revision. Publish all three ZIPs and
**SHA256SUMS.txt** together under tag **v0.5.1**.

## Performance and validation

Preparation took approximately **18–22 seconds** on the local test machine.
Model lookup/loading overhead afterward was below **2 ms** in tested first
frames and setting changes. Total inference still varies; identical first/last
image latency is not guaranteed. Retaining every model increases idle RAM/GPU
memory. Restart, extension reload, or engine recovery needs preparation again.

Validation covers TypeScript, 167 unit tests, the browser regression suite,
English/Arabic UI, live progress and recovery, modest clothed male anatomy
fixtures, model hashes, documentation, and release archives. Full details are
in `docs/VALIDATION.md` in the source ZIP.

Advanced segmentation remains image-only and off by default. Anatomy and
appearance estimates can be wrong; filtering does not guarantee complete
coverage or zero-frame exposure. Meet checks use local WebRTC fixtures rather
than an actual meeting. Media processing stays local, with no account, analytics,
or inference service. Original Sitr files use **AGPL-3.0-only**; third-party
assets retain their documented licenses.
