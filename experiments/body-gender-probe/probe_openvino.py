"""Isolated exploratory probe; never imported by the extension."""
import os
import json
import statistics
import time
from pathlib import Path

import numpy as np
import openvino as ov
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
MODEL = HERE / 'openvino-0230.xml'

core = ov.Core()
model = core.read_model(str(MODEL))
compiled = core.compile_model(model, 'CPU')
request = compiled.create_infer_request()
print('input', compiled.input(0).shape, 'outputs', [(out.any_name, out.shape) for out in compiled.outputs])

bus = Image.open(ROOT / 'tests/fixtures/bus.jpg').convert('RGB')
crops = {
    'left_man': (35, 385, 238, 906),
    'middle_man': (205, 390, 355, 865),
    'right_man_partial': (672, 385, 809, 875),
}
face_areas = {
    'left_man': (60, 15, 130, 90),
    'middle_man': (61, 18, 109, 80),
    'right_man_partial': (115, 10, 137, 85),
}

def infer(img):
    pixels = np.asarray(img.resize((80, 160), Image.Resampling.BILINEAR), dtype=np.float32)
    blob = pixels[:, :, ::-1].transpose(2, 0, 1)[None].copy()
    start = time.perf_counter()
    values = request.infer({compiled.input(0): blob})
    elapsed = (time.perf_counter() - start) * 1000
    attributes = np.asarray(values[compiled.output('453')]).ravel()
    return round(float(attributes[0]), 4), elapsed

for name, box in crops.items():
    image = bus.crop(box)
    occluded = image.copy()
    ImageDraw.Draw(occluded).rectangle(face_areas[name], fill='black')
    full, full_ms = infer(image)
    hidden, hidden_ms = infer(occluded)
    print(name, {'is_male': full, 'face_hidden_is_male': hidden,
                 'first_ms': round(full_ms, 2), 'second_ms': round(hidden_ms, 2)})

samples = []
image = bus.crop(crops['middle_man'])
for _ in range(10):
    infer(image)
for _ in range(100):
    _, elapsed = infer(image)
    samples.append(elapsed)
print('warm_inference_ms', {'median': round(statistics.median(samples), 2),
                            'p95': round(sorted(samples)[94], 2)})

back_dir = os.environ.get('BODY_BACK_SAMPLES')
if back_dir:
    results = []
    for path in sorted(Path(back_dir).glob('*.jpg')):
        actual_female = path.stem.endswith('female')
        male_probability, _ = infer(Image.open(path).convert('RGB'))
        results.append({'file': path.name, 'actual_female': actual_female,
                        'male_probability': male_probability,
                        'correct': (male_probability < 0.5) == actual_female})
    print('back_views', json.dumps(results))
    print('back_accuracy', sum(item['correct'] for item in results), '/', len(results))
    print('back_by_label', {label: [sum(item['correct'] for item in results if item['actual_female'] == label),
                                    sum(item['actual_female'] == label for item in results)] for label in [False, True]})
