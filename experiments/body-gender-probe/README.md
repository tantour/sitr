# Full-body gender model research (2026-09-30)

This began as an isolated research probe. The extension now exposes both converted models as optional image and video classifiers, with face-first fallback choices. The results below describe the preliminary native-model test; later browser and extension checks appear at the end.

## Candidates and sources

- Intel `person-attributes-recognition-crossroad-0230`: [model documentation](https://github.com/openvinotoolkit/open_model_zoo/blob/master/models/intel/person-attributes-recognition-crossroad-0230/README.md). Input is an 80×160 BGR pedestrian crop; output `453[0]` is `is_male`. The model is documented for standing people, less than 20% occlusion, and at least 80-pixel person width. We downloaded the official FP32 XML/BIN model from the [Open Model Zoo storage](https://storage.openvinotoolkit.org/repositories/open_model_zoo/2023.0/models_bin/1/person-attributes-recognition-crossroad-0230/FP32/).
- PaddleClas PPLCNet_x1_0 `person_attribute`: [model documentation](https://github.com/PaddlePaddle/PaddleClas/blob/release/2.6/docs/en/PULC/PULC_person_attribute_en.md) and [inference preprocessing](https://github.com/PaddlePaddle/PaddleClas/blob/release/2.6/deploy/configs/PULC/person_attribute/inference_person_attribute.yaml). Input is a 192×256 RGB pedestrian crop normalized with ImageNet mean/std; output index 22 is `Female`. We downloaded the [official inference artifact](https://paddleclas.bj.bcebos.com/models/PULC/person_attribute_infer.tar). PaddleX documents a related/newer 6.7 MB PP-LCNet pedestrian-attribute model and server-hardware inference times, which were **not** measured here. See [PaddleX documentation](https://github.com/PaddlePaddle/PaddleX/blob/release/3.7/docs/module_usage/tutorials/cv_modules/pedestrian_attribute_recognition.en.md).
- A 365 MB [pedestrian gender BEiT/ONNX model](https://huggingface.co/NTQAI/pedestrian_gender_recognition/tree/main) was rejected before testing as unsuitable for a speed-sensitive extension.

## Back-view test

We selected the first 20 test-split `Back=1, Female=0` and first 20 `Back=1, Female=1` rows among offsets 0–299 of the [PA-100K Hugging Face mirror](https://huggingface.co/datasets/tuandunghcmut/PA-100K). The source images are annotated pedestrian crops, mostly small (roughly 50–110 pixels wide), and were downloaded only to a temporary directory. This is a small, non-random, in-domain sample; PaddleClas used PA-100K training data, so its result is not an independent cross-domain test. Labels describe the dataset's binary perceived-gender annotation, not a person's self-identified gender.

| Model | Male backs correct | Female backs correct | Total | Warm native CPU inference median / p95 |
| --- | ---: | ---: | ---: | ---: |
| Intel 0230 FP32, OpenVINO CPU | 16/20 | 17/20 | 33/40 | 3.0 / 4.2 ms |
| PaddleClas PPLCNet, Paddle CPU | 20/20 | 17/20 | 37/40 | 48.4 / 55.5 ms |

The Paddle timing is from its old-format inference model with graph optimization disabled to avoid a OneDNN compatibility error in Paddle 3.3.1 on this Windows machine. It is not a fair estimate of a converted, optimized ONNX/browser build. The OpenVINO timing excludes image resize and person detection. Neither model was run inside Chromium, so neither has a validated extension speed.

In three separately cropped men from the repo's bus image, Intel labeled only one male; Paddle labeled all three male before face hiding. After obscuring the face rectangles, Intel still labeled only one male and Paddle labeled two male. This is anecdotal and the bus crops are partly occluded and unlike PA-100K images.

## Recommendation

Do not replace the face model yet. Intel is fast but made seven errors in 40 labeled back views, including three female-to-male errors; Paddle made three female-to-male errors and has not met the extension speed target on this machine. A whole-body model can give useful additional evidence when a face is absent, but its label should not be treated as definitive, especially for a filter that exempts one gender. Next gate: acquire a larger, diverse, independently labeled back/side/pose video set, test a browser-compatible conversion at the extension's actual crop sizes, and measure false exemptions and full-pipeline latency under load.

## ONNX conversion and extension check

The official FP32 Intel [XML](https://storage.openvinotoolkit.org/repositories/open_model_zoo/2023.0/models_bin/1/person-attributes-recognition-crossroad-0230/FP32/person-attributes-recognition-crossroad-0230.xml) and [BIN](https://storage.openvinotoolkit.org/repositories/open_model_zoo/2023.0/models_bin/1/person-attributes-recognition-crossroad-0230/FP32/person-attributes-recognition-crossroad-0230.bin) files have SHA-256 hashes `ca288994e74a27bc1912e610460054ca79165ad68c2ec555ccda2738591c1502` and `9a2c20aa88b282219d31b67c9252cdf844d6ce387090eb676e79e284fa3a25d8`. The official Paddle [inference tar](https://paddleclas.bj.bcebos.com/models/PULC/person_attribute_infer.tar) hashes to `576cc739749021298418e61dfa44362acf427a99e055f302c3f895d638a2bde4`. `openvino2onnx` 1.1.0 opset 17 converted the Intel IR, and `paddle2onnx` 1.3.1 opset 14 converted Paddle's `inference.pdmodel` and `inference.pdiparams`. The pinned outputs and hashes are in `models/artifacts.json`.

On the same 40 labeled back-view crops, ONNX Runtime CPU scored 33/40 Intel and 37/40 Paddle, matching the native outputs. Warm per-crop ONNX Runtime CPU inference medians were 2.78 ms Intel and 3.62 ms Paddle, excluding preprocessing. In packaged Chromium, isolated ONNX Runtime Web WASM inference medians were about 13.5 ms Intel and 25.7 ms Paddle for one crop. These figures are model runs, not full image or video latency; multi-person inference and browser startup cost more. `validate_onnx.py` and `browser.mjs` reproduce the checks when the temporary PA-100K sample files are available.

The packaged `extension-smoke.mjs` checks both body models and both face-first fallbacks with independent image/video selectors. It uses the repo bus photo and looping video, not labeled back-view footage. Body-only video skipped face detection and captured no high-resolution face frame; both fallback combinations used the face path, with three body/face attempts for three detected people in the sampled frame. A later video frame accepted a body-estimated label after tracker evidence accumulated. A live switch from body mode to face mode reprocessed already displayed media. Cold startup remains variable, and the test does not establish field accuracy or zero leakage in moving scenes.
