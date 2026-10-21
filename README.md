<p align="center"><img src="icons/sitr-logo.png" width="96" alt="Sitr logo"></p>

# Sitr · ستر

**Private image and video filtering, processed on your device.**

Sitr is a Chrome extension that covers selected people in supported images and videos. Choose skin and hair coverage or whole-person coverage, use black masks, blur, or a pixelated mosaic, and tune images and videos separately. English and Arabic interfaces include light, dark, and system themes.

**New in 0.5.2:** per-part skin thresholds, separate chest and belly controls, optional advanced video masks, and a visual video editor. [See the update and screenshots](#what-changed-in-052).

<img src="docs/images/popup.png" width="440" alt="Sitr 0.5.2 main controls: protection, media tabs, cover area, and Advanced segmentation">

**Requires Chrome 148 or newer.** Sitr uses local AI estimates that can miss people, misclassify appearance, or leave parts of moving media uncovered. It does not guarantee that every unwanted image or video frame is hidden. [Supported media and limitations](#supported-media-and-limitations).

## Install

### From a GitHub release

1. Open [Sitr v0.5.2](https://github.com/tantour/sitr/releases/tag/v0.5.2) release page and download `sitr-0.5.2-chrome.zip` and `SHA256SUMS.txt`.
2. Verify the ZIP's SHA-256 against the checksum file, then extract it into a permanent folder. Do not load the ZIP itself.
3. Visit `chrome://extensions`, turn on **Developer mode**, and choose **Load unpacked**.
4. Select the extracted folder containing `manifest.json`. Pin **Sitr** using Chrome's extensions menu.
5. Refresh any already-open website tabs and open Sitr's popup to choose your coverage.

The extension ZIP includes all models and inference runtimes. Python, Node.js, and a server are unnecessary for installation. This repository distributes unpacked builds; no Chrome Web Store listing is assumed.

To update, extract a new release into your existing extension folder, click **Reload** at `chrome://extensions`, and refresh website tabs. Keeping the same folder preserves the unpacked extension's identity and settings. To uninstall, choose **Remove**; Chrome removes its local extension settings.

### Build from source

Use **Node.js 22.12+**, npm, and Git. Model binaries live in release assets to keep the source repository small.

```sh
npm ci
# Download sitr-0.5.2-models.zip from the matching release first.
npm run models -- --archive /path/to/sitr-0.5.2-models.zip
npm run check
npm run build
npm run verify:release
```

Load `dist/` using the same Chrome steps above. Commands also work in PowerShell; use `npm.cmd` if your execution policy blocks `npm.ps1`. The model installer checks all fifteen pinned hashes before replacing files. For source-weight downloads, export instructions, and reproducibility details, see [models/README.md](models/README.md).

## What you can control

- **Visual editors:** choose image and video coverage independently for Female and Male using gender tabs, clickable person diagrams, area menus, and action buttons. Automatic labels estimate visible appearance; they do not establish identity or gender.
- **Images:** choose exposed skin and hair areas, or Whole body to include clothing. Faces have separate Show, Black, Blur, and Pixelate actions; blur/pixelation strength is independent for each gender.
- **Advanced segmentation:** optional, image-only anatomy detection powered by BodyPix. **Fast** adds less processing; **Quality** is slower with finer detail. Keep it off for grouped body skin with separate face and hair choices.
- **Part thresholds:** hide an entire image part or body when exposed skin exceeds your percentage of that part. Whole-body rules choose Black or Show for the face.
- **Videos:** whole-person silhouettes or faster person boxes, with a visual editor and motion correction between sampled analyses. Optional **Advanced video mode** adds independent body-skin, face, and hair masks. It is off by default and heavy on performance. Select Smooth or Strict playback.
- **Effects:** black, normal blur, and checkerboard blur, with independent intensity, grayscale, and mask-expansion controls. Skin and hair regions use black masks.
- **Sites:** pause on the current site or maintain domain exceptions that also apply to its subdomains and embedded players.
- **Advanced settings:** separate appearance models, image detection gates, model resolution, CPU threads, and diagnostic outlines.

<p><img src="docs/images/popup-en-dark.png" width="360" alt="English dark-theme popup"> <img src="docs/images/popup-ar-light.png" width="360" alt="Arabic popup with right-to-left controls"></p>

## Examples

In **Images**, enable the visible **Advanced segmentation** switch, choose **Male → Show all**, click the thighs on the person,
and choose **Hide** to cover only exposed thigh skin. **Groin (pelvis)** now has
its own choice; hide it alongside thighs to cover both while leaving the torso
shown. Face, hair, neck and
other shown areas keep their own choices. The Female tab is independent.
Click a face to choose Show, Black, Blur or Pixelate. Blur and Pixelate show a strength slider directly below; strength is separate for each gender.

The switch offers **Fast** (stride 16) and **Quality** (stride 8, slower with finer detail). With Advanced segmentation off,
the body becomes one skin area with Show all / Hide all; face and hair remain
independent. Advanced segmentation adds processing time and
can misclassify overlaps. Chest and belly are separate approximate halves along
the person’s shoulder-to-hip direction, including rotated or lying-down bodies.
Cropped or uncertain anatomy can retain an Unresolved torso fallback. Neck is
estimated from head-labeled body skin.

Advanced segmentation is disabled by default. Diagnostic outlines add colored anatomy
maps, including clothing used for threshold measurements; media attributes include `data-local-media-censor-body-regions` and
BodyPix preprocessing/run/decode timing fields. Cached policy changes report
zero new model work. See [body-region controls and diagnostics](docs/BODY-REGIONS.md).

| Goal | Settings |
|---|---|
| Hide male thigh skin only | Advanced segmentation on → Male → Show all → click thighs → Hide. |
| Leave men entirely visible | Male → Show all in Images; Videos → Male → Show (or Show all in advanced video mode). |
| Cover female skin and hair, show face | Female → Hide all → click face → Show. |
| Blur male faces but black female faces | Male → face → Blur; Female → face → Black. |
| Hide the body only above 50% belly skin | Advanced segmentation → belly → Show → Hide entire body → Skin above 50 → choose the face action. |
| Cover female video skin but show face/hair | Videos → Advanced video mode → Female → body skin → Hide; face and hair → Show. |
| Keep one website unrestricted | Pause on this site, or manage domain exceptions in All settings → Websites. |

### Area choices and face effects

The main controls stay above the gender editor. Scroll within the popup to choose an area. With Advanced segmentation on, the diagram controls individual skin areas; with it off, Show all / Hide all change body skin together and preserve face/hair choices.

<p><img src="docs/images/popup-areas.png" width="360" alt="Male editor with only thigh skin hidden"> <img src="docs/images/popup-face.png" width="360" alt="Male face blur with its strength directly below the action buttons"></p>

<p><img src="docs/images/popup-basic.png" width="360" alt="Basic segmentation with one body-skin shape and separate face and hair"> <img src="docs/images/settings-ar.png" width="340" alt="Arabic settings with right-to-left body-area controls"></p>

Cover area has Chosen areas and Whole body. Ordinary skin-area Hide covers exposed skin only. A part threshold can also cover clothing: select a part, set it to **Show** for conditional-only coverage, choose **Hide entire part** or **Hide entire body**, and set **Skin above (%)**. The denominator includes the visible clothed area of that part; exactly 50% does not trigger a 50% rule. Whole-body thresholds offer **Black** or **Show** for the face. These rules are image-only; old global exposure rules remain disabled.

### Part thresholds and video masks

<p><img src="docs/images/part-threshold-body.png" width="440" alt="Male belly threshold: hide the entire body above 50 percent skin while showing the face"> <img src="docs/images/popup-advanced-video.png" width="440" alt="Visual advanced video editor with independently selectable body skin, face and hair"></p>

In **Videos**, the person diagram controls the whole-person Show/Black/Blur/Pixelate choice. Turn on **Advanced video mode** to choose body skin, face and hair separately for each gender. Body skin excludes faces. All three categories come from one MediaPipe Selfie pass; selecting face or hair does not add another inference run. YOLO silhouettes or fast boxes still assign masks to people. Videos never run BodyPix anatomy segmentation or image part thresholds.

**Advanced video mode is heavy on performance and off by default.** It adds MediaPipe on each analyzed video frame and can update more slowly, especially on CPU or with multiple videos. Its expansion slider covers hidden categories while keeping explicitly shown categories open; larger margins can cover nearby clothing. Switching it off restores the standard video effects.

Advanced masks process available source frames as quickly as inference permits, with one analysis outstanding per video. Reliable motion lets person detection run less often, and face captures follow the classification cadence. Actual speed depends on the active GPU/backend; [benchmark details and commands](docs/VIDEO-PERFORMANCE.md) distinguish mask updates from video playback FPS.

<p><img src="docs/images/settings-advanced-video.png" width="760" alt="Desktop settings with matching visual image and video editors"> <img src="docs/images/settings-advanced-video-ar.png" width="340" alt="Arabic visual video selector and mask expansion in dark mode"></p>

![Real local fixture with whole-person black coverage](docs/images/coverage-example.png)

The coverage example uses this release with both gender policies set to Hide all, Whole body coverage, and Black face effects; it demonstrates rendering, not accuracy on unseen content. The popup/settings images use deterministic test status data. The photograph is from Ultralytics assets; see [fixture attribution](tests/fixtures/README.md).

![Full settings](docs/images/settings-desktop.png)

## Privacy

Inference runs locally using packaged models. Sitr has no analytics, account, telemetry, or inference server. Frames, crops, masks, and temporary tracks remain in memory; settings and theme/language preferences are stored in Chrome's local extension storage.

At browser/extension startup, Sitr loads every model variant and runs neutral synthetic inputs to prepare inference. Sessions stay in the shared offscreen worker, including unused segmentation and appearance choices, so the first image and later setting changes avoid model loading and GPU compilation. This uses more idle memory. Startup preparation still takes time after a browser restart, extension reload, or engine recovery; discovered media stays protected while it completes. Actual processing time varies with image content and hardware.

The popup shows preparation steps and elapsed time, then **Ready for images and videos**. Progress counts completed steps rather than estimated seconds remaining; some steps take longer than others. If preparation fails or a feature is unavailable, use **Retry** beside the status.

Sitr needs HTTP(S) host access to analyze page media and fetch unreadable images from their original URLs. Those requests may include existing cookies and are visible to the original website or CDN. A video CORS recovery check may reload a player once and briefly interrupt playback. See the full [privacy policy and permission explanation](PRIVACY.md).

## Supported media and limitations

Supported paths include regular images, readable sampled video, live video streams, HTTP(S) iframes, media in shadow roots, and URL-based CSS background layers on HTML elements. On Google Meet, visible participant videos and shared screens use your **Videos** settings. Analysis rotates across visible tiles with at most two outstanding video captures; larger meetings update each tile less frequently. Other sites select up to two active playing videos. Models prefer WebGPU with WASM fallback; cold startup can take seconds and performance depends on your device. Up to twenty detected people per analysis are supported.

For Google Meet, reload the extension and refresh the Meet tab after updating. Enable **Videos**, check that `meet.google.com` is not paused or excepted, and select the people and effect to cover. Shared presentations keep their readable content, with detected selected people covered. **Faster conservative person boxes** reduce inference work for meeting grids. Filtering changes your local view; it does not alter anyone's transmitted camera or shared screen. Live Meet layouts have not been verified in an actual meeting; the browser regression fixture checks four incoming WebRTC streams, including a presentation.

Animated images, DRM/unreadable streams, canvas players, browser-internal pages, pseudo-element backgrounds, `image-set()`, and many picture-in-picture/native-fullscreen paths are unsupported. Protected media can stay black after acquisition or model failure. Blur and mosaic can leave shapes recognizable. Strict playback reduces stale-mask display but still cannot guarantee complete coverage; Smooth may display an older mask longer.

This is a browser filtering aid. It does not interpret religious rules or determine whether content is permissible. Validate the settings on the content you use. [Detailed behavior](docs/USER_GUIDE.md), [architecture](docs/ARCHITECTURE.md), and [measured performance](BENCHMARK.md) explain the practical limits. Historical benchmark numbers are not a release-wide performance guarantee.

## What changed in 0.5.2

- **Per-part thresholds:** independently configure a skin percentage for each image area and gender. Cover the entire part or entire body when that percentage is exceeded. Coverage includes clothing within the chosen extent.
- **Threshold face choice:** whole-body part rules offer Black (the default) or Show. Show reopens the face after expansion and temporarily overrides its ordinary effect. Black wins if multiple triggered body rules disagree.
- **Chest and belly:** separate approximate halves follow the person’s orientation using existing shoulder/hip landmarks and dense anatomy. Old torso choices migrate to both; uncertain anatomy retains the torso fallback.
- **Advanced video mode:** optional MediaPipe masks for body skin, face and hair, using either existing detector and a separate expansion control. One semantic pass returns all three categories; no anatomy model runs on videos. Off by default, with a visible performance warning.
- **Visual video controls:** the image-style person diagram, Female/Male tabs, keyboard area selection, action buttons and advanced Show all / Hide all replace the dropdown-only layout. Image and video choices remain independent.
- **Documentation and checks:** refreshed English/Arabic screenshots, persistence and keyboard checks, rotated torso fixtures, threshold boundary tests, and real-model checks for both video detectors. Model weights and permissions are unchanged from 0.5.1.

Earlier 0.5.1 startup preparation and groin improvements remain available. Read [0.5.1 release notes](docs/RELEASE-NOTES-0.5.1.md) for their historical measurements and [0.5.2 release notes](docs/RELEASE-NOTES-0.5.2.md) for this update. Accuracy, motion and performance limits remain; these tests do not guarantee complete coverage on unseen content.

## Development and releases

```sh
npm run check                  # TypeScript and unit tests; no models needed
npx playwright install chromium
npm run build                  # Requires the verified model bundle
npm run test:browser            # UI, real extension, media and regression checks
npm run release                # Checks, build, browser suite, ZIPs and SHA-256
```

The release command writes the extension, corresponding source, and model ZIPs to `release/v0.5.2/`. Publish all three and the checksums together. Packaging is local and never creates a commit, tag, or GitHub release. [Prepared release notes](docs/RELEASE-NOTES-0.5.2.md) · [Validation results](docs/VALIDATION.md) · [Contribution guide](CONTRIBUTING.md) · [Release instructions](docs/RELEASING.md) · [Security reporting](SECURITY.md) · [Changelog](CHANGELOG.md).

## License

Copyright © 2026 Sitr contributors. Sitr's original source, documentation, and artwork are licensed under **GNU Affero General Public License version 3 only (`AGPL-3.0-only`)**. You may use, modify, and redistribute it under that license. There is no warranty. Read [LICENSE](LICENSE) and [corresponding-source instructions](SOURCE.md).

Bundled dependencies, pretrained models, and third-party test photographs retain their own licenses and attribution. See [NOTICE.md](NOTICE.md), [LICENSES/](LICENSES/), and [the pinned model manifest](models/artifacts.json). YOLO models use [Ultralytics' AGPL terms](https://www.ultralytics.com/license); including them is why this project uses GNU AGPL v3.
