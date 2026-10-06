// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
export type ImageWorkRange = 'visible' | 'ahead';
export function imageLookAheadPx(height: number): number { return Math.min(height * 2, 2400); }

/** Keep speculative image work close to the next part of the page. */
export function imageWorkRange(rect: Pick<DOMRectReadOnly, 'width' | 'height' | 'top' | 'bottom' | 'left' | 'right'>,
  width: number, height: number): ImageWorkRange | undefined {
  if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.right <= 0 || rect.left >= width) return;
  if (rect.top < height) return 'visible';
  if (rect.top < height + imageLookAheadPx(height)) return 'ahead';
}
