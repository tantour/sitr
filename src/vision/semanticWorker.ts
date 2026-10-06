// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
/// <reference lib="webworker" />
import { SelfieSemanticSegmenter } from './semantic';

let segmenter: SelfieSemanticSegmenter | undefined;
self.onmessage = async (event: MessageEvent<
  | { type: 'initialize'; preference: 'auto' | 'cpu' }
  | { type: 'segment'; id: number; rgba: Uint8Array; size: number }
>) => {
  const request = event.data;
  try {
    if (request.type === 'initialize') {
      const model = new SelfieSemanticSegmenter(request.preference === 'auto');
      await model.initialize();
      segmenter = model;
      postMessage({ type: 'ready', backend: model.getBackend() });
      return;
    }
    if (!segmenter) throw new Error('Semantic worker is not initialized');
    const categories = segmenter.segment(request.rgba, request.size);
    postMessage({ type: 'result', id: request.id, categories }, [categories.buffer]);
  } catch (error) {
    postMessage({ type: 'error', id: request.type === 'segment' ? request.id : undefined,
      message: error instanceof Error ? error.message : String(error) });
  }
};
