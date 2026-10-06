// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import assert from 'node:assert/strict';
// Supply a JSON map of original source paths to source text for a comparison.
const paths = JSON.parse(await readFile(process.argv[2] ?? '.cache/performance-2026-10-04/perf-baseline-sources.json', 'utf8'));
async function load(source, dilate) {
  const compiled = await transform(source.replace(/^import .*;\r?$/gm, ''), { loader: 'ts', format: 'cjs' });
  const module = { exports: {} };
  new Function('exports', 'module', 'dilate', compiled.code)(module.exports, module, dilate);
  return module.exports;
}
const before = await load(paths['src/rendering/compositor.ts']);
const after = await load(await readFile('src/rendering/compositor.ts', 'utf8'));
before.videoPersonMask = (await load(paths['src/rendering/videoMask.ts'], before.dilate)).videoPersonMask;
after.videoPersonMask = (await load(await readFile('src/rendering/videoMask.ts', 'utf8'), after.dilate)).videoPersonMask;
let seed = 7391;
const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);
for (const size of [256, 320, 416]) {
  const fixtures = [new Uint8Array(size * size), new Uint8Array(size * size).fill(255),
    Uint8Array.from({ length: size * size }, () => random() < .12 ? 255 : 0),
    Uint8Array.from({ length: size * size }, (_, p) => {
      const x = p % size, y = Math.floor(p / size);
      return (x > size * .2 && x < size * .7 && y > size * .1 && y < size * .9) ? 255 : 0;
    })];
  for (const source of fixtures) {
    assert.deepEqual(after.pruneIslands(source, size, size), before.pruneIslands(source, size, size));
    for (const radius of [0, 1, 4, 24]) assert.deepEqual(after.dilate(source, size, size, radius), before.dilate(source, size, size, radius));
  }
  for (const operation of ['pruneIslands', 'dilate', 'videoPersonMask']) {
    const inputs = operation === 'videoPersonMask' ? fixtures.map(fixture => Float32Array.from(fixture, value => value / 255)) : fixtures;
    if (operation === 'videoPersonMask') for (const source of inputs)
      assert.deepEqual(after.videoPersonMask(source, size, 4), before.videoPersonMask(source, size, 4));
    const times = { before: [], after: [] };
    const measure = implementation => {
      const start = performance.now();
      for (let repeat = 0; repeat < 30; repeat++) for (const fixture of inputs)
        operation === 'videoPersonMask' ? implementation[operation](fixture, size, 4) : implementation[operation](fixture, size, size, 4);
      return performance.now() - start;
    };
    measure(before); measure(after);
    for (let trial = 0; trial < 7; trial++) {
      for (const name of trial % 2 ? ['after', 'before'] : ['before', 'after']) times[name].push(measure(name === 'before' ? before : after));
    }
    const median = list => list.sort((a, b) => a - b)[Math.floor(list.length / 2)];
    const a = median(times.before), b = median(times.after);
    console.log(JSON.stringify({ size, operation, beforeMs: +a.toFixed(2), afterMs: +b.toFixed(2), speedup: +(a / b).toFixed(2) }));
  }
}
