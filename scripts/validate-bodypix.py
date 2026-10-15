# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Sitr contributors
"""Validate restored pose heads against pinned source kernels, on modest media.
Optional --previous-dir compares dense outputs to .onnx files of the same names.
Requires the maintainer ONNX/ORT/NumPy/Pillow environment, not shipped at runtime.
"""
from pathlib import Path
import argparse, hashlib, json
import numpy as np
import onnx
import onnxruntime as ort
from PIL import Image

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--previous-dir', type=Path)
args = parser.parse_args()
sources = root / 'models/sources'
pins = json.loads((root / 'models/artifacts.json').read_text())
for entry in pins['sourceArtifacts']:
    if entry['name'].startswith('bodypix075-'):
        assert hashlib.sha256((sources / entry['name']).read_bytes()).hexdigest() == entry['sha256']
source = json.loads((sources / 'bodypix075-stride16.json').read_text())
weights = {}
for group in source['weightsManifest']:
    raw = (sources / 'bodypix075-quant2.bin').read_bytes()
    offset = 0
    for weight in group['weights']:
        size = int(np.prod(weight['shape']))
        q = weight.get('quantization')
        dtype = '<u2' if q and q['dtype'] == 'uint16' else '<u1' if q else '<f4'
        data = np.frombuffer(raw, dtype=dtype, count=size, offset=offset)
        offset += size * np.dtype(dtype).itemsize
        if q:
            data = (data.astype(np.float64) * q['scale'] + q['min']).astype(np.float32)
        weights[weight['name']] = data.reshape(weight['shape'])
    assert offset == len(raw)
results = []
for stride, side in [(16, 257), (8, 321)]:
    name = f'bodypix-mobilenet075-stride{stride}-{side}.onnx'
    model = onnx.load(root / 'models' / name)
    onnx.checker.check_model(model)
    shared = next(node.input[0] for node in model.graph.node if node.output[0] == 'float_heatmaps/conv')
    grid = (side - 1) // stride + 1
    model.graph.output.append(onnx.helper.make_tensor_value_info(shared, onnx.TensorProto.FLOAT, [1, 384, grid, grid]))
    session = ort.InferenceSession(model.SerializeToString(), providers=['CPUExecutionProvider'])
    previous = ort.InferenceSession(str(args.previous_dir / name), providers=['CPUExecutionProvider']) if args.previous_dir else None
    for fixture in ['bus.jpg', 'man-seated.jpg', 'noise']:
        if fixture == 'noise':
            tensor = np.random.default_rng(42).uniform(-1, 1, (1, 3, side, side)).astype(np.float32)
        else:
            image = Image.open(root / 'tests/fixtures' / fixture).convert('RGB')
            image.thumbnail((side, side), Image.Resampling.BILINEAR)
            square = Image.new('RGB', (side, side), 'white')
            square.paste(image, ((side - image.width) // 2, (side - image.height) // 2))
            tensor = (np.asarray(square).transpose(2, 0, 1)[None].astype(np.float32) / 127.5 - 1)
        outputs = dict(zip([o.name for o in session.get_outputs()], session.run(None, {'sub_2': tensor})))
        feature = outputs[shared].transpose(0, 2, 3, 1)
        errors = {}
        # Independent NHWC computation of the original 1×1 heads, from the
        # source's quantized kernel bytes and biases, including all 17/34 channels.
        for output, head in [('float_heatmaps', 'heatmap_2'), ('float_short_offsets', 'offset_2')]:
            kernel = weights[f'MobilenetV1/{head}/weights'][0, 0]
            bias = weights[f'MobilenetV1/{head}/Conv2D_bias']
            expected = (feature @ kernel + bias).transpose(0, 3, 1, 2)
            error = float(np.max(np.abs(expected - outputs[output])))
            assert error < .0001, (name, fixture, output, error)
            errors[output] = error
        if previous:
            old = dict(zip([o.name for o in previous.get_outputs()], previous.run(None, {'sub_2': tensor})))
            for output in ['float_segments', 'float_part_heatmaps']:
                error = float(np.max(np.abs(old[output] - outputs[output])))
                assert error < .0001, (name, fixture, output, error)
                errors[output] = error
        results.append({'model': name, 'fixture': fixture, 'maxErrors': errors})
report = root / '.cache/bodypix-pose-validation.json'
report.parent.mkdir(exist_ok=True)
report.write_text(json.dumps(results, indent=2))
print(json.dumps(results, indent=2))
