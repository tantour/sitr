// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
const identities = new WeakMap<object, number>();
let nextIdentity = 0;
function identity(value: object): number {
  let id = identities.get(value);
  if (id === undefined) { id = ++nextIdentity; identities.set(value, id); }
  return id;
}

function stream(video: HTMLVideoElement): MediaStream | undefined {
  const source = video.srcObject;
  // Avoid instanceof: incoming streams can belong to another JavaScript realm.
  return source && 'getVideoTracks' in source ? source as MediaStream : undefined;
}

/** srcObject assignments and track replacements do not mutate DOM attributes. */
export function videoSourceKey(video: HTMLVideoElement): string {
  if (video.srcObject) {
    return JSON.stringify(['object', identity(video.srcObject), stream(video)?.getVideoTracks()
      .map(track => `${identity(track)}:${track.readyState}`).sort()]);
  }
  return video.currentSrc || video.src || video.querySelector('source')?.src || '';
}

export function videoHasLiveSource(video: HTMLVideoElement): boolean {
  const source = stream(video);
  return source ? source.getVideoTracks().some(track => track.readyState === 'live')
    : Boolean(video.srcObject || video.currentSrc || video.src || video.querySelector('source')?.src);
}
