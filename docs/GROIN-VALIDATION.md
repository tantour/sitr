# Groin and upper-thigh update validation

Checked locally on October 14, 2026, on Windows with Node.js 22.21.0,
Playwright Chromium, ONNX 1.23.0 and ONNX Runtime 1.24.4.

This report records the anatomy implementation checks before startup-progress
work. Current 0.5.1 release results are in [release validation](VALIDATION.md).

The new **Groin (pelvis)** area is independent of torso and thighs. BodyPix's
original shoulder/hip/short-offset heads anchor the pelvis; hip-to-knee segments
repair upper thighs labelled torso or lower legs. All heads share the original
backbone and run in one call. There is no retraining or extra model download.
Both local ONNX exports and the unpacked `dist/` extension were rebuilt.

## Checks

| Check | Result |
|---|---|
| TypeScript and unit tests | Passed: 161 tests in 25 files, including five orientations, adjacent/overlapping people, invalid/weak heads, missing lower-body evidence, skin-only output, independent gender choices and expansion. |
| Settings | Schema 20; old torso actions migrate to groin. Show-all policies remain shown. Existing region IDs are preserved; groin is ID 9. |
| Source numerical validation | Both variants, clothed bus/seated photographs and seeded noise. Old foreground/part outputs are identical. All added pose/offset channels match the pinned source kernels with maximum error below 0.000020. |
| Packaged model paths | CPU and WebGPU preference, both variants, live cached edits, duplicate images, image-only execution and model-failure fallback passed. |
| Real-model anatomy probes | 20 cases: standing, crossed-leg, seated, multiple men and torso-only crop, mirrored, both variants. Actual skin maps never label MediaPipe clothing pixels. |
| Popup | Independent groin action, keyboard selection, English/Arabic layouts; additional real-extension groin/thigh persistence across reload passed with torso shown. |
| Complete browser regressions | All 16 checks passed, including models, anatomy probes, UI, regular/CSS images, reuse/caching, cross-origin media, videos, local Meet streams and appearance classifiers. |

`npm run check`, `npm run build`, `npm run test:browser`, and
`python scripts/validate-bodypix.py --previous-dir PATH` reproduce the respective
checks. The optional previous directory must contain the previous BodyPix files
under their normal basenames. Source heads require the pinned upstream files in
`models/sources/`; the published dense-only 0.5.0 bundle has different BodyPix
hashes from the 0.5.1 update. See [model setup](../models/README.md).

## Media and interpretation

Only modest, fully clothed photographs were used for the new anatomy probes:
the existing bus photograph/crops, the clothed male profile and a public-domain
seated-man portrait. No underwear, swimwear or immodest images were passed to
the models. The wider regression suite also uses the existing modest female
profile; the anatomy fixtures are male. [Fixture attribution](../tests/fixtures/README.md).

Anatomy diagnostics evaluate the same photographs with a synthetic semantic
mask so their clothed pelvis/thigh predictions can be inspected. A separate
normal semantic pass verifies clothing exclusion. Synthetic unit fixtures test
skin masking, independent groin/thigh/torso choices and unchanged face/hand/hair
actions. This does not measure exposed-groin pixel recall on real photographs.

Quality locates the sampled groin landmarks in the standing, crossed-leg and
seated crops and their mirrors. Fast misses one sampled crossed-leg landmark.
Small full-frame people remain difficult: some sampled pelvis points retain
thigh/lower-leg labels even when a pelvis estimate is accepted. Damage in the
old seated photograph removes foreground from one mirrored thigh; it remains
unknown. Torso-only crops produce no invented groin. Confidence rejection and
instance ownership prevent unsupported guesses, but cannot guarantee coverage.
These few poses do not establish equal performance for women or every body type.

Reports and diagnostic overlays are saved locally in `.cache/`:
`groin-model-results.json`, `groin-*.png`, `bodypix-pose-validation.json`,
`body-regions-browser.json` and `groin-browser-suite.log`.

The heads add about 79 KB to each variant. Three warm packaged WebGPU samples
measured run plus decode at 24.1–31.7 ms (Fast) and 91.5–194.0 ms (Quality)
on this machine. These are fixture-stage timings, not throughput guarantees.

## Final regression result

`npm run check` passed with 161 tests and 65 local documentation links.
`npm run test:browser` passed all 16 checks. The additional
`node scripts/popup-ux-check.mjs` run passed after adding real-extension groin
persistence assertions. The final saved anatomy report also satisfies the
expanded standing/seated/Quality-crossed-leg landmark assertions, including
the deliberately unknown damaged thigh. The unpacked build's model hashes,
resources and license boundaries passed `npm run verify:release`.
