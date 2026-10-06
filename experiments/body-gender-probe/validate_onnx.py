"""Check converted ONNX models against the 40 labeled back-view crops."""
import os
import statistics
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

root = Path(__file__).resolve().parent
sample_dir = Path(os.environ['BODY_BACK_SAMPLES'])
options = ort.SessionOptions()
options.intra_op_num_threads = 2
options.inter_op_num_threads = 1

for model_name in ('intel-body', 'paddle-body'):
    session = ort.InferenceSession(str(root / f'{model_name}.onnx'), sess_options=options,
                                   providers=['CPUExecutionProvider'])
    input_name = session.get_inputs()[0].name
    output_name = next(name for name in [output.name for output in session.get_outputs()]
                       if name.startswith('453') or name.startswith('sigmoid'))
    rows = []
    for path in sorted(sample_dir.glob('*.jpg')):
        image = Image.open(path).convert('RGB')
        if model_name == 'intel-body':
            pixels = np.asarray(image.resize((80, 160), Image.Resampling.BILINEAR), dtype=np.float32)
            blob = pixels[:, :, ::-1].transpose(2, 0, 1)[None].copy()
        else:
            pixels = np.asarray(image.resize((192, 256), Image.Resampling.BILINEAR), dtype=np.float32) / 255
            pixels = (pixels - np.array([.485, .456, .406], dtype=np.float32)) / np.array([.229, .224, .225], dtype=np.float32)
            blob = pixels.transpose(2, 0, 1)[None].copy()
        start = time.perf_counter()
        output = session.run([output_name], {input_name: blob})[0].ravel()
        milliseconds = (time.perf_counter() - start) * 1000
        female_probability = 1 - float(output[0]) if model_name == 'intel-body' else float(output[22])
        actual_female = path.stem.endswith('female')
        rows.append((path.name, female_probability, actual_female, milliseconds))
    print(model_name, 'correct', sum((probability >= .5) == label for _, probability, label, _ in rows),
          'of', len(rows), 'median_run_ms', round(statistics.median(row[3] for row in rows), 2))
    print(model_name, 'first', [(name, round(probability, 4)) for name, probability, _, _ in rows[:5]])
