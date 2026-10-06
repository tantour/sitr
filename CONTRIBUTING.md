# Contributing to Sitr

Use Node.js 22.12+ and `npm ci`. Run `npm run check` before submitting changes.
Unit tests do not need model downloads. Browser/inference work also requires the
verified release model bundle, `npm run build`, and Playwright Chromium; follow
[README.md](README.md) and [models/README.md](models/README.md).

Keep changes focused and describe the problem, behavior change, and validation.
For coverage changes, exercise startup, source replacement, settings changes,
site pause/resume, disposal, and stale-result rejection. Add regression tests for
meaningful failures; do not promise zero leakage or infer accuracy from a handful
of fixtures. Preserve local processing and conservative failure handling.

For UI changes, update both English and Arabic strings, check right-to-left
layout and light/dark themes, and run `npm run test:popup`. Update documentation
screenshots when controls change. Use anonymized/local fixtures, with explicit
redistribution rights and attribution, for bug reports and tests.

Never commit local profiles, secrets, logs, virtual environments, model exports,
or generated release ZIPs. Model changes require provenance, license review,
pinned input/output hashes, export instructions, and browser validation. Do not
automatically accept changed model hashes because a download or export differs.

Contributions to original project files are submitted under AGPL-3.0-only.
You must have the right to submit your work. Third-party files retain their
upstream licenses and must be identified in NOTICE.md. No copyright assignment
is required. Report vulnerabilities privately as described in SECURITY.md.
