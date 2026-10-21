# Advanced video performance

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
