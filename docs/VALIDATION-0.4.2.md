# Sitr 0.4.2 release validation

Validated locally on Windows on October 5, 2026, using Node.js 22.21.0 and the
locked dependencies. Browser checks use Playwright Chromium with the unpacked
extension or deterministic local fixtures as appropriate.

| Check | Result |
|---|---|
| TypeScript | Passed. |
| Unit tests | 124 tests across 20 files passed. |
| Browser checks | All 13 checks in scripts/browser-checks.mjs passed. |
| Initial overlay rendering | Smoke regression observed blackout removal after the first mask draw. |
| Documentation | Local links and image files checked; English/Arabic and coverage screenshots inspected. |
| Model integrity | All 13 shipped artifacts and the original bundled model inputs match pinned SHA-256. |
| Dependency audit | Zero reported vulnerabilities in the final npm audit. |
| Release structure | Manifest/package versions, runtime files, license files, and archive boundaries passed. |
| Model installation | Release model ZIP installed successfully into an empty directory. |
| Source rebuild | Exported source ZIP extracted into an isolated folder; fresh npm ci, model installation, typecheck/tests, build, and release verification passed. All 11 runtime/manifest/UI files matched the main build byte for byte. |
| Archives | Extension, model, and source ZIP checksums verified against SHA256SUMS.txt. |

Browser coverage includes popup/settings persistence and failures, English/Arabic
layout and themes, site exceptions, still-image and sampled-video smoke,
cross-origin acquisition, responsive image replacement, visibility recovery,
overlay stacking/reuse, CSS backgrounds, duplicate-source sharing, skin-threshold
rendering, shadow-root video players, CORS recovery, source changes, and appearance
classifier integration. A first cold-start duplicate probe exceeded its former
60-second test deadline; the retry passed. Its deadline now allows 90 seconds for
model startup/fallback, and failures print media diagnostics.

Fixes found during release preparation: draw the overlay before revealing media;
make the smoke coverage fixture select everyone rather than assume default
appearance selection; place the offscreen background fixture outside the
look-ahead range; correct a 65-character typo in the original YOLO input checksum,
verified against the official upstream download. The shipped model bytes were
not changed. The undocumented Lena test image was removed from public source and
retained locally; current probes use attributed fixtures.

These checks establish the tested software paths and build/distribution integrity.
They do not establish demographic accuracy, zero-frame exposure, every live site's
compatibility, or sustained performance on all hardware. Historical performance
results and remaining coverage limits are in ../BENCHMARK.md and ../README.md.
GitHub Actions have been configured but cannot be run remotely until the source
is pushed and the model bundle is available at a supplied HTTPS URL.
