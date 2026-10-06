import { FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision';

window.runProbe = async ({ base64, delegate, count }) => {
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const canvas = new OffscreenCanvas(256, 256);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, 256, 256);
  bitmap.close();
  const files = await FilesetResolver.forVisionTasks('/node_modules/@mediapipe/tasks-vision/wasm');
  const start = performance.now();
  const detector = await ObjectDetector.createFromOptions(files, {
    baseOptions: { modelAssetPath: '/experiments/ssd-prototype/ssd_mobilenet_v2.tflite', delegate },
    runningMode: 'IMAGE', categoryAllowlist: ['person'], scoreThreshold: 0.1,
  });
  const initializedMs = performance.now() - start;
  const timings = [];
  let detections = [];
  for (let i = 0; i < count + 3; i++) {
    const at = performance.now();
    detections = detector.detect(canvas).detections;
    if (i >= 3) timings.push(performance.now() - at);
  }
  detector.close();
  return { initializedMs, timings, detections: detections.map(item => ({
    box: item.boundingBox, category: item.categories[0]?.categoryName, score: item.categories[0]?.score,
  })) };
};
