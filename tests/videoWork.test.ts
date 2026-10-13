// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { expect, it } from 'vitest';
import { VideoWork } from '../src/media/videoWork';

it('rotates across all meeting tiles while bounding outstanding captures', () => {
  const work = new VideoWork<object>(2), tiles = [{}, {}, {}, {}];
  const first = work.acquire(tiles[0], tiles)!;
  const second = work.acquire(tiles[1], tiles)!;
  expect(work.acquire(tiles[2], tiles)).toBeUndefined();
  first();
  expect(work.acquire(tiles[0], tiles)).toBeUndefined();
  const third = work.acquire(tiles[2], tiles)!;
  second();
  const fourth = work.acquire(tiles[3], tiles)!;
  expect(work.acquire(tiles[0], tiles)).toBeUndefined();
  third(); fourth();
  expect(work.acquire(tiles[0], tiles)).toBeTypeOf('function');
});

it('does not reserve turns for hidden, paused or removed tiles', () => {
  const work = new VideoWork<object>(2), tiles = [{}, {}, {}, {}];
  const release = work.acquire(tiles[3], [tiles[3]])!;
  expect(release).toBeTypeOf('function');
  expect(work.acquire(tiles[3], [tiles[3]])).toBeUndefined();
  release(); release();
  expect(work.acquire(tiles[0], [tiles[0]])).toBeTypeOf('function');
});
