// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { expect, it, vi } from 'vitest';
import { SharedImageWork } from '../src/media/sharedImageWork';

it('shares pending and completed analysis for the same source and settings', async () => {
  const release = vi.fn();
  const cache = new SharedImageWork<string>(100, value => value.length, release);
  let finish!: (value: string) => void;
  const analyze = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
  const first = cache.get('photo:settings', analyze);
  const second = cache.get('photo:settings', analyze);
  expect(first.reused).toBe(false);
  expect(second.reused).toBe(true);
  expect(second.promise).toBe(first.promise);
  await Promise.resolve();
  expect(analyze).toHaveBeenCalledTimes(1);
  finish('result');
  await expect(second.promise).resolves.toBe('result');
  await expect(cache.get('photo:settings', analyze).promise).resolves.toBe('result');
  expect(analyze).toHaveBeenCalledTimes(1);
  expect(release).not.toHaveBeenCalled();
});

it('does not combine different sources or analysis settings', async () => {
  const cache = new SharedImageWork<string>(100, value => value.length, vi.fn());
  const analyze = vi.fn(async () => 'result');
  await Promise.all(['first:settings', 'second:settings', 'first:changed'].map(key => cache.get(key, analyze).promise));
  expect(analyze).toHaveBeenCalledTimes(3);
});

it('removes a shared failure so both images can retry', async () => {
  const cache = new SharedImageWork<string>(100, value => value.length, vi.fn());
  const analyze = vi.fn(async () => { throw new Error('busy'); });
  const attempts = [cache.get('photo', analyze).promise, cache.get('photo', analyze).promise];
  expect((await Promise.allSettled(attempts)).every(result => result.status === 'rejected')).toBe(true);
  expect(analyze).toHaveBeenCalledTimes(1);
  await expect(cache.get('photo', async () => 'recovered').promise).resolves.toBe('recovered');
});

it('evicts the least recently used completed source and releases its session', async () => {
  const release = vi.fn();
  const cache = new SharedImageWork<string>(4, () => 2, release);
  await cache.get('first', async () => 'first').promise;
  await cache.get('second', async () => 'second').promise;
  await cache.get('first', async () => 'unused').promise;
  await cache.get('third', async () => 'third').promise;
  await Promise.resolve();
  expect(release).toHaveBeenCalledExactlyOnceWith('second');
});

it('explicit retry clears pending work without deleting a newer replacement', async () => {
  const release = vi.fn();
  const cache = new SharedImageWork<string>(100, value => value.length, release);
  let finish!: (value: string) => void;
  const old = cache.get('photo', () => new Promise<string>(resolve => { finish = resolve; })).promise;
  await Promise.resolve();
  cache.clear();
  await cache.get('photo', async () => 'new').promise;
  finish('old');
  await expect(old).resolves.toBe('old');
  expect(release).toHaveBeenCalledExactlyOnceWith('old');
  await expect(cache.get('photo', async () => 'unused').promise).resolves.toBe('new');
});
