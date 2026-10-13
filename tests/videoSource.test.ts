// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { expect, it, vi } from 'vitest';
import { videoHasLiveSource, videoSourceKey } from '../src/media/videoSource';
import { recoverVideoCors, videoNeedsCors } from '../src/media/videoCors';

it('retires a source when a tile receives a new stream or video track', () => {
  const track = { readyState: 'live' }, audio = {};
  let tracks = [track];
  const source = { getVideoTracks: () => tracks, audio };
  const video = { srcObject: source } as unknown as HTMLVideoElement;
  const first = videoSourceKey(video);
  expect(videoSourceKey(video)).toBe(first);
  source.audio = {};
  expect(videoSourceKey(video)).toBe(first);
  tracks = [{ readyState: 'live' }];
  expect(videoSourceKey(video)).not.toBe(first);
  const next = videoSourceKey(video);
  tracks[0].readyState = 'ended';
  expect(videoSourceKey(video)).not.toBe(next);
  expect(videoHasLiveSource(video)).toBe(false);
  tracks = [];
  expect(videoHasLiveSource(video)).toBe(false);
  tracks = [track];
  expect(videoHasLiveSource(video)).toBe(true);
  video.srcObject = { getVideoTracks: () => tracks } as unknown as MediaStream;
  expect(videoSourceKey(video)).not.toBe(first);
});

it('keeps URL video identity and never reloads an attached stream for CORS', async () => {
  const video = { srcObject: null, currentSrc: 'https://cdn.example/clip', src: '', querySelector: () => null,
    crossOrigin: null, load: vi.fn() } as unknown as HTMLVideoElement;
  vi.stubGlobal('location', { origin: 'https://meet.google.com' });
  try {
    expect(videoSourceKey(video)).toBe(video.currentSrc);
    expect(videoNeedsCors(video)).toBe(true);
    video.srcObject = { getVideoTracks: () => [{ readyState: 'live' }] } as unknown as MediaStream;
    expect(videoNeedsCors(video)).toBe(false);
    expect(await recoverVideoCors(video, new AbortController().signal, () => true)).toBe(false);
    expect(video.load).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});
