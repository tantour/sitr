// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import { expect, it } from 'vitest';
import { imageLookAheadPx, imageWorkRange } from '../src/media/imageWorkRange';

function rect(top: number, left = 0, width = 100, height = 100) {
  return { top, left, width, height, bottom: top + height, right: left + width };
}
it('prioritizes images overlapping the current screen', () => {
  expect(imageWorkRange(rect(-50), 900, 700)).toBe('visible');
  expect(imageWorkRange(rect(699), 900, 700)).toBe('visible');
});
it('allows only two screens below, with a 2400px look-ahead cap', () => {
  expect(imageWorkRange(rect(700), 900, 700)).toBe('ahead');
  expect(imageWorkRange(rect(2099), 900, 700)).toBe('ahead');
  expect(imageWorkRange(rect(2100), 900, 700)).toBeUndefined();
  expect(imageLookAheadPx(2000)).toBe(2400);
});
it('ignores images above, to the side, or with no layout box', () => {
  expect(imageWorkRange(rect(-100), 900, 700)).toBeUndefined();
  expect(imageWorkRange(rect(800, 900), 900, 700)).toBeUndefined();
  expect(imageWorkRange(rect(800, -100), 900, 700)).toBeUndefined();
  expect(imageWorkRange(rect(800, 0, 0), 900, 700)).toBeUndefined();
  expect(imageWorkRange(rect(800, 0, 100, 0), 900, 700)).toBeUndefined();
});
