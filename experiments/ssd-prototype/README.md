# Isolated detector comparison

This directory held the browser-only detector comparison before either model was wired into the extension. `benchmark.mjs` serves a separate Vite page and measures Google's SSD MobileNetV2 and the detection-only YOLO26n graph on `tests/fixtures/bus.jpg`. It does not load or alter the extension. `probe.js` exercises MediaPipe CPU/GPU; `probe-detect.js` exercises captured ONNX WebGPU.

The ignored model files are local test inputs. To reproduce, download the [official SSD MobileNetV2 float32 model](https://storage.googleapis.com/mediapipe-models/object_detector/ssd_mobilenet_v2/float32/latest/ssd_mobilenet_v2.tflite) as `ssd_mobilenet_v2.tflite`, copy `models/yolo26n-det-256-gpu.onnx` here as `yolo26n-gpu.onnx`, then run `node experiments/ssd-prototype/benchmark.mjs`. The model was selected based on local measurements recorded in `BENCHMARK.md`, rather than assuming Google's Pixel 6 timings would transfer to desktop Chromium.
