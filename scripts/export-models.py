from pathlib import Path
import shutil
import os
config_root = Path(__file__).resolve().parents[1] / '.cache'
config_root.mkdir(parents=True, exist_ok=True)
os.environ['YOLO_CONFIG_DIR'] = str(config_root)
from ultralytics import YOLO
import onnx

root = Path(__file__).resolve().parents[1]
source = root / 'models' / 'yolo26n-seg.pt'
if not source.exists():
    raise SystemExit('Run scripts/download-models.ps1 first')
for size in (256, 320, 416):
    destination = root / 'models' / f'yolo26n-seg-{size}.onnx'
    if not destination.exists():
        exported = Path(YOLO(str(source)).export(format='onnx', imgsz=size, batch=1, dynamic=False, nms=False, simplify=False, opset=17))
        shutil.move(str(exported), str(destination))
    graph = onnx.load(str(destination))
    onnx.checker.check_model(graph)
    input_dims = [d.dim_value for d in graph.graph.input[0].type.tensor_type.shape.dim]
    outputs = [[d.dim_value for d in node.type.tensor_type.shape.dim] for node in graph.graph.output]
    print(f'{destination.name}: input={input_dims}, output={outputs}')
    if input_dims != [1, 3, size, size] or len(outputs) < 2 or outputs[0][-1] != 38:
        raise SystemExit(f'Unexpected export contract: {destination.name}')
