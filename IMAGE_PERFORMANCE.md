# Image performance changes — October 1, 2026

The packaged models, model resolutions, thresholds, and default settings are unchanged.

- Reset capture canvases after failed pixel readback. Previously a cross-origin image permanently tainted the shared probe canvas, forcing subsequent clean images through a fetched bitmap decode. Removed the extra one-pixel probe capture.
- Invalidate image inference only when image-analysis settings change. Video-only and display-only settings no longer discard reusable image detections. Cache lookup still verifies every input byte, and existing memory limits remain in place.
- Mark cached reevaluations in flight so the image scheduler cannot enqueue the same controller twice. Avoid viewport sorting when both image work slots are occupied.
- Ignore acquisition results and errors from retired source epochs. The mixed-media smoke initially exposed a late `stale-session` error leaving a replacement image permanently blocked.
- Decode repeated YOLO prototype samples with row copies and span fills, preserving Float32 output exactly. Count owned/skin pixels during composition instead of scanning each mask again. Return the already-copied semantic mask directly when no resizing is needed.

## Validation

`npm test`: 77 tests passed. Decoder tests compare every output pixel against the original calculation at 256, 320, and 416, plus noninteger scaling and downsampling cases. Added capture-taint recovery and image-settings invalidation checks. Type checking and the production build passed.

`node scripts/image-performance-probe.mjs`: passed. A video-model/render-setting change reused the existing image analysis; a subsequent duplicate image hit the inference cache across the changed settings revision. All model run timings were zero and worker processing took approximately 35 ms in this run (acquisition is separate).

`node scripts/responsive-image-probe.mjs`: passed for cross-origin density/width srcsets and picture sources, while retaining rejection of mismatched fetched-image proportions.

The default mixed-media smoke still fails its nonempty bus-mask assertion: the image completes with two accepted automatic labels, `uncertain-person` status, and zero rendered mask pixels. Waiting for animation-frame painting did not change this result. This check is not reported as passing; whether this fixture's automatic exemptions explain the empty mask needs separate investigation.

The mixed image/video smoke with `SMOKE_CONCURRENT=1 SMOKE_LABEL=1` passed, including visible masks and manual label assignment.

An isolated Node decoder comparison (320 input, 80×80 prototypes, 32 channels, 100 repeated masks, five alternating trials after warmup) measured median 619 ms before and 333 ms after, approximately 46% less decoder time. This measures only mask decoding, not total inference.

The existing default WebGPU photo-grid benchmark, 12 unique images × two rounds, did **not** demonstrate an overall throughput improvement: warm throughput was 1.99 images/s before and 1.86 after. Cold rounds took approximately 42–43 seconds. The short runs include runtime/system noise and the after run overlapped code checks; they are not a controlled throughput claim. Model startup and inference remain substantial costs. Cache reuse and redundant-work reductions should not be interpreted as a universal fresh-image speedup.

## October 4, 2026 — preserve-model performance pass

All model artifacts, resolutions, confidence thresholds, settings defaults,
classification intervals, analysis-rate limits and filtering rules are unchanged.
The production build verifies every packaged model's SHA-256 before building.

- Replace pixel-by-pixel island flood fill with horizontal runs, preserving
  eight-neighbor connectivity, the exact area cutoff and surviving alpha values.
- Sweep contiguous rows during vertical dilation to improve memory locality.
- Hoist video feathering boundary calculations out of pixel loops and use exact
  integer rounding of its bounded convolution sums.
- Reuse track/static/face/black canvas layers and their ImageData across results.
  Remove retired tracks, recreate pixel buffers on resolution changes, and
  reference received RGBA buffers directly instead of copying them again.
  Coalesce parent/style synchronization with the scheduled draw.
- Reuse face and body model input storage, write Paddle crops directly into the
  final batch, and normalize RGB with lookup tables that preserve every original
  Float32 value. YuNet resizing no longer makes an extra pixel-array copy.
- Request only the consumed attribute outputs and dispose face/body output
  tensor handles after each run, including decoding failures.

### Measurements

`node scripts/mask-performance-probe.mjs` compares the captured pre-change
sources against the new code in one process. Each trial runs 120 masks across
blank, solid, sparse and rectangular fixtures. These are medians of seven
alternating trials after warmup, including allocations. Every output byte is
compared before timing.

| Grid | Island cleanup before → after | Dilation before → after | Video mask before → after |
|---|---|---|---|
| 256 | 280.90 → 149.45 ms (1.88×) | 192.99 → 178.12 ms (1.08×) | 340.78 → 280.62 ms (1.21×) |
| 320 | 406.62 → 195.64 ms (2.08×) | 279.19 → 247.67 ms (1.13×) | 497.76 → 408.50 ms (1.22×) |
| 416 | 614.49 → 280.31 ms (2.19×) | 460.63 → 414.61 ms (1.11×) | 817.45 → 654.74 ms (1.25×) |

The default 24-image grid benchmark used three rounds with zero cache hits and
two ONNX threads. Warm rounds increased from 2.32/1.29 images per second before
to 3.03/2.24 after; p95 reveal time changed from 1879/2331 ms to 749/995 ms.
Cold rounds took 47.1 seconds before and 24.0 after. System load and cold GPU
compilation vary considerably; these short browser runs are observations, not
a repeatable speedup guarantee or an isolated measure of this patch.

The mixed-media, automatic-gender-disabled ten-second video smoke passed with
the same image mask coverage (2860 pixels, 1082 after manual male assignment).
Its last video's render stage fell from 11.88 to 5.98 ms. However, the after
run included 23 cold-start protected samples versus zero in the before sample
window, and p95 result age increased from 82 to 100 ms. This does not establish
better end-to-end video cadence or startup. Model initialization and inference
remain the principal limits.

The final video-only probe used the unchanged default settings with automatic
face filtering enabled: 256-pixel YOLO, 320-pixel YuNet, 640-pixel face capture
and two ONNX threads. After a 9.44-second cold start, it completed 54 analyses
over 301 presented frames in ten seconds. All 100 sampled moments retained a
visible result, p95 result age was 176 ms, and automatic face filtering ran
without a classifier error. This verifies the default path; it is not a
before/after video speed comparison. Reproduce with
`node scripts/video-performance-probe.mjs`.

### Validation

- 119 unit tests, TypeScript checking and production build pass.
- New pixel oracles cover island connectivity, all expansion radii, one-pixel
  grids, exact video feathering and every RGB byte's Float32 normalization.
- `scripts/model-buffer-probe.mjs` passes real WASM face/Intel/Paddle inference
  comparisons against the original preprocessing. It checks alternating inputs,
  shrinking batches, invalid body boxes and storage reuse; labels and confidence
  values match exactly.
- `scripts/overlay-reuse-probe.mjs` passes layer reuse, resolution changes,
  retired tracks, clearing and RGBA views with nonzero byte offsets.
- Existing face/profile and skin-threshold rendering browser probes pass.

Local source snapshots and measurement logs are retained in
`.cache/performance-2026-10-04/`, which is excluded from Git. The mask probe also
accepts an explicit JSON source-snapshot path as its first argument.
