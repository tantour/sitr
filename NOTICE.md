# Local Media Censor artifact notice

This private build packages the following separately licensed dependencies and model artifacts:

| Artifact | Version/source | License information |
|---|---|---|
| YOLO26n-seg ONNX weights | Exported from Ultralytics `yolo26n-seg.pt`, assets release v8.4.0 | [Ultralytics AGPL/enterprise terms](https://www.ultralytics.com/license) |
| MediaPipe Tasks Vision and SelfieMulticlass model | `@mediapipe/tasks-vision` 1.0.1; official Google model URL in `models/artifacts.json` | [MediaPipe Apache-2.0 license](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE) and [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf) |
| YuNet 2026may ONNX face detector | OpenCV Zoo artifact pinned in `models/artifacts.json` | [YuNet MIT license](https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/LICENSE) |
| FastFace Large 128 ONNX model | Pinned artifact in `models/artifacts.json`; only gender logits are used | [FastFace Apache-2.0 license](https://github.com/iFurySt/fastface/blob/main/LICENSE) |
| Side-profile portrait test fixtures | Woman and man profile photographs by Pedro Ribeiro Simões, via Wikimedia Commons | [Woman profile](https://commons.wikimedia.org/wiki/File:Woman_profile_portrait_(26138832421).jpg), [man profile](https://commons.wikimedia.org/wiki/File:Man_profile_portrait_(5652920331).jpg), CC BY 2.0 |
| ONNX Runtime Web and packaged WASM | `onnxruntime-web` 1.22.0 | [ONNX Runtime MIT license](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) |

Exact model hashes and URLs are in `models/artifacts.json`. This project did not copy HaramBlur source code. This notice is for local provenance; review each artifact's complete license terms before sharing the extension.
