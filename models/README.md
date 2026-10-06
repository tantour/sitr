# Model setup and provenance

## Install the release bundle (recommended)

Download `sitr-0.4.2-models.zip` and `SHA256SUMS.txt` from this repository's
GitHub Releases page. In the project root, with Node.js 22.12+:

```sh
npm ci
npm run models -- --archive /path/to/sitr-0.4.2-models.zip
npm run models
npm run build
```

PowerShell users can use `npm.cmd`. CI can instead install a published bundle
with `npm run models -- --url HTTPS_URL --sha256 ARCHIVE_SHA256`. The archive
checksum and every individual artifact hash are checked. Only the expected model
entries are extracted, and the complete bundle is validated before files change.
Original YOLO weights are installed under models/; Intel/Paddle inputs are
installed under models/sources/ for export work. They are excluded from dist/.

Packaged model binaries are downloaded or exported locally and are intentionally excluded from Git. `artifacts.json` pins the thirteen shipped artifacts by SHA-256 and identifies their licenses. The build refuses to package a different binary. The 640-pixel ONNX file and PyTorch weights are export/reference inputs and are not shipped in `dist`.

All thirteen files are required to build this distribution, including models for
optional features. Choosing a different classifier in the UI does not change the
bundle's required files.

## Rebuild from upstream inputs

Run `npm run models -- --sources` (or `./scripts/download-models.ps1`) to download
and verify direct upstream models, both YOLO source weights, and the Intel/Paddle
source inputs. A changed/missing upstream artifact fails rather than replacing
the pinned hash. The MediaPipe upstream URL uses `latest`, but its accepted bytes
are fixed by SHA-256; use the release bundle if upstream replaces it. FastFace
is pinned to a specific Hugging Face repository revision.

With Python and `scripts/requirements-models.txt` installed in a separate virtual
environment, run `python scripts/export-models.py`, then
`python scripts/export-gpu-models.py`. Body conversions are shown below.
These are maintainer workflows; ordinary extension installation needs no Python.
Serialization can vary between converter dependency versions. Do not rewrite
artifacts.json to make an unvalidated export pass. Use the release bundle for the
exact pinned serialization; validate graphs, outputs, browser behavior, and
licenses before deliberately releasing new hashes.

The `fastface-large-128.onnx` artifact is FastFace Large 128, a MobileNetV3 face-attribute model. The extension uses only its two gender logits and ignores its age outputs. The model is released under Apache-2.0. `yunet-2026may.onnx` is OpenCV Zoo's tiny, MIT-licensed face detector; it provides the face boxes and nose landmarks used for person association.

The three ONNX exports were made from Ultralytics 8.4.38 `yolo26n-seg.pt` with batch 1, static 256/320/416 inputs, FP32, opset 17, NMS disabled, and no simplifier. The observed outputs are `[1,300,38]` detections and `[1,32,S/4,S/4]` mask prototypes. A fresh export may hash differently across toolchains; validate its graph and update the manifest deliberately before building.

After those exports, run `python scripts/export-gpu-models.py` with ONNX 1.23.0 and ONNX Runtime 1.24.4 to generate the three `-gpu.onnx` variants. This extracts the pre-TopK `[1,N,116]` head and the original prototypes, then folds constants with ORT's portable basic optimizer. Weights, FP32 precision, input size, classes and mask prototypes are preserved. `yoloRecords.ts` reproduces both TopK(300) selections on the CPU, ranking all 80 classes before the existing person filter. This removes unsupported TopK nodes from the GPU compute graph so it can use capture/replay. The export script checks selection equivalence and network-output tolerance at every resolution before printing the artifact hashes. The original graphs remain packaged for WASM fallback.

The optional fast video detector uses the box-only `yolo26n.pt` model from the same official assets release, exported at 256 pixels with the same FP32/ONNX settings. `yolo26n-det-256.onnx` retains its `[1,300,6]` output for WASM. `yolo26n-det-256-gpu.onnx` exposes the `[1,1344,84]` pre-TopK head for captured WebGPU; person thresholding and nonmax suppression run locally in `fastPerson.ts`. The renderer draws conservative rectangular masks from its boxes. `scripts/export-models.py` and `scripts/export-gpu-models.py` reproduce the pinned detection exports after `scripts/download-models.ps1` fetches `yolo26n.pt`.

The optional body-gender files are ONNX conversions of the official Intel Open Model Zoo `person-attributes-recognition-crossroad-0230` FP32 IR and PaddleClas PULC `person_attribute_infer` model. The Intel conversion used `openvino2onnx` 1.1.0, FP32, opset 17; the Paddle conversion used `paddle2onnx` 1.3.1, FP32, opset 14. Source files and conversion notes are in [the probe](../experiments/body-gender-probe/README.md). Both models run with ONNX Runtime Web WASM and receive detected whole-person crops. The conversion preserves their weights. Their scores are fallible visual estimates.

To recreate those two files, download the Intel XML and BIN and Paddle inference tar from the links in the probe README, verify their source hashes there, and extract the tar. With Python 3.11+ and the two converter CLIs installed at the versions above, run from the project root:

```powershell
tar -xf models/sources/person_attribute_infer.tar -C models/sources
openvino2onnx models/sources/openvino-0230.xml models/body-intel-0230.onnx --opset-version 17
paddle2onnx --model_dir models/sources/person_attribute_infer --model_filename inference.pdmodel --params_filename inference.pdiparams --save_file models/body-paddle-pplcnet.onnx --opset_version 14
```

The adjacent Intel BIN must share the XML basename (`openvino-0230.bin`). Compare both generated hashes with `artifacts.json` before building; converter dependency changes can alter serialized ONNX bytes even when outputs agree.
