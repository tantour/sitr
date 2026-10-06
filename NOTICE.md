# Sitr copyright and third-party notices

Copyright (C) 2026 Sitr contributors. Original Sitr source, documentation, and
project artwork are licensed under GNU AGPL version 3 only. See [LICENSE](LICENSE)
and [SOURCE.md](SOURCE.md). SPDX identifier: `AGPL-3.0-only`. No warranty is provided.

The following third-party dependencies and model artifacts retain their licenses:

| Artifact | Version/source | License information |
|---|---|---|
| YOLO26n-seg ONNX weights | Exported from Ultralytics `yolo26n-seg.pt`, assets release v8.4.0 | [Ultralytics AGPL/enterprise terms](https://www.ultralytics.com/license) |
| YOLO26n detection ONNX weights | Exported from Ultralytics `yolo26n.pt`, assets release v8.4.0 | [Ultralytics AGPL/enterprise terms](https://www.ultralytics.com/license) |
| MediaPipe Tasks Vision and SelfieMulticlass model | `@mediapipe/tasks-vision` 1.0.1; official Google model URL in `models/artifacts.json` | [MediaPipe Apache-2.0 license](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE) and [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf) |
| YuNet 2026may ONNX face detector | OpenCV Zoo artifact pinned in `models/artifacts.json` | [YuNet MIT license](https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/LICENSE) |
| FastFace Large 128 ONNX model | Pinned artifact in `models/artifacts.json`; only gender logits are used | [FastFace Apache-2.0 license](https://github.com/iFurySt/fastface/blob/main/LICENSE) |
| Intel person-attributes-recognition-crossroad-0230 FP32 model | Official Open Model Zoo IR, converted to ONNX | [Open Model Zoo Apache-2.0 license](https://github.com/openvinotoolkit/open_model_zoo/blob/master/LICENSE) and [model documentation](https://github.com/openvinotoolkit/open_model_zoo/blob/master/models/intel/person-attributes-recognition-crossroad-0230/README.md) |
| PaddleClas PULC person_attribute_infer model | Official PaddleClas inference weights, converted to ONNX | [PaddleClas Apache-2.0 license](https://github.com/PaddlePaddle/PaddleClas/blob/release/2.6/LICENSE) and [model documentation](https://github.com/PaddlePaddle/PaddleClas/blob/release/2.6/docs/en/PULC/PULC_person_attribute_en.md) |
| Side-profile portrait test fixtures | Woman and man profile photographs by Pedro Ribeiro Simões, via Wikimedia Commons | [Woman profile](https://commons.wikimedia.org/wiki/File:Woman_profile_portrait_(26138832421).jpg), [man profile](https://commons.wikimedia.org/wiki/File:Man_profile_portrait_(5652920331).jpg), CC BY 2.0 |
| ONNX Runtime Web and packaged WASM | `onnxruntime-web` 1.22.0 | [ONNX Runtime MIT license](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) |

Exact model hashes, source-input URLs, and license identifiers are in
[models/artifacts.json](models/artifacts.json). This project did not copy HaramBlur
source code. Third-party components are not relicensed by the Sitr license.

Full texts are included in [LICENSES/](LICENSES/) and copied into every build:
GNU AGPL v3, Apache-2.0, YuNet MIT (copyright 2020 Shiqi Yu), FastFace Apache-2.0
(copyright 2026 FastFace contributors), Intel Open Model Zoo Apache-2.0,
PaddleClas Apache-2.0, ONNX Runtime MIT and its upstream ThirdPartyNotices,
and CC BY 2.0. [DEPENDENCIES.txt](LICENSES/DEPENDENCIES.txt) contains the installed
runtime/dependency-tree and ZIP-tooling license texts, generated during build.
fflate is used only by release tooling; the runtime bundle may remove unused
dependencies. Sitr uses ONNX Runtime's WASM/WebGPU entry point, not ONNX.js.
The upstream ONNX notice describes its broader distribution; its inclusion does
not mean that all its listed backends are packaged in Sitr.

Modifications: Sitr exports YOLO weights to static FP32 ONNX and derives pre-TopK
graphs with scripts/export-gpu-models.py for WebGPU. CPU code reproduces the
removed selection; original graphs are retained for WASM. Intel/Paddle weights
are format-converted without retraining. The extension ignores FastFace's age
output and uses appearance logits. Estimates remain fallible.

The bus JPEG is from [Ultralytics assets](https://github.com/ultralytics/assets/blob/main/im/bus.jpg)
under that repository's [AGPL license](https://github.com/ultralytics/assets/blob/main/LICENSE).
Its local video fixtures and documentation mask screenshot are derivatives.
Photographic tests are not shipped in the extension. See
[tests/fixtures/README.md](tests/fixtures/README.md) for complete fixture attribution.
UI screenshots show Sitr's interface with deterministic status data. Sitr logo
files are project-supplied artwork. The undocumented Lena fixture is excluded
from public distribution; historical reports may still refer to it.

Keep all license texts and notices, and distribute the complete matching source
alongside binary releases as described in SOURCE.md.
