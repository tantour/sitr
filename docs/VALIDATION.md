# Sitr 0.5.2 release validation

Prepared locally on Windows on October 20, 2026, with Node.js 22.21.0,
locked dependencies and Playwright Chromium. Preparation leaves changes
uncommitted and creates no tags, pushes or public GitHub release.

TypeScript, all **189 unit tests across 29 files**, all **18 browser checks**,
and documentation-link checks passed. The dependency audit reported **zero
vulnerabilities**. Screenshots were regenerated from the 0.5.2 build. Matching
extension/source/model archives are prepared and inspected with the commands below.

| Check | Coverage |
|---|---|
| TypeScript and unit tests | 189 tests in 29 files, including strict part-percentage boundaries, clothed denominators, independent policies, threshold face choices, rotated chest/belly geometry and video category expansion. |
| Browser regressions | 18 checks: popup/settings, warmup, body regions, groin, smoke, cross-origin media, responsive images, visibility recovery, stacking, CSS backgrounds, duplicates, cached overlays, threshold rendering, video compatibility, advanced video, local Meet, faces and gender. |
| Advanced video | Both actual packaged detectors add MediaPipe only when enabled. Body skin, face and hair produce independent masks. Cached category edits do not run another model. BodyPix work stays zero even with image anatomy configured. |
| Part thresholds | The packaged worker triggers whole-body coverage, reopens faces after expansion, overrides ordinary face effects while triggered, restores them when a 100% threshold remains inactive, and reuses anatomy for percentage edits. |
| Anatomy | Both variants with CPU/WebGPU preference, caches and failure fallback; clothed standing/seated/crossed-leg/multiple-person/crop fixtures and mirrors. Torso landmarks now carry chest/belly IDs. Anatomy includes clothes for measurements; ordinary skin coverage leaves clothing pixels uncovered. |
| Startup | All 15 preparation paths, actual progress/ready, restart, idempotent preparation and retained sessions across setting changes. Synthetic warmup uses no photographs. |
| Video/media | Shadow players, paused/playing sources, CORS recovery, unreadable video protection, source replacement and local four-stream WebRTC Meet fixtures including a presentation. |
| UI and screenshots | Visual image/video editors, keyboard tabs/areas, Show all/Hide all, failure recovery, saved thresholds and advanced choices across reload; English/Arabic, light/dark, popup, desktop and narrow settings. README coverage image uses the real local fixture; UI status examples use deterministic test data. |
| Package integrity | Matching package/lockfile/extension versions, 15 pinned model hashes, runtimes, licenses and release boundaries; ZIP checksums and per-file equality to the final build/source; fresh model-ZIP installation. |
| Dependency audit | npm audit --audit-level=low: zero vulnerabilities. No dependency or model-weight upgrades in this release. |

The browser suite runs serially to avoid simultaneous GPU startup. Source and
Chrome archives contain the same final documentation and screenshots. The model
bundle retains its original export inputs and licenses; its artifact hashes are
unchanged from 0.5.1. Earlier model bundles before 0.5.1 do not satisfy these pins.

Commands used for preparation:

```sh
npm audit --audit-level=low
npm run build
node scripts/docs-screenshots.mjs
npm run check
npm run test:browser
npm run build
npm run verify:release
node scripts/package-release.mjs
node scripts/inspect-release.mjs
```

The final build follows screenshot/documentation updates. The package script
creates Chrome, corresponding-source and model ZIPs with SHA-256 checksums;
inspection verifies all archive checksums, compares every Chrome/source entry
with the workspace, and installs the model bundle into an empty directory.
Sources exclude local profiles, dependencies, secrets, caches, binary weights
and release output. Package/inspection failures must be resolved before upload.

Release files are under `release/v0.5.2/`: three ZIPs, `SHA256SUMS.txt` and
`RELEASE_NOTES.md`. Upload all three ZIPs and checksums together after reviewing
and committing the source; paste the notes into the GitHub release for that commit.

These checks do not establish anatomy/demographic accuracy, every live website's
compatibility, sustained video FPS or zero-frame exposure. Chest/belly and skin
ratios remain estimates. Advanced video adds a semantic pass and is heavy on
performance, especially on CPU or with several streams. Face and hair share
that pass. Retaining all model sessions increases idle memory. Meet uses local
WebRTC fixtures, not a live meeting.

## October 21 advanced-video performance follow-up

The initial mask checks above did not establish usable sustained video speed.
The follow-up removes the 4–8 Hz advanced capture cap, requests high-performance
MediaPipe graphics, reuses reliable detector ownership for less than 250 ms
without adding identity evidence, and avoids large face captures between
classification checks. The semantic stage still receives fresh frames.

TypeScript and **194 unit tests across 30 files** pass. The five affected browser
checks were rerun: video compatibility, advanced video, local Meet, faces and
gender. Advanced video now also verifies real model execution with projected
ownership and immediate manual labels on a projected frame. Cold CPU model
startup can expire initial identities; the fixture establishes real repeated
observations before requiring trusted-motion reuse.
The normal-image performance/cache probe also passed using GPU MediaPipe,
including cached recomposition and duplicate-image reuse with no new inference.

The playing-video benchmark separately records fresh mask updates and presented
frames, timings, visibility, errors and backend details. Measurements on Intel
UHD 620 are documented in [video performance](VIDEO-PERFORMANCE.md); this host
does not expose an RTX 3060, so RTX throughput is unverified. The original 18-check
run remains the initial-release record, not a claim that all 18 were rerun after
this follow-up. The local build and release archives include the follow-up;
publication still requires the usual source/tag/release workflow.

[0.5.1 evidence](VALIDATION-0.5.1.md) · [Anatomy evidence](GROIN-VALIDATION.md) ·
[Area controls](BODY-REGIONS.md) · [Limits](../README.md#supported-media-and-limitations) ·
[Historical benchmarks](../BENCHMARK.md)
