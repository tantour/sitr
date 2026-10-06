// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
/// <reference lib="webworker" />
import { FrameMotionEngine, type MotionAnchor } from './frameMotion';

type Input =
  | { type: 'frame'; frame: ImageBitmap; at: number; generation: number; maskIds: string[] }
  | { type: 'align'; anchor: MotionAnchor; generation: number }
  | { type: 'reset'; generation: number };

const engine = new FrameMotionEngine();
postMessage({ type: 'ready' });
let generation = 0;
self.onmessage = (event: MessageEvent<Input>) => {
  const message = event.data;
  if (message.generation !== generation) {
    if (message.type === 'frame') message.frame.close();
    if (message.type === 'reset' && message.generation > generation) { generation = message.generation; engine.reset(); }
    return;
  }
  if (message.type === 'reset') { engine.reset(); return; }
  if (message.type === 'align') {
    engine.align(message.anchor);
    postMessage({ type: 'motion', source: 'align', generation, cut: false, at: engine.lastObservedAt, frames: engine.frames,
      sequence: engine.alignedSequence, reliable: engine.reliable(message.anchor.maskIds), reliableIds: engine.reliableIds(), offsets: [...engine.offsets()] });
    return;
  }
  const started = performance.now();
  const cut = engine.observe(message.frame, message.at);
  postMessage({ type: 'motion', source: 'frame', generation, cut, at: engine.lastObservedAt, frames: engine.frames,
    sequence: engine.alignedSequence, reliable: engine.reliable(message.maskIds), reliableIds: engine.reliableIds(), offsets: [...engine.offsets()],
    processingMs: performance.now() - started });
};
