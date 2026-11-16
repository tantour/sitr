# Advanced video performance

## November 16 advanced rules and relative expansion

Advanced anatomy rules remain image-only; they add no body model to videos or
animated GIFs. Image, standard video and advanced video expansions now use a
percentage of each person's longest visible dimension, calculated independently
per track. Legacy pixel settings migrate once to approximate percentages.

On the same RTX 3060 moving-photo fixture, automatic gender and fabric enabled,
12-second advanced-mode runs measured 44.83/46.49 fresh masks/s and 59.99/59.90
presented frames/s (silhouette/fast-box), with zero new analysis errors. This
passes the local 30 Hz regression gate; different coverage sizes and run-to-run
variation mean it is not evidence of an additional speedup.

## November 15, 2026 RTX 3060 beta

This beta keeps one active analysis and one replaceable newest decoded frame per
non-meeting video. It drains fresh waiting work immediately instead of discarding
frames that arrive during inference. Waiting captures expire after 100 ms and
are cleared on source/epoch reset. Meeting tile admission retains its fair limit.
Balanced/Quality normal video no longer inherits the old 4-12 Hz analysis cap;
Performance mode retains a lower normal-mode rate.

Advanced mode still runs fresh MediaPipe segmentation on every analyzed update.
Reliable motion may reuse YOLO ownership for less than 250 ms. Small detector-box
jitter from a preceding buffered frame no longer defeats that reuse: only the
center is translated; the current detector mask is never rescaled. Lost tracks
are excluded from projection, while large geometry changes, uncertain/missing
motion, seeks, cuts, and source changes still require detection.

Video fabric uses a small per-identity clothing palette sampled at most every
250 ms rather than rebuilding and transferring an image-sized RGB fabric map on
every frame. Donors must be eroded class-4 clothing with confident, unambiguous
person ownership. Palettes expire when no clothing is available and never move
to new IDs. Images retain their separate clothing reconstruction.

Tracking confirms weak/contradictory classification at a 200 ms cadence, checks
established labels every 4 seconds, and retains the established label through
one contrary same-model vote. Two contrary observations confirm a replacement.
A single motion-anchored person may turn without losing identity merely because
its torso histogram changes. Brief occlusions retain IDs for up to 6 seconds;
retained masks are capped at 60 and counted against the worker memory budget.
Scene/source resets and ambiguous crossings continue to invalidate continuity.

### Local measurements

Windows, Chromium 153, NVIDIA GeForce RTX 3060, WebGPU YOLO + GPU MediaPipe.
Automatic classification and fabric fill enabled, 256-pixel person input,
15-second advanced and 12-second normal measurements per detector; model preparation excluded. The 60 FPS
source is a canvas stream translating the attributed bus photograph, not a
natural-action/occlusion dataset. These results establish throughput on that
controlled fixture, not accuracy or universal performance on websites.

| Mode | YOLO silhouette fresh masks/s | Fast-box fresh masks/s | Playback frames/s | New analysis errors |
|---|---:|---:|---:|---:|
| Advanced, before motion geometry fix (buffer + palette already applied) | 21.83 | 23.66 | ~60 | 0 |
| Advanced, corrected reuse and bounded mask processing | 37.40 | 39.73 | ~59.8 | 0 |
| Normal, uncapped Balanced mode | 30.75 | 36.50 | 59.7-60.0 | 0 |

November 16 cloth/GIF follow-up: the same 15-second advanced-mode fixture,
automatic classification and cloth enabled, measured 43.46/44.20 fresh masks/s
and 59.73/60.07 presented frames/s (silhouette/fast-box), with zero new analysis
errors. This confirms the cloth lighting pass stayed above the local 30 Hz gate;
run-to-run differences do not establish an additional speedup. Images construct
a coarse garment-only lighting field once; videos reuse a tiny directional
lighting estimate alongside the cached palette. These lighting passes leave
mask alpha unchanged.

Animated GIFs use native decoding in a local extension iframe, analyze only the
current due frame, and present that frame with its matching mask. There is no
unbounded frame queue; inference can reduce animation cadence. At most two
visible animated GIFs/native videos share video admission. Hidden/offscreen GIFs
pause processing and release idle decoders. Single-frame GIFs use image analysis.
The GIF browser probe covers HTTP decoding, separate image/video switches,
replacement sources, transparent disposal and advancing CSS GIF backgrounds.

In a separate 30 FPS encoded clip with fabric off, the original beta produced
23.49/23.66 fresh masks/s; buffered capture produced 29.17/29.16. Playback was
~30 FPS in both. These are source-limited results, not a 60 FPS comparison.

Parallel semantic inference was also measured on this GPU and did not materially
improve throughput, so the serial GPU path remains the default.

```powershell
$env:SITR_PERF_SOURCE = 'motion' # 60 FPS translated-photo stream
$env:SITR_PERF_FABRIC = '1'
$env:SITR_PERF_DURATION_MS = '15000'
$env:SITR_PERF_OUTPUT = '.cache/rtx3060-video.json'
# Optional hardware-specific regression gate:
$env:SITR_PERF_MIN_HZ = '30'
npm run bench:video
# For normal mode, additionally set SITR_PERF_ADVANCED=0.
```

The report separates fresh mask updates from decoded/presented frames and
includes latency, cadence rejection reasons, detector reuse, GPU/backend details
and error counts. Source frame rate, multiple videos, inference fallback and
scene complexity still affect results.

Mask expansion is evaluated on each skin bounding region plus the complete
expansion margin, rather than on a full frame for every person. Coverage tests
compare it with full-grid dilation at the borders and at several radii. Empty
layers are omitted; contour smoothing similarly limits work to visible bounds.
On the final advanced fixture this reduced mean worker rendering from about
4 ms to about 1.4 ms. The hardware-specific 30 fresh-mask/s gate passed for both
detectors; a preceding revision had dipped below the gate on a repeat.

### Hidden-tab recovery

Returning to a visible document now resubscribes video frame callbacks, discards
obsolete waiting captures, refreshes the current video frame and reconciles image
visibility immediately. Hidden documents do not keep capturing video. Completed
image results are re-presented through the reveal path, so a mask that could not
be presented while hidden cannot leave an image permanently blacked out. In-flight
work and completed image analysis are retained rather than cancelled/recomputed.

`npm run test:tab-resume` opens an isolated native Chromium test window and uses
real hidden/visible transitions (including minimization). It covers two cycles,
delayed image responses, fresh video updates, new DOM content, a cancelled old
video callback and re-presenting a completed mask without new image inference.
It uses raw CDP because automation focus emulation otherwise keeps tabs visible.
The temporary profile is removed afterward; this is a headed lifecycle check,
separate from the headless performance benchmark.

## Earlier implementation and integrated-GPU trials

The first 0.5.2 implementation inherited a 4–8 analysis/s video limit and ran
YOLO and MediaPipe serially on every analyzed frame. Face captures were also
made on every update, even between the one-second classification checks.
Functional mask tests did not measure sustained throughput.

The performance follow-up removes that cap: advanced capture follows available
source frames as quickly as inference permits, with one outstanding frame per
video. Fresh MediaPipe masks can
reuse reliably motion-tracked detector ownership for less than 250 ms. Missing
motion, tentative/ambiguous identities, expiry, source changes, seeks and changed
detector settings require a real detector pass. Projected frames add no detector
hits or gender evidence. Face input is captured when classification is due;
new identities request a follow-up capture. Face/hair still share the skin pass,
and videos never run BodyPix anatomy.

MediaPipe now explicitly requests high-performance WebGL2 graphics, matching
ONNX's high-performance preference. Browser/driver decisions still determine
the adapter. Timings include `semanticBackend` and `semanticDevice` so an
integrated GPU or CPU fallback is visible. Enabling the existing parallel
semantic worker alone did not consistently improve the integrated-GPU trial,
so it remains experimental.

## Reproduce

```sh
npm run build
npm run bench:video
```

The benchmark loads the actual unpacked extension, waits for model preparation,
plays the attributed `bus-long.mp4` fixture, then measures both detector choices
for 12 seconds each. Automatic gender classification is enabled by default.
It reports distinct analyzed updates/s, presented video frames/s, visible-frame
sampling, new errors, capture/inference/render timings, and GPU/backend details.
The fixture is an encoded photograph, not an independent natural-motion dataset.

PowerShell controls for a model-only comparison and local JSON report:

```powershell
$env:SITR_PERF_GENDER = '0' # omit for normal automatic classification
$env:SITR_PERF_OUTPUT = '.cache/advanced-video-performance.json'
npm run bench:video
```

`SITR_PERF_DURATION_MS` changes each detector's measurement duration.
`SITR_PERF_PARALLEL=1` tests the experimental separate semantic worker.
Run comparisons serially; concurrent GPU tests distort results.

## October 21, 2026 local measurements

Windows, Playwright Chromium, Intel UHD Graphics 620. This host does not expose
an RTX 3060. All trials used the same packaged models and 256-pixel person input.

| Configuration | YOLO silhouette updates/s | Fast-box updates/s |
|---|---:|---:|
| Original implementation, automatic gender off (6 s each) | 5.17 | 4.17 |
| Intermediate follow-up, automatic gender off (12 s each) | 5.67 | 5.75 |
| Intermediate follow-up, automatic gender on (two 12 s trials each) | 4.92–5.58 | 4.92–5.33 |
| Final scheduler, automatic gender on (12 s each) | 6.17 | 6.50 |

In the automatic-gender trial, playback presented about 30 frames/s; all sampled
observations were revealed, with zero new analysis errors during measurement.
Mean MediaPipe time across follow-up trials was about 83–103 ms and remained
the largest cost on this integrated GPU. In the final trial, 44–48% of updates
reused person motion; large face input was captured on only 18–19% of updates.
These short runs do not
establish RTX performance, sustained thermal behavior, mask accuracy, or a
universal FPS gain. Device-specific verification remains needed.
