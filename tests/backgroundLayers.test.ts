// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { expect, it } from 'vitest';
import { backgroundLayers, backgroundUrl } from '../src/media/backgroundLayers';

it('keeps commas and escaped quotes within image layers', () => {
  const value = 'linear-gradient(red, blue), url("data:image/png;base64,abc"), url("https://example.com/a\\"b.png")';
  const layers = backgroundLayers(value);
  expect(layers).toHaveLength(3);
  expect(layers.map(backgroundUrl)).toEqual([undefined, 'data:image/png;base64,abc', 'https://example.com/a"b.png']);
});
it('decodes CSS escapes and ignores non-URL layers', () => {
  expect(backgroundUrl('url("https://example.com/\\61 .png")')).toBe('https://example.com/a.png');
  expect(backgroundUrl('url(https://example.com/a.png)')).toBe('https://example.com/a.png');
  expect(backgroundUrl('none')).toBeUndefined();
  expect(backgroundUrl('linear-gradient(black, black)')).toBeUndefined();
});
