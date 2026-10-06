# Corresponding source

Sitr is distributed under GNU AGPL version 3. Each public binary release must
include the matching `sitr-VERSION-source.zip` and `sitr-VERSION-models.zip`
assets alongside `sitr-VERSION-chrome.zip`, from the same release run.

The source archive contains the TypeScript source, HTML/CSS, build and model
conversion scripts, tests, documentation, dependency lockfile, and licenses.
The models archive contains the exact converted weights and original YOLO .pt
weights and Intel/Paddle upstream inputs under `model-sources/`. Their origins
are identified by URLs and SHA-256 in `models/artifacts.json`.
See `models/README.md` for export instructions and `docs/RELEASING.md` for the
publication procedure. Dependencies are installed with `npm ci` from the lockfile.

Modifications to the YOLO ONNX graphs: `scripts/export-gpu-models.py` exposes
the pre-TopK head and folds constants for browser WebGPU. FP32 weights are
preserved. `src/vision/yoloRecords.ts` reproduces the removed selection on CPU.
Intel and Paddle models are converted to ONNX without retraining their weights.

Distributors must give recipients access to the complete matching source and
retain this file, `LICENSE`, `NOTICE.md`, and `LICENSES/`. Publishing only the
compiled extension ZIP is insufficient. The license text controls the terms.
