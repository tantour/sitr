# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Sitr contributors
"""Derive an FP32, GPU-capturable graph from each pinned YOLO export.

Run with onnx 1.23.0 and onnxruntime 1.24.4. No retraining or precision change.
The two TopK selections move to yoloRecords.ts; all network outputs are retained.
"""
from pathlib import Path
import hashlib
import json
import tempfile
import onnx
import onnxruntime as ort
import numpy as np

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'models/artifacts.json').read_text())
for size in (256, 320, 416):
    source = root / 'models' / f'yolo26n-seg-{size}.onnx'
    expected = next(a['sha256'] for a in manifest['artifacts'] if a['name'] == source.name)
    assert hashlib.sha256(source.read_bytes()).hexdigest() == expected
    target = root / 'models' / f'yolo26n-seg-{size}-gpu.onnx'
    with tempfile.TemporaryDirectory() as directory:
        raw = str(Path(directory) / 'raw.onnx')
        onnx.utils.extract_model(str(source), raw, ['images'], ['/model.23/Transpose_output_0', 'output1'])
        options = ort.SessionOptions()
        # Only portable ONNX constant folding, no CPU-specific fused operators.
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
        options.optimized_model_filepath = str(target)
        options.intra_op_num_threads = 2
        optimized = ort.InferenceSession(raw, options, providers=['CPUExecutionProvider'])
        onnx.checker.check_model(str(target))
        reference = onnx.shape_inference.infer_shapes(onnx.load(str(source)))
        reference.graph.output.append(next(v for v in reference.graph.value_info if v.name == '/model.23/Transpose_output_0'))
        original = ort.InferenceSession(reference.SerializeToString(), providers=['CPUExecutionProvider'])
        for seed in (0, 1):
            image = np.random.default_rng(seed).random((1, 3, size, size), dtype=np.float32)
            records, proto, head = original.run(None, {'images': image})
            raw_head, raw_proto = optimized.run(None, {'images': image})
            anchors = np.argsort(-head[0, :, 4:84].max(axis=1), kind='stable')[:300]
            scores = head[0, anchors, 4:84].reshape(-1)
            chosen = np.argsort(-scores, kind='stable')[:300]
            indices = anchors[chosen // 80]
            rebuilt = np.concatenate((head[0, indices, :4], scores[chosen, None],
                                      (chosen % 80)[:, None], head[0, indices, 84:]), axis=1)[None]
            np.testing.assert_allclose(records, rebuilt, atol=1e-5, rtol=1e-5)
            np.testing.assert_allclose(head, raw_head, atol=1e-3, rtol=1e-4)
            np.testing.assert_allclose(proto, raw_proto, atol=1e-3, rtol=1e-4)
    print(json.dumps({'name': target.name, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                      'source': f'FP32 GPU graph derived from {source.name} by scripts/export-gpu-models.py'}))

# The optional video box detector uses the same pre-TopK extraction for WebGPU.
source = root / 'models' / 'yolo26n-det-256.onnx'
expected = next(a['sha256'] for a in manifest['artifacts'] if a['name'] == source.name)
assert hashlib.sha256(source.read_bytes()).hexdigest() == expected
target = root / 'models' / 'yolo26n-det-256-gpu.onnx'
with tempfile.TemporaryDirectory() as directory:
    raw = str(Path(directory) / 'raw.onnx')
    onnx.utils.extract_model(str(source), raw, ['images'], ['/model.23/Transpose_output_0'])
    options = ort.SessionOptions()
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
    options.optimized_model_filepath = str(target)
    options.intra_op_num_threads = 2
    optimized = ort.InferenceSession(raw, options, providers=['CPUExecutionProvider'])
    onnx.checker.check_model(str(target))
    reference = onnx.shape_inference.infer_shapes(onnx.load(str(source)))
    reference.graph.output.append(next(v for v in reference.graph.value_info if v.name == '/model.23/Transpose_output_0'))
    original = ort.InferenceSession(reference.SerializeToString(), providers=['CPUExecutionProvider'])
    for seed in (0, 1):
        image = np.random.default_rng(seed).random((1, 3, 256, 256), dtype=np.float32)
        _, head = original.run(None, {'images': image})
        (raw_head,) = optimized.run(None, {'images': image})
        np.testing.assert_allclose(head, raw_head, atol=1e-3, rtol=1e-4)
print(json.dumps({'name': target.name, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                  'source': f'FP32 GPU graph derived from {source.name} by scripts/export-gpu-models.py'}))
