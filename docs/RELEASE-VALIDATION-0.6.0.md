# Sitr 0.6.0 release validation

Prepared on November 16, 2026 with Node.js 24.22.0 on Windows.

- TypeScript type checking and 269 unit tests pass.
- Documentation links and release resource/model/license verification pass.
- Dependency audit reports zero vulnerabilities after compatible Vite/Vitest updates.
- All 28 browser checks passed across the serial release run and targeted reruns after fixes, using isolated Chromium 153 profiles and packaged models. Coverage includes popup persistence, PDF caching/boxes, warmup, body regions/rules, hair, small images, previews/backgrounds, GIF/WebP, overlays, video motion/capture, face association and appearance estimates.
- PDF layout was inspected locally on representative textbook pages; those private PDFs and local screenshots are excluded from release assets.

Filtering remains approximate. These checks do not guarantee complete coverage, sustained frame rates, or compatibility with all pages.

Release preparation also fixed isolated unassigned-mask specks and background restoration when image protection is disabled. Overlay browser fixtures now bundle their real shared dependencies. The final extension is named Sitr, version 0.6.0. No commits, tags, pushes, or public releases were created during local preparation.
