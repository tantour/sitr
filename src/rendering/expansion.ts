// SPDX-License-Identifier: AGPL-3.0-only
import type {Rect} from '../state/contracts';
/** Percentage of the person's longest visible dimension, in the analysis grid. */
export function personExpansion(percent:number, side:number, box:Rect):number {
  const width=Math.max(0,Math.min(1,box.x+box.width)-Math.max(0,box.x));
  const height=Math.max(0,Math.min(1,box.y+box.height)-Math.max(0,box.y));
  return Math.max(0,Math.round(Math.max(width,height)*side*Math.max(0,percent)/100));
}
