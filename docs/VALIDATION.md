# Sitr 0.5.0 release validation

Prepared locally on Windows on October 14, 2026, using Node.js 22.21.0,
locked dependencies, Playwright Chromium, and the unpacked extension.
This preparation does not create commits, tags, pushes, or GitHub releases.

| Check | Result |
|---|---|
| TypeScript | Passed. |
| Unit tests | All 148 current tests across 24 files passed. |
| Browser checks | All 15 checks passed, including the resumed suite after stabilizing background-fixture setup. |
| Popup and settings | Gender tabs, keyboard diagram, independent face strengths, save/load recovery, model choices, video policies, website exceptions, and real extension persistence passed. |
| Segmentation | Both packaged variants on WASM and WebGPU preference; cached edits, duplicate reuse, zero video anatomy inference, model-failure fallback, and fully shown people at maximum expansion passed. |
| Renderers and media | First image reveal, cross-origin capture, responsive sources, visibility recovery, overlay stacking/reuse, CSS backgrounds, duplicates, and effect layers passed. |
| Video and Meet | Shadow players, delayed roots, CORS recovery, source changes, and four local WebRTC Meet streams including presentations passed. |
| Appearance models | Face integration and profile fixtures passed; these do not establish general accuracy. |
| Documentation | Current main popup, area editor, basic mode, face effects, video controls, full settings, Arabic layouts/themes, and actual local coverage screenshots refreshed and inspected. Local links passed. |
| Dependency audit | npm audit reported zero vulnerabilities. |
| Model/build integrity | All fifteen shipped models match pinned hashes. Version metadata, packaged runtime/UI files, license files, and release boundaries passed. |
| Archives | All three ZIP checksums verified; extension contents match dist, model/source inputs match pinned hashes, and source contents match the uncommitted working tree. Local workspaces, weights, profiles, and secrets are excluded from the source ZIP. |
| Fresh model installation | The new model ZIP installed and verified all fifteen models in the extracted source checkout. |
| Independent source rebuild | Fresh npm ci, TypeScript, all 148 unit tests, documentation checks, build, and release verification passed from the extracted source ZIP. All fourteen runtime/manifest/UI files matched the primary build byte for byte. |

The previous unbounded Vitest discovery also collected an old extracted source
under .cache. The release config now includes only tests/**/*.test.ts and limits
worker concurrency. The exhaustive flood-fill equivalence test has a hardware-
tolerant timeout; its assertions and coverage remain intact.

The initial CSS-background check wrote settings directly to storage during
extension startup and sometimes observed no added cover pixels. Its setup now
waits for initialization/migration, uses the actual settings API, and verifies
the configured policy before opening the fixture. The resumed test confirmed
actual cover pixels, debug outlines, layout/repetition preservation, first-paint
protection, restored styles, and disabling.

These checks establish the tested software paths and distribution integrity.
They do not establish demographic/anatomy accuracy, zero-frame exposure, every
live site's compatibility, or sustained performance across hardware. Meet uses
local loopback WebRTC fixtures, rather than an actual meeting. Cold model startup
can take seconds. See [limits](../README.md#supported-media-and-limitations),
[benchmark notes](../BENCHMARK.md), and [area controls](BODY-REGIONS.md).

The Chrome, source, and model ZIPs, SHA256SUMS.txt, and prepared RELEASE_NOTES.md
are available locally under release/v0.5.0. The source rebuild used newly installed
locked npm dependencies; one package was absent from the offline cache, so the
install downloaded the missing pinned package before completing. No source files
were committed, staged, tagged, pushed, or published by this preparation.
Historical first-release evidence is kept in [0.4.2 validation](VALIDATION-0.4.2.md).
