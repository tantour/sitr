// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { describe, expect, it } from 'vitest';
import { decodeFastPersons } from '../src/vision/fastPerson';

describe('fast person decoder', () => {
  it('keeps person scores and suppresses duplicate boxes', () => {
    const raw = new Float32Array(84 * 3);
    raw.set([10, 20, 80, 180, 0.9], 0);
    raw.set([12, 22, 81, 181, 0.8], 84);
    raw.set([130, 20, 210, 180, 0.7], 168);
    const result = decodeFastPersons(raw, 84, true, 0.1);
    expect(result).toHaveLength(2);
    expect(result[0].score).toBeCloseTo(0.9);
    expect(result[1].score).toBeCloseTo(0.7);
  });
  it('ignores non-person classes in the WASM export', () => {
    const records = new Float32Array([10, 20, 80, 180, 0.9, 1, 10, 20, 80, 180, 0.8, 0]);
    expect(decodeFastPersons(records, 6, false, 0.1)).toHaveLength(1);
  });
});
