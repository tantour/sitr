// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/config/settings';

describe('offscreen startup preparation', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });
  async function host() {
    vi.useFakeTimers();
    const workers: Array<{ postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn>; onmessage?: (event: unknown) => void }> = [];
    let listener: (request: unknown, sender: unknown, reply: (value: unknown) => void) => unknown;
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    vi.stubGlobal('self', { setTimeout, crossOriginIsolated: true });
    vi.stubGlobal('Worker', class {
      postMessage = vi.fn(); terminate = vi.fn();
      constructor() { workers.push(this); }
    });
    // Offscreen Chrome documents expose runtime, but do not expose storage.
    vi.stubGlobal('chrome', { runtime: { id: 'sitr', getURL: (file: string) => file,
      sendMessage: vi.fn().mockResolvedValue({ ...DEFAULT_SETTINGS, onnxThreads: 4 }),
      onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } } });
    await import('../src/offscreen/index');
    await vi.advanceTimersByTimeAsync(0);
    const receive = (type: string, data = {}, index = workers.length - 1) => workers[index].onmessage?.({ data: { type, ...data } });
    return { workers, receive, request: (request: unknown, sender: unknown, reply: (value: unknown) => void) => listener(request, sender, reply) };
  }
  it('queues the first frame until synthetic inference finishes', async () => {
    const { workers, receive, request } = await host();
    expect(workers).toHaveLength(1);
    receive('ready');
    expect(workers[0].postMessage.mock.calls.map(call => call[0].type)).toEqual(['backend', 'warm-all']);
    expect(workers[0].postMessage.mock.calls[0][0].threads).toBe(4);
    const reply = vi.fn();
    request({ type: 'analyze', settings: DEFAULT_SETTINGS, frame: { width: 320, height: 320,
      rgba: new Uint8Array(320 * 320 * 4), kind: 'image', key: { mediaSessionId: 'first', epoch: 1, sequence: 1 } } },
    { tab: { id: 1 }, frameId: 0, documentId: 'page' }, reply);
    expect(reply).not.toHaveBeenCalled();
    expect(workers[0].postMessage).toHaveBeenCalledTimes(2);
    receive('warm-progress', { progress: { completed: 6, total: 15 } });
    const progressStatus = vi.fn();
    request({ type: 'engine-status' }, { id: 'sitr' }, progressStatus);
    expect(progressStatus.mock.calls[0][0].progress).toMatchObject({ completed: 6, total: 15 });
    expect(progressStatus.mock.calls[0][0].ready).toBe(false);
    const tabStatus = vi.fn();
    request({ type: 'engine-status' }, { id: 'sitr', url: 'popup.html#settings', tab: { id: 2 } }, tabStatus);
    expect(tabStatus.mock.calls[0][0].progress.completed).toBe(6);
    const contentStatus = vi.fn();
    request({ type: 'engine-status' }, { id: 'sitr', url: 'https://example.com/', tab: { id: 2 } }, contentStatus);
    expect(contentStatus).not.toHaveBeenCalled();
    receive('warmed', { models: ['segment:320'], failures: {}, elapsedMs: 10 });
    expect(workers[0].postMessage.mock.calls[2][0].type).toBe('analyze');
  });
  it('warms again after restart and ignores the previous worker acknowledgement', async () => {
    const { workers, receive, request } = await host();
    receive('ready');
    request({ type: 'retry-engine', backend: 'wasm' }, { id: 'sitr' }, vi.fn());
    expect(workers[0].terminate).toHaveBeenCalled();
    expect(workers).toHaveLength(2);
    receive('warmed', { models: [], failures: {}, elapsedMs: 0 }, 0);
    const status = vi.fn();
    request({ type: 'engine-status' }, { id: 'sitr' }, status);
    expect(status.mock.calls[0][0].ready).toBe(false);
    receive('ready');
    expect(workers[1].postMessage.mock.calls.map(call => call[0].type)).toEqual(['backend', 'warm-all']);
    receive('warmed', { models: [], failures: {}, elapsedMs: 0 });
    request({ type: 'engine-status' }, { id: 'sitr' }, status);
    expect(status.mock.calls[1][0].ready).toBe(true);
  });
  it('recovers a stalled warmup without accepting cold work', async () => {
    const { workers, receive, request } = await host();
    receive('ready');
    await vi.advanceTimersByTimeAsync(180000);
    expect(workers[0].terminate).toHaveBeenCalled();
    const status = vi.fn();
    request({ type: 'engine-status' }, { id: 'sitr' }, status);
    expect(status.mock.calls[0][0].ready).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(workers).toHaveLength(2);
    receive('ready');
    expect(workers[1].postMessage.mock.calls[0][0].onnx).toBe('wasm');
    expect(workers[1].postMessage.mock.calls[1][0].type).toBe('warm-all');
  });
});
