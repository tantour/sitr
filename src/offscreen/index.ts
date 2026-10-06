// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { ENGINE, resolveOnnxThreads, type Settings, type Label } from '../config/settings';
import type { FrameKey, FramePacket, WorkerInput, WorkerOutput } from '../state/contracts';

let worker: Worker | undefined;
let workerReady = false;
let workerFailure = '';
let forceCpuSemantic = false;
let onnxBackend: 'wasm' | 'webgpu' = 'webgpu';
let onnxThreads = resolveOnnxThreads('auto', navigator.hardwareConcurrency);
let parallelSemantic = false;
const completedSizes = new Set<number>();
let busy = false;
let activeReply: ((value: unknown) => void) | undefined;
let activeKey: FrameKey | undefined;
let activeKind: 'analyze' | 'control' | undefined;
let activeQueueWaitMs = 0;
let activeTimeout: number | undefined;
let activeDispatchId = 0;
let consecutiveVideos = 0;
let queued = new Map<string, Job>();
const owners = new Map<string, { tabId: number; frameId: number; documentId?: string; epoch: number }>();
let restarts: number[] = [];
let restartTimer: number | undefined;
let pendingWarm: { size: number; kind: 'image' | 'video'; detector: 'segment' | 'fast-box'; semantic: boolean; faces: boolean; gender: boolean } | undefined;

type Request =
  | { type: 'analyze'; frame: FramePacket; settings: Settings }
  | { type: 'reuse-image'; key: FrameKey; fromKey: FrameKey; settings: Settings }
  | { type: 'reevaluate'; key: FrameKey; settings: Settings }
  | { type: 'label-track'; key: FrameKey; trackId: string; label: Label; settings: Settings }
  | { type: 'prepare-engine'; size: number; kind: 'image' | 'video'; detector: 'segment' | 'fast-box'; semantic: boolean; faces: boolean; gender: boolean; threads: number }
  | { type: 'reset-session'; mediaSessionId: string; epoch: number };
type Job = { request: Exclude<Request, { type: 'reset-session' } | { type: 'prepare-engine' }>; key: FrameKey; reply: (value: unknown) => void; enqueuedAt: number };

function sameKey(a: FrameKey | undefined, b: FrameKey): boolean {
  return !!a && a.mediaSessionId === b.mediaSessionId && a.epoch === b.epoch && a.sequence === b.sequence;
}
function matchingResult(key: FrameKey | undefined, result: FrameKey): boolean {
  return !!key && key.mediaSessionId === result.mediaSessionId && key.epoch === result.epoch &&
    (activeKind === 'control' ? result.sequence >= key.sequence : result.sequence === key.sequence);
}
function failActive(message: string): void {
  if (activeTimeout !== undefined) clearTimeout(activeTimeout);
  activeTimeout = undefined;
  activeReply?.({ ok: false, error: message });
  activeReply = undefined;
  activeKey = undefined;
  activeKind = undefined;
  busy = false;
  scheduleNext();
}
function scheduleNext(): void {
  if (!busy && workerReady && worker && queued.size === 0 && pendingWarm) {
    worker.postMessage({ type: 'warm', ...pendingWarm } satisfies WorkerInput);
    pendingWarm = undefined;
  }
  if (busy || !workerReady || !worker || queued.size === 0) return;
  const jobs = [...queued.values()].sort((a, b) => {
    const priority = (job: Job) => job.request.type !== 'analyze' ? 3
      : job.request.frame.kind === 'video' ? consecutiveVideos >= 3 ? 0 : 2 : 1;
    return priority(b) - priority(a) || a.enqueuedAt - b.enqueuedAt;
  });
  for (const job of jobs) {
    queued.delete(job.key.mediaSessionId);
    const owner = owners.get(job.key.mediaSessionId);
    if (!owner || owner.epoch !== job.key.epoch) { job.reply({ ok: false, error: 'stale-session' }); continue; }
    if (job.request.type === 'analyze' && job.request.frame.kind === 'video' && !job.request.frame.paused &&
        Date.now() - job.request.frame.capturedAtMs > (job.request.settings.videoPlayback === 'smooth' ? 2000 : ENGINE.maxResultAgeMs)) {
      job.reply({ ok: false, error: 'stale' });
      continue;
    }
    run(job);
    return;
  }
}
function run(job: Job): void {
  if (!worker) { job.reply({ ok: false, error: 'not-ready' }); return; }
  busy = true;
  activeKey = job.key;
  activeKind = job.request.type === 'analyze' ? 'analyze' : 'control';
  activeReply = job.reply;
  activeQueueWaitMs = Date.now() - job.enqueuedAt;
  const dispatchId = ++activeDispatchId;
  let input: WorkerInput;
  if (job.request.type === 'analyze') input = { type: 'analyze', frame: job.request.frame, settings: job.request.settings };
  else if (job.request.type === 'reuse-image') input = { type: 'reuse-image', key: job.key, fromKey: job.request.fromKey, settings: job.request.settings };
  else if (job.request.type === 'reevaluate') input = { type: 'settings', key: job.key, settings: job.request.settings };
  else input = { type: 'label', key: job.key, trackId: job.request.trackId, label: job.request.label, settings: job.request.settings };
  try {
    if (job.request.type === 'analyze') {
      const transfers = [job.request.frame.rgba.buffer];
      if (job.request.frame.faceRgba) transfers.push(job.request.frame.faceRgba.buffer);
      worker.postMessage(input, transfers);
    }
    else worker.postMessage(input);
  } catch (error) { failActive(error instanceof Error ? error.message : String(error)); return; }
  activeTimeout = self.setTimeout(() => {
    if (activeDispatchId === dispatchId && sameKey(activeKey, job.key)) {
      restartEngine('Analysis timed out');
    }
  // Each resolution compiles its own GPU graph, including a video's first size
  // after an image has completed. Keep the short watchdog for warmed sessions.
  }, job.request.type === 'analyze' && !completedSizes.has(job.request.frame.width) ? 45000 : 8000);
}
function restartEngine(reason: string, semanticFailure = false): void {
  worker?.terminate(); worker = undefined; workerReady = false;
  workerFailure = reason;
  if (semanticFailure) forceCpuSemantic = true;
  else if (onnxBackend === 'webgpu') onnxBackend = 'wasm';
  completedSizes.clear();
  failActive('backend-retry');
  const now = Date.now();
  restarts = restarts.filter(time => now - time < 300000);
  if (restarts.length >= 2) {
    workerFailure = 'Engine unavailable after two restarts';
    for (const job of queued.values()) job.reply({ ok: false, error: 'engine-unavailable' });
    queued.clear();
    return;
  }
  restarts.push(now);
  restartTimer = self.setTimeout(() => { restartTimer = undefined; startWorker(); }, 1000 * restarts.length);
}
function queue(job: Job): void {
  const prior = queued.get(job.key.mediaSessionId);
  if (prior?.request.type === 'analyze' && job.request.type !== 'analyze') {
    job.reply({ ok: false, error: 'pending-analysis' });
    return;
  }
  if (prior) prior.reply({ ok: false, error: 'replaced' });
  else if (queued.size >= 8) {
    const oldestImage = [...queued.values()].filter(item => item.request.type === 'analyze' && item.request.frame.kind === 'image')
      .sort((a, b) => a.enqueuedAt - b.enqueuedAt)[0];
    if (!oldestImage) { job.reply({ ok: false, error: 'capacity' }); return; }
    queued.delete(oldestImage.key.mediaSessionId);
    oldestImage.reply({ ok: false, error: 'replaced' });
  }
  queued.set(job.key.mediaSessionId, job);
}
function startWorker(): void {
  worker?.terminate();
  completedSizes.clear();
  workerReady = false;
  workerFailure = '';
  worker = new Worker(chrome.runtime.getURL('worker.js'));
  worker.onmessage = (event: MessageEvent<WorkerOutput>) => {
    const output = event.data;
    if (output.type === 'ready') {
      worker?.postMessage({ type: 'backend', semantic: forceCpuSemantic ? 'cpu' : 'auto', onnx: onnxBackend,
        threads: onnxThreads, parallelSemantic } satisfies WorkerInput);
      workerReady = true; workerFailure = ''; scheduleNext(); return;
    }
    if (output.type === 'result' && matchingResult(activeKey, output.result.key)) {
      if (output.result.timingsMs) output.result.timingsMs.queue = activeQueueWaitMs;
      completedSizes.add(output.result.width);
      if (activeKind === 'analyze') {
        if (output.result.mediaTimeSec === undefined) consecutiveVideos = 0;
        else consecutiveVideos++;
      }
      if (activeTimeout !== undefined) clearTimeout(activeTimeout);
      activeTimeout = undefined;
      activeReply?.({ ok: true, result: output.result });
      activeReply = undefined; activeKey = undefined; activeKind = undefined; busy = false;
      scheduleNext();
    } else if (output.type === 'error' && (!output.key || sameKey(activeKey, output.key))) {
      if (activeKind === 'analyze') restartEngine(output.message, output.stage === 'semantic');
      else failActive(output.message);
    }
  };
  worker.onerror = event => {
    restartEngine(`${event.message || 'Vision worker crashed'} at ${event.lineno}:${event.colno}`);
  };
  worker.onmessageerror = () => restartEngine('Vision worker message error');
}
startWorker();

chrome.runtime.onMessage.addListener((request: Request, sender, reply) => {
  if ((request as { type?: string })?.type === 'retry-engine' && sender.id === chrome.runtime.id && !sender.tab) {
    const requestedBackend = (request as { backend?: string }).backend;
    if (requestedBackend === 'cpu') forceCpuSemantic = true;
    else if (requestedBackend === 'auto') forceCpuSemantic = false;
    else if (requestedBackend === 'wasm' || requestedBackend === 'webgpu') onnxBackend = requestedBackend;
    const requestedThreads = (request as { threads?: number }).threads;
    if (requestedThreads !== undefined && [1, 2, 4, 6, 8, 12, 16].includes(requestedThreads)) onnxThreads = requestedThreads;
    if (typeof (request as { parallelSemantic?: unknown }).parallelSemantic === 'boolean') {
      parallelSemantic = (request as unknown as { parallelSemantic: boolean }).parallelSemantic;
    }
    if (restartTimer !== undefined) { clearTimeout(restartTimer); restartTimer = undefined; }
    restarts = [];
    completedSizes.clear();
    workerFailure = '';
    worker?.terminate(); worker = undefined; workerReady = false;
    failActive('backend-retry');
    startWorker();
    reply({ ok: true });
    return false;
  }
  if (request?.type === 'prepare-engine') {
    if (!sender.tab || ![256, 320, 416].includes(request.size) || !['image', 'video'].includes(request.kind) ||
        !['segment', 'fast-box'].includes(request.detector) || (request.detector === 'fast-box' && (request.kind !== 'video' || request.size !== 256)) || typeof request.faces !== 'boolean' ||
        typeof request.gender !== 'boolean' || ![1, 2, 4, 6, 8, 12, 16].includes(request.threads)) {
      reply({ ok: false, error: 'Invalid warmup request' }); return false;
    }
    if (onnxThreads !== request.threads) {
      onnxThreads = request.threads;
      worker?.terminate(); worker = undefined; workerReady = false;
      failActive('backend-retry');
      startWorker();
    }
    pendingWarm = { size: request.size, kind: request.kind, detector: request.detector,
      semantic: request.semantic, faces: request.faces, gender: request.gender };
    scheduleNext();
    reply({ ok: true }); return false;
  }
  if (!['analyze', 'reuse-image', 'reevaluate', 'label-track', 'reset-session'].includes(request?.type)) return false;
  const tabId = sender.tab?.id;
  const frameId = sender.frameId;
  if (tabId === undefined || frameId === undefined) { reply({ ok: false, error: 'Invalid sender' }); return false; }
  if (request.type === 'reset-session') {
    const owner = owners.get(request.mediaSessionId);
    if (owner?.tabId === tabId && owner.frameId === frameId && owner.epoch <= request.epoch) {
      owners.delete(request.mediaSessionId);
      const pending = queued.get(request.mediaSessionId);
      if (pending && pending.key.epoch <= request.epoch) { pending.reply({ ok: false, error: 'stale-session' }); queued.delete(request.mediaSessionId); }
      worker?.postMessage({ type: 'reset', mediaSessionId: request.mediaSessionId, epoch: request.epoch } satisfies WorkerInput);
    }
    reply({ ok: true }); return false;
  }
  const key = request.type === 'analyze' ? request.frame.key : request.key;
  if (request.type === 'reuse-image') {
    const sourceOwner = owners.get(request.fromKey.mediaSessionId);
    if (!sourceOwner || sourceOwner.tabId !== tabId || sourceOwner.frameId !== frameId ||
        sourceOwner.documentId !== sender.documentId || sourceOwner.epoch !== request.fromKey.epoch) {
      reply({ ok: false, error: 'Cached analysis unavailable' }); return false;
    }
  }
  const owner = owners.get(key.mediaSessionId);
  if (owner && (owner.tabId !== tabId || owner.frameId !== frameId || owner.documentId !== sender.documentId || key.epoch < owner.epoch)) {
    reply({ ok: false, error: 'Media session ownership mismatch' }); return false;
  }
  if (!owner || key.epoch > owner.epoch) owners.set(key.mediaSessionId, { tabId, frameId, documentId: sender.documentId, epoch: key.epoch });
  if (request.type === 'analyze') {
    const { frame } = request;
    if (frame.width !== frame.height || frame.width > 416 || frame.width < 128 || frame.rgba?.byteLength !== frame.width * frame.height * 4 || frame.rgba.byteLength > ENGINE.maxPayloadBytes) {
      reply({ ok: false, error: 'Invalid frame' }); return false;
    }
    if ((frame.faceRgba || frame.faceSize) && (![320, 416, 512, 640].includes(frame.faceSize ?? 0) || frame.faceRgba?.byteLength !== frame.faceSize! * frame.faceSize! * 4 || frame.faceRgba.byteLength > ENGINE.maxFacePayloadBytes)) {
      reply({ ok: false, error: 'Invalid face frame' }); return false;
    }
  }
  if (workerFailure === 'Engine unavailable after two restarts') { reply({ ok: false, error: 'engine-unavailable' }); return false; }
  const job = { request, key, reply, enqueuedAt: Date.now() } as Job;
  if (busy || !workerReady || !worker) queue(job);
  else run(job);
  return true;
});
