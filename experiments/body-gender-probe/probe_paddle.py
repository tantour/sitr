"""Isolated exploratory probe; never imported by the extension."""
import statistics
import json
import os
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from paddle import inference

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
MODEL = HERE / 'person_attribute_infer'

config = inference.Config(str(MODEL / 'inference.pdmodel'), str(MODEL / 'inference.pdiparams'))
config.disable_gpu()
config.set_cpu_math_library_num_threads(2)
config.switch_ir_optim(False)
predictor = inference.create_predictor(config)
input_name = predictor.get_input_names()[0]
output_name = predictor.get_output_names()[0]
input_handle = predictor.get_input_handle(input_name)
output_handle = predictor.get_output_handle(output_name)
print('input', input_name, input_handle.shape(), 'output', output_name)

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
    pixels = np.asarray(img.resize((192, 256), Image.Resampling.BILINEAR), dtype=np.float32) / 255
    pixels = (pixels - np.array([.485, .456, .406], dtype=np.float32)) / np.array([.229, .224, .225], dtype=np.float32)
    blob = pixels.transpose(2, 0, 1)[None].copy()
    input_handle.reshape(blob.shape)
    input_handle.copy_from_cpu(blob)
    start = time.perf_counter()
    predictor.run()
    values = output_handle.copy_to_cpu().ravel()
    elapsed = (time.perf_counter() - start) * 1000
    return round(float(values[22]), 4), elapsed

for name, box in crops.items():
    image = bus.crop(box)
    occluded = image.copy()
    ImageDraw.Draw(occluded).rectangle(face_areas[name], fill='black')
    full, full_ms = infer(image)
    hidden, hidden_ms = infer(occluded)
    print(name, {'gender_index_22': full, 'face_hidden_gender_index_22': hidden,
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
        female_probability, _ = infer(Image.open(path).convert('RGB'))
        results.append({'file': path.name, 'actual_female': actual_female,
                        'female_probability': female_probability,
                        'correct': (female_probability >= 0.5) == actual_female})
    print('back_views', json.dumps(results))
    print('back_accuracy', sum(item['correct'] for item in results), '/', len(results))
    print('back_by_label', {label: [sum(item['correct'] for item in results if item['actual_female'] == label),
                                    sum(item['actual_female'] == label for item in results)] for label in [False, True]})
