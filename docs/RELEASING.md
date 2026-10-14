# Publishing Sitr on GitHub

## Local release

1. Use Node.js 22.12+ and `npm ci` in a Git checkout.
2. Install the pinned models as described in `models/README.md`. Ensure no private
   files or undocumented third-party assets are included in the source changes.
3. Run `npx playwright install chromium` and `npm audit`. Resolve reported
   advisories before publishing. Run `npm run release`; it stops on failed checks.
4. Review `release/v0.5.0/sitr-0.5.0-chrome.zip`, `sitr-0.5.0-source.zip`,
   `sitr-0.5.0-models.zip`, and `SHA256SUMS.txt`. Load the extracted extension into
   ordinary Chrome and check your intended websites. Unit and headless checks
   do not establish accuracy or sustained real-site compatibility.
5. When you are ready to publish, review and commit the source and documentation,
   then push to [tantour/sitr](https://github.com/tantour/sitr). Local preparation
   does not commit, create tags, push, or publish.
6. Enable private vulnerability reporting in the repository settings. Create a
   release tagged `v0.5.0`, attach all three ZIPs and the checksum file, and use
   [the prepared 0.5.0 release notes](RELEASE-NOTES-0.5.0.md). State the Chrome minimum and coverage limits.

The three archives must come from the same source/build run. If code changes
after packaging, regenerate them. The source ZIP includes new, non-ignored files
as well as tracked source; it does not change Git's index. Downloaded weights,
virtual environments, local profiles, logs, secrets, and release output are
excluded. Test photographs are separately attributed in `tests/fixtures/README.md`.

The model ZIP contains the pinned shipped models, original YOLO .pt weights,
Intel/Paddle/BodyPix source inputs, licenses, and manifest. The original inputs are under
`model-sources/`; the developer model installer verifies and installs them for
export work. They are excluded from the extension ZIP.
Original upstream inputs and export scripts are available through the source
archive and pinned manifest. Keep matching source/model assets available for each
binary release, as described in SOURCE.md and the GNU AGPL.

### Manual publication of 0.5.0

The local archives are under `release/v0.5.0/`; versioned directories preserve
earlier archives and their checksums. Review the source changes before you
commit and push them yourself. Then open the repository's Releases page, create
a release for tag `v0.5.0` at that exact source commit, paste the prepared release
notes, and upload the Chrome, source, and model ZIPs plus `SHA256SUMS.txt`.
The local build/package scripts never create commits, tags, or GitHub releases.

## GitHub Actions

`ci.yml` runs type checking, unit tests, and dependency audits without model
downloads. `release-check.yml` is manually dispatched with an HTTPS model-bundle
URL and its SHA-256. It installs verified models, builds, runs browser tests, and
uploads all four release files as a GitHub Actions artifact. It does not publish
a release or push source automatically. Download and review the artifact before
creating the public release. Use a bundle matching the source revision; the old v0.4.2 model bundle cannot
build v0.5.0 because it lacks the optional segmentation models.

## Future versions

Update package.json, package-lock.json, and manifest.json together; release verification rejects
mismatches. Update CHANGELOG.md, docs/RELEASE-NOTES-VERSION.md, and any versioned README examples. The UI and
release filenames derive their version from the manifest/package metadata.
Model changes require deliberate provenance/license review, source/output hashes,
and validated export steps. Refresh screenshots after UI changes using
`node scripts/docs-screenshots.mjs`. Keep historical benchmarks labeled with the
build and fixture mix they measured.
