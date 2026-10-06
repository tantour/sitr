// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
// Release tooling is plain Node ESM, exercised without downloading real weights.
// @ts-expect-error Standalone build script has no TypeScript declarations.
import { validatedArchive, sha256, manifest } from '../scripts/models.mjs';

describe('release model archive trust boundary', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const artifacts = [{ name: 'sample.onnx', sha256: sha256(bytes) }];
  it('accepts a pinned model and excludes unrelated/traversal entries', () => {
    const archive = zipSync({ 'models/sample.onnx': bytes, '../outside.txt': bytes, 'models/other.onnx': bytes });
    const files = validatedArchive(archive, artifacts);
    expect(Object.keys(files)).toEqual(['models/sample.onnx']);
    expect(files['models/sample.onnx']).toEqual(bytes);
  });
  it('rejects tampered weights before installation', () => {
    expect(() => validatedArchive(zipSync({ 'models/sample.onnx': new Uint8Array([4]) }), artifacts))
      .toThrow('Archive is missing or has an invalid sample.onnx');
  });
  it('rejects partial model bundles', () => {
    expect(() => validatedArchive(zipSync({}), artifacts)).toThrow('sample.onnx');
  });
  it('rejects malformed ZIPs', () => {
    expect(() => validatedArchive(new Uint8Array([0, 1, 2]), artifacts)).toThrow();
  });
  it('has valid hashes and basenames for every shipped model and source input', async () => {
    await expect(manifest()).resolves.toHaveProperty('schemaVersion', 1);
  });
});
