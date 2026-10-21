# Sitr v0.5.2 — Part thresholds and visual video controls

Choose when an image part should cover the entire part or body, split chest and
belly independently, and control video coverage with the same visual editor as
images. Optional Advanced video mode adds independent body-skin, face and hair
masks while keeping the existing person detector.

## New and improved

- **Per-part image thresholds:** select an area and percentage, then Hide entire
  part or Hide entire body. The percentage is exposed body skin divided by the
  estimated visible part area, including clothing. A rule triggers strictly
  above its percentage. Set the part to Show for conditional-only coverage;
  ordinary Show/Hide actions still apply.
- **Threshold face action:** body rules offer Black (the default) or Show. Show
  reopens the semantic face and uniquely associated face box after expansion,
  overriding that person's ordinary face effect while the rule triggers. Black
  takes precedence if multiple triggered body rules disagree.
- **Chest and belly:** separate approximate halves use existing shoulder/hip
  landmarks and dense anatomy to follow body orientation, including sideways,
  lying-down and upside-down cases. Saved torso choices migrate to both areas;
  missing or ambiguous anatomy retains Unresolved torso.
- **Advanced video mode:** off by default and explicitly marked **heavy on
  performance**. MediaPipe runs on each analyzed video frame alongside either
  YOLO silhouettes or fast person boxes. Body skin excludes faces; face and hair
  have separate Show/Hide choices. All three masks share one semantic pass.
  Videos do not run BodyPix part segmentation or image thresholds.
- **Advanced video performance:** remove the inherited 4–8 Hz cap, analyze
  available frames as quickly as inference permits, reuse reliable person motion for at
  most 250 ms between detector passes, and capture large face inputs only when
  classification is due. Request high-performance MediaPipe graphics and report
  the active semantic GPU adapter. Add a playing-video benchmark.
- **Visual video editor:** Female/Male tabs, clickable person diagrams, keyboard
  area selection, action buttons and advanced Show all / Hide all. Separate
  expansion respects shown regions. Standard whole-person effects are retained
  when advanced mode is switched off; image/video policies stay independent.
- Refreshed README, user guide, English/Arabic screenshots and regression checks.
  Model weights, artifact hashes, required permissions and Chrome minimum are
  unchanged from 0.5.1.

## Install or update

Download **sitr-0.5.2-chrome.zip** and **SHA256SUMS.txt**, verify its SHA-256,
and extract into a permanent folder. In `chrome://extensions`, enable Developer
mode and Load unpacked the folder containing `manifest.json`. Requires
**Chrome 148+**; models and runtimes are included.

To update, replace the files in the same extension folder, click **Reload**,
and refresh website tabs. This preserves the unpacked extension identity and
saved settings. Wait for startup preparation to finish. Advanced video mode
remains off until enabled.

Developers: **sitr-0.5.2-source.zip** contains matching source;
**sitr-0.5.2-models.zip** contains pinned models, original export inputs and
licenses. The 0.5.1 model files are also compatible because hashes are unchanged;
0.5.0 and older bundles do not meet the restored BodyPix output pins. Publish
all three ZIPs and **SHA256SUMS.txt** together under tag **v0.5.2**.

## Validation

Initial release preparation passed TypeScript, **189 unit tests**, all **18
browser checks**, and refreshed English/Arabic UI screenshots. The performance
follow-up expands unit coverage to **194 tests** and reruns affected browser
checks; see the validation record for current evidence. npm audit reported **zero vulnerabilities**.
Checks include both packaged video detectors with independent semantic masks,
threshold face overrides, cached policy edits, model fallback and local WebRTC
streams. Archives include matching source, pinned models and SHA-256 checksums.

## Performance, privacy and limits

Advanced video adds a semantic inference pass and can substantially slow analysis,
especially on CPU or with several videos. Face/hair selections reuse that pass;
they do not start additional models. Standard mode preserves the existing
whole-person video path. This release introduces no new model weights, network
services, analytics or accounts; media processing stays on device.

Skin ratios, anatomy and appearance labels are fallible estimates of visible
content. Uncertain/missing anatomy can prevent a threshold from triggering.
Mask expansion can cover nearby clothing, and motion can outrun sampled video
masks. These controls do not guarantee complete coverage or zero-frame exposure.
Meet validation uses local WebRTC fixtures rather than an actual meeting.

See [release validation](https://github.com/tantour/sitr/blob/v0.5.2/docs/VALIDATION.md), [area behavior](https://github.com/tantour/sitr/blob/v0.5.2/docs/BODY-REGIONS.md),
[user guide](https://github.com/tantour/sitr/blob/v0.5.2/docs/USER_GUIDE.md), and the
[README screenshots](https://github.com/tantour/sitr/blob/v0.5.2/README.md).
Original Sitr files use **AGPL-3.0-only**; third-party assets retain their licenses.
