# Local Media Censor

Private, unpacked Chrome 148+ Manifest V3 extension for on-device censorship of supported images and sampled video. It combines YOLO26n-seg person masks, MediaPipe semantic masks, temporary tracking, face detection, and an appearance-based male/female classifier. Inference runs locally. No age result, face identity, or cross-session label is used.

The current prototype detects and tracks up to 20 person instances per analyzed frame. A headless Chromium smoke fixture with ten people returned ten person tracks, ten face-to-person associations, and ten automatic labels. That fixture repeats two source people; it validates the multi-person plumbing and capacity, not accuracy on ten different people. Frontal and side-facing portrait classifier probes also passed, and one side-facing woman was labelled female by the full extension path. These checks do not establish natural-scene accuracy or performance on your machine. The extension remains fail-closed when a face cannot be classified or ownership is uncertain, so that person stays censored under the default setting.

YuNet 2026may draws face boxes and provides nose landmarks for face-to-person association. It runs on a 320×320 view of the 640×640 face capture; FastFace Large 128 then classifies crops from the original 640×640 capture. FastFace estimates visible male/female appearance; it does not determine a person's identity or gender, and may be wrong, especially for small, occluded, extreme-profile, or poorly lit faces. It ignores the model's age output. Both models and their licenses are pinned in `models/artifacts.json`. Their scores can be overconfident; the confidence controls are filters, not calibrated correctness guarantees.

The current build is a prototype, not release-qualified software or a guarantee that no uncensored frame can appear. Browser measurements, failure cases, and limits are in [BENCHMARK.md](BENCHMARK.md). Cold model startup and inference can be slow; video uses lower-rate analysis with motion-based mask movement between analyses.

## Install and run

1. In PowerShell, open this folder and run `npm.cmd ci`.
2. Run `npm.cmd run build`. The build checks pinned model SHA-256 hashes. If model files are missing, run `./scripts/download-models.ps1`; YOLO exports can be regenerated with the pinned export environment described in `models/README.md`.
3. In Chrome 148+, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this folder's `dist` directory.
4. Open a page with images or readable video. The popup starts in female-only mode, with automatic labeling enabled. People whose faces cannot be confidently labeled remain censored. You can change filter and mask categories in the popup.
5. After rebuilding, click **Reload** on the extension page and refresh the website tab. Confirm the popup reports **Version 0.4.0**.

The default categories are body skin and hair; face skin is disabled. Female-only filtering censors people estimated female and people left unclassified. Estimated male tracks are exempt while tracking continuity is reliable. This is a fallible visual estimate, not a statement about anyone's identity. Skin percentage and uncertain labels do not trigger full-person blacking; uncertain masks are restricted to selected semantic regions. Fail-safe blacking can still occur for inference errors or stale video.

The popup's **Face/person matching** setting selects either the stricter face-box overlap score or the simpler face-box center point. Changing it reprocesses current media. Ambiguous matches remain unclassified.

The popup's **Advanced AI thresholds** section exposes the YOLO person confidence threshold, face detector score and minimum face width, gender-estimate confidence (with a separate stricter cutoff for small faces), and face-to-person association coverage, winner margin, and center-mask confidence. The pixel sizes refer to the 640×640 face-analysis frame. Lower confidence thresholds detect more candidates but can increase false detections and mistakes. Changing these controls reanalyzes current media and starts fresh temporary tracks.

The **ONNX CPU threads** control offers Auto and 1, 2, 4, 6, 8, 12, or 16 threads. Auto uses 1 thread on machines with up to four logical cores, 2 on five to eight, and 4 above eight. Changing the control restarts local inference and reanalyzes the page. More threads can reduce throughput when CPU inference competes with GPU segmentation, so compare settings on your own machine before increasing it. The thread control does not change models, input sizes, or detection thresholds.

Open **Model resolution** in the popup to set YOLO image and video resolution independently (Auto, 256, 320, or 416 pixels), YuNet face-detection resolution (256, 320, or 416), and face-source detail (320, 416, 512, or 640). Auto YOLO sizes follow the performance preset; existing settings default to the same effective sizes as before. The face-source slider changes the image captured for detection and face crops, while the packaged FastFace model still receives 128×128 crops. The packaged MediaPipe semantic model still runs at 256×256. Higher values can improve small-detail detection but can increase latency and video blackouts; these controls change input resolution, not the model files or confidence thresholds.

Enable **Show AI debug outlines, face boxes, and gender estimates** in the popup to draw person-instance mask contours and detected face boxes over media, with each current automatic appearance estimate and confidence. Unknown or unusable track labels are shown as unclassified. These visualizations are diagnostic and do not change censorship rules; they add some inference payload and drawing overhead.

## Test it

Run the checks from PowerShell:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npx.cmd playwright install chromium
$env:SMOKE_GENDER='1'
$env:SMOKE_QUICK='1'
node scripts/smoke.mjs
$env:PERF_THREADS='2'
$env:PERF_COUNT='12'
$env:PERF_REPETITIONS='2'
node scripts/perf.mjs
```

The gender smoke run builds a synthetic ten-person image and checks the reported person, face, association, and label counts. `SMOKE_QUICK=1` skips video playback to shorten this capacity check. Unset those variables to run the regular browser smoke, which also samples video:

```powershell
Remove-Item Env:SMOKE_GENDER -ErrorAction SilentlyContinue
Remove-Item Env:SMOKE_QUICK -ErrorAction SilentlyContinue
node scripts/smoke.mjs
```

Other optional checks: set `SMOKE_GRID=1` for viewport-only processing on a 24-image page; `SMOKE_SUSTAINED=1` and `SMOKE_LONG_VIDEO=1` for a ten-second video sample; or `SMOKE_SCROLL=1`, `SMOKE_AUTH=1`, `SMOKE_WEBP=1`, `SMOKE_LABEL=1`, `SMOKE_VIDEO_LABEL=1`, `SMOKE_STATUS=1`, `SMOKE_THREAD_SETTING=1`, `SMOKE_RESOLUTION=1`, `SMOKE_PROFILE=1`, or `SMOKE_PAUSE=1` for the named behavior. `SMOKE_THREAD_SETTING=1` and `SMOKE_RESOLUTION=1` require `SMOKE_STATUS=1`. `node scripts/face-probe.mjs` checks YuNet boxes, nose points, and classifier integration in packaged Chromium; `node scripts/gender-probe.mjs` checks frontal and side-facing portrait crops.

The smoke fixtures run in headless Chromium on local sample media. They do not test YouTube/social-site compatibility, ten unique people, extensive demographic or lighting variation, sustained hardware load, or zero-frame exposure. The included grid benchmark measures this computer's headless Chromium run, which may differ from regular Chrome and live websites.

For a sustained image-throughput check, set `PERF_COUNT=100` and `PERF_DURATION_MINUTES=15` before running `node scripts/perf.mjs`. Each completed 100-image batch prints its throughput and latency; the final line summarizes the run.

## Limits and privacy

Animated images, DRM or tainted video, canvas players, CSS backgrounds, closed shadow roots, restricted browser pages, and most picture-in-picture/native-fullscreen paths are unsupported. Unsupported acquisition or model failure keeps media black. Some warnings from ONNX Runtime or MediaPipe can be informational; repeated worker restarts or an `Analysis timed out` status are failures.

Frames, face crops, masks, tracks, and temporary labels stay in memory and are not sent to a server or persisted. Settings are stored locally. Cross-origin image acquisition may fetch the source image through extension permissions so it can be analyzed locally.

Model URLs, hashes, and provenance are listed in [models/artifacts.json](models/artifacts.json); license details are in [NOTICE.md](NOTICE.md). Ultralytics software/weights have separate [licensing terms](https://www.ultralytics.com/license). Review each artifact's terms before sharing a build.
