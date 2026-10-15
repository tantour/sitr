# Sitr 0.5.1 release validation

Prepared locally on Windows on October 15, 2026, with Node.js 22.21.0,
locked dependencies and Playwright Chromium. Preparation leaves changes
uncommitted and creates no tags, pushes, or public release.

TypeScript, all 167 unit tests, all 17 browser checks, and documentation-link
checks passed for 0.5.1. The dependency audit reported zero vulnerabilities.

| Check | Coverage |
|---|---|
| TypeScript and unit tests | 167 tests across 27 files, including preparation, queue gating, progress, recovery, pelvis geometry, independent policies and migration. |
| Browser regressions | 17 checks: popup/settings, warmup, body regions, groin, smoke, cross-origin media, responsive images, visibility recovery, stacking, CSS backgrounds, duplicates, cached overlays, thresholds, video compatibility, local Meet, faces and gender. |
| Startup | All 15 preparation paths before dispatch; live popup progress/ready, restart, idempotent preparation and retained sessions across setting changes. Synthetic warmup uses no photographs. |
| Segmentation | Both variants, CPU/WebGPU preference, clothing exclusion, caches, missing-model fallback, independent groin/torso/thigh choices and no video anatomy inference. |
| Anatomy fixtures | Clothed male standing/seated/crossed-leg/multiple-person/cropped cases and mirrors. Earlier source numerical parity is documented in the anatomy report. |
| Screenshots | 0.5.1 popup/settings, groin selection, startup progress/ready, English/Arabic, light/dark and locally rendered coverage. Popup status examples use deterministic test data. |
| Package integrity | Matching package/lockfile/manifest versions; 15 model hashes, runtimes, licenses and distribution boundaries. |
| Dependency audit | npm audit reported zero vulnerabilities. |
| Archives | Chrome, matching source and model ZIPs with SHA-256 checksums. Model ZIP includes original export inputs. Source excludes dependencies, profiles, secrets, local output and binary weights. |

Commands: npm run check; npm run build; npm run test:browser;
node scripts/docs-screenshots.mjs; npm run verify:release;
node scripts/package-release.mjs; node scripts/inspect-release.mjs.
Run npm audit separately against the locked dependencies.

Startup preparation measured approximately 18–22 seconds; model lookup/loading
overhead after preparation was below 2 ms in targeted CPU/GPU probes. This does
not establish equal total first/last-image times, general anatomy/demographic
accuracy, every website's compatibility or zero-frame exposure. Retaining all
sessions increases idle memory. Meet uses local WebRTC fixtures.

Release files are under release/v0.5.1/: three ZIPs, SHA256SUMS.txt and
RELEASE_NOTES.md. Upload all three ZIPs and checksums together after reviewing
the source; paste the notes into the GitHub release.

[Anatomy evidence](GROIN-VALIDATION.md) · [Area controls](BODY-REGIONS.md) ·
[Limits](../README.md#supported-media-and-limitations) · [Historical benchmarks](../BENCHMARK.md)
