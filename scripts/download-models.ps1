$ErrorActionPreference = 'Stop'
$modelRoot = Join-Path (Resolve-Path '.') 'models'
New-Item -ItemType Directory -Force -Path $modelRoot | Out-Null
$sources = @{
  'yolo26n-seg.pt' = 'https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo26n-seg.pt'
  'yolo26n-seg-640.onnx' = 'https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo26n-seg.onnx'
  'selfie_multiclass_256x256.tflite' = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite'
  'yunet-2026may.onnx' = 'https://media.githubusercontent.com/media/opencv/opencv_zoo/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_detection_yunet/face_detection_yunet_2026may.onnx'
  'fastface-large-128.onnx' = 'https://huggingface.co/iFurySt/fastface/resolve/main/models/fastface-large-128/model_fp32.onnx'
}
foreach ($item in $sources.GetEnumerator()) {
  $target = Join-Path $modelRoot $item.Key
  if (-not (Test-Path -LiteralPath $target)) { Invoke-WebRequest -Uri $item.Value -OutFile $target }
  Get-FileHash -Algorithm SHA256 -LiteralPath $target | Select-Object Path,Hash
}
