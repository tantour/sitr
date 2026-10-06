# Publishing Sitr on GitHub

## Local release

1. Use Node.js 22.12+ and `npm ci` in a Git checkout.
2. Install the pinned models as described in `models/README.md`. Ensure no private
   files or undocumented third-party assets are included in the source changes.
3. Run `npx playwright install chromium` and `npm audit`. Resolve reported
   advisories before publishing. Run `npm run release`; it stops on failed checks.
4. Review `release/sitr-0.4.2-chrome.zip`, `sitr-0.4.2-source.zip`,
   `sitr-0.4.2-models.zip`, and `SHA256SUMS.txt`. Load the extracted extension into
   ordinary Chrome and check your intended websites. Unit and headless checks
   do not establish accuracy or sustained real-site compatibility.
5. Commit the source and documentation, create the public GitHub repository,
   and push that reviewed source. No remote is supplied by this checkout.
6. Enable private vulnerability reporting in the repository settings. Create a
   release tagged `v0.4.2`, attach all three ZIPs and the checksum file, and use
   CHANGELOG.md for the release notes. State the Chrome minimum and coverage limits.

The three archives must come from the same source/build run. If code changes
after packaging, regenerate them. The source ZIP includes new, non-ignored files
as well as tracked source; it does not change Git's index. Downloaded weights,
virtual environments, local profiles, logs, secrets, and release output are
excluded. Test photographs are separately attributed in `tests/fixtures/README.md`.

The model ZIP contains the pinned shipped models, original YOLO .pt weights,
Intel/Paddle source inputs, licenses, and manifest. The original inputs are under
`model-sources/`; the developer model installer verifies and installs them for
export work. They are excluded from the extension ZIP.
Original upstream inputs and export scripts are available through the source
archive and pinned manifest. Keep matching source/model assets available for each
binary release, as described in SOURCE.md and the GNU AGPL.

## GitHub Actions

`ci.yml` runs type checking, unit tests, and dependency audits without model
downloads. `release-check.yml` is manually dispatched with an HTTPS model-bundle
URL and its SHA-256. It installs verified models, builds, runs browser tests, and
uploads all four release files as a GitHub Actions artifact. It does not publish
a release or push source automatically. Download and review the artifact before
creating the public release. The first release can use the locally prepared
bundle; later workflow runs can use the already published model asset.

## Future versions

Update package.json and manifest.json together; release verification rejects
mismatches. Update CHANGELOG.md and any versioned README examples. The UI and
release filenames derive their version from the manifest/package metadata.
Model changes require deliberate provenance/license review, source/output hashes,
and validated export steps. Refresh screenshots after UI changes using
`node scripts/docs-screenshots.mjs`. Keep historical benchmarks labeled with the
build and fixture mix they measured.
