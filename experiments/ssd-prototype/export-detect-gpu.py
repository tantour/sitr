from pathlib import Path
import onnx
import onnxruntime as ort

root = Path(__file__).resolve().parent
source = root / 'yolo26n.onnx'
raw = root / 'yolo26n-raw.onnx'
target = root / 'yolo26n-gpu.onnx'
onnx.utils.extract_model(str(source), str(raw), ['images'], ['/model.23/Transpose_output_0'])
options = ort.SessionOptions()
options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
options.optimized_model_filepath = str(target)
options.intra_op_num_threads = 2
session = ort.InferenceSession(str(raw), options, providers=['CPUExecutionProvider'])
print('input', [(item.name, item.shape) for item in session.get_inputs()])
print('output', [(item.name, item.shape) for item in session.get_outputs()])
onnx.checker.check_model(str(target))
