// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import * as ort from 'onnxruntime-web/webgpu';

export { ort };
export type OnnxBackend = 'wasm' | 'webgpu';

export async function createOnnxSession(model: string, backend: OnnxBackend, threads?: number): Promise<{ session: ort.InferenceSession; backend: OnnxBackend }> {
  ort.env.wasm.wasmPaths = `${self.location.origin}/wasm/`;
  ort.env.wasm.numThreads = threads ?? (self.crossOriginIsolated
    ? Math.min(4, Math.max(2, Math.floor(navigator.hardwareConcurrency / 4))) : 1);
  if (backend === 'webgpu' && 'gpu' in navigator) {
    try {
      const session = await ort.InferenceSession.create(model, { executionProviders: ['webgpu', 'wasm'], graphOptimizationLevel: 'all' });
      return { session, backend: 'webgpu' };
    } catch (error) {
      console.warn('WebGPU ONNX session unavailable, using WASM:', error);
    }
  }
  const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  return { session, backend: 'wasm' };
}
