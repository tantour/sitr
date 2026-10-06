import * as ort from 'onnxruntime-web/webgpu';

window.runDetectProbe = async ({ base64, count }) => {
  ort.env.wasm.wasmPaths = '/node_modules/onnxruntime-web/dist/';
  ort.env.webgpu.powerPreference = 'high-performance';
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const canvas = new OffscreenCanvas(256, 256);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, 256, 256);
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, 256, 256).data;
  const input = new Float32Array(3 * 256 * 256);
  for (let i = 0; i < 256 * 256; i++) {
    input[i] = rgba[i * 4] / 255;
    input[i + 256 * 256] = rgba[i * 4 + 1] / 255;
    input[i + 2 * 256 * 256] = rgba[i * 4 + 2] / 255;
  }
  const session = await ort.InferenceSession.create('/experiments/ssd-prototype/yolo26n-gpu.onnx', {
    executionProviders: ['webgpu'], enableGraphCapture: true, graphOptimizationLevel: 'all',
  });
  const device = await ort.env.webgpu.device;
  const gpuBuffer = device.createBuffer({ size: input.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const tensor = ort.Tensor.fromGpuBuffer(gpuBuffer, { dataType: 'float32', dims: [1, 3, 256, 256] });
  const timings = [];
  let output;
  for (let i = 0; i < count + 3; i++) {
    const start = performance.now();
    device.queue.writeBuffer(gpuBuffer, 0, input);
    const results = await session.run({ images: tensor });
    output = await results['/model.23/Transpose_output_0'].getData();
    if (i >= 3) timings.push(performance.now() - start);
    for (const item of Object.values(results)) item.dispose();
  }
  const candidates = [];
  for (let i = 0; i < output.length / 84; i++) {
    const score = output[i * 84 + 4];
    if (score > .1) candidates.push({ box: Array.from(output.slice(i * 84, i * 84 + 4)), score });
  }
  candidates.sort((a, b) => b.score - a.score);
  tensor.dispose();
  gpuBuffer.destroy();
  await session.release();
  return { timings, candidates: candidates.slice(0, 10) };
};
