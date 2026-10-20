// SPDX-License-Identifier: AGPL-3.0-only
import { regionOwner, type PelvisEstimate, type RegionPerson } from './pelvis';

/** Chest/belly share a cut perpendicular to each person's shoulder-to-hip
 * axis. Dense anatomy supplies a fallback for missing pose landmarks. */
export function torsoAxes(labels: Uint8Array, grid: number, people: readonly RegionPerson[],
  pelvis: Array<PelvisEstimate | undefined>): Array<PelvisEstimate | undefined> {
  const points = people.map(() => ({ torso: [] as number[][], head: [] as number[][], legs: [] as number[][] }));
  for (let p = 0; p < labels.length; p++) {
    const label = labels[p];
    if (!label) continue;
    const x = p % grid / (grid - 1), y = Math.floor(p / grid) / (grid - 1);
    const owner = regionOwner(people, x, y);
    if (owner < 0) continue;
    if (label === 13 || label === 14) points[owner].torso.push([x, y]);
    else if (label <= 2) points[owner].head.push([x, y]);
    else if (label >= 15 && label <= 18) points[owner].legs.push([x, y]);
  }
  return points.map(({ torso, head, legs }, index) => {
    if (pelvis[index]) return pelvis[index];
    if (torso.length < 4 || (!head.length && !legs.length)) return;
    const mean = (ps: number[][]) => ps.reduce((a, p) => [a[0] + p[0] / ps.length, a[1] + p[1] / ps.length], [0, 0]);
    const center = mean(torso), hint = mean(legs.length ? legs : head);
    let dx = (hint[0] - center[0]) * (legs.length ? 1 : -1), dy = (hint[1] - center[1]) * (legs.length ? 1 : -1);
    const length = Math.hypot(dx, dy);
    if (length < 1 / (grid - 1)) return;
    dx /= length; dy /= length;
    let xx = 0, xy = 0, yy = 0;
    for (const [x, y] of torso) { const px = x - center[0], py = y - center[1]; xx += px * px; xy += px * py; yy += py * py; }
    const spread = Math.hypot(xx - yy, 2 * xy);
    if (xx + yy + spread > 1.5 * (xx + yy - spread)) {
      const angle = .5 * Math.atan2(2 * xy, xx - yy), ax = Math.cos(angle), ay = Math.sin(angle);
      const alignment = ax * dx + ay * dy;
      if (Math.abs(alignment) >= .35) { dx = ax * Math.sign(alignment); dy = ay * Math.sign(alignment); }
    }
    const along = torso.map(([x, y]) => (x - center[0]) * dx + (y - center[1]) * dy);
    const top = Math.min(...along), height = Math.max(...along) - top;
    if (height < 1 / (grid - 1)) return;
    return { origin: { x: center[0] + top * dx, y: center[1] + top * dy }, down: { x: dx, y: dy }, height, width: 0 };
  });
}

export function splitTorso(x: number, y: number, axis?: PelvisEstimate): number {
  if (!axis) return 1; // Unresolved anatomy keeps the saved torso fallback.
  return (x - axis.origin.x) * axis.down.x + (y - axis.origin.y) * axis.down.y < axis.height * .5 ? 10 : 11;
}
