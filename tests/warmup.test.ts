// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { describe, expect, it } from 'vitest';
import { warmModels, warmupPixels } from '../src/vision/warmup';

describe('model preparation', () => {
  it('uses only neutral opaque synthetic pixels', () => {
    expect([...warmupPixels(2)]).toEqual(Array.from({ length: 4 }, () => [127, 127, 127, 255]).flat());
  });
  it('runs twice serially for compilation and capture, continuing after a failure', async () => {
    const calls: string[] = [];
    const progress: number[] = [];
    const report = await warmModels([
      { name: 'person', run: async () => { calls.push('person'); } },
      { name: 'unavailable', run: async () => { calls.push('failed'); throw new Error('missing'); } },
      { name: 'face', run: async () => { calls.push('face'); } },
    ], value => { expect(value.total).toBe(3); progress.push(value.completed); });
    expect(progress).toEqual([0, 1, 2, 3]);
    expect(calls).toEqual(['person', 'person', 'failed', 'face', 'face']);
    expect(report.models).toEqual(['person', 'face']);
    expect(report.failures).toEqual({ unavailable: 'Error: missing' });
  });
  it('does not report a model ready if its capture run fails', async () => {
    let runs = 0;
    const report = await warmModels([{ name: 'gpu', run: async () => { if (++runs === 2) throw new Error('capture failed'); } }]);
    expect(report.models).toEqual([]);
    expect(report.failures.gpu).toContain('capture failed');
  });
});
