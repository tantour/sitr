// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors

/** Bound simultaneous captures while giving every visible meeting tile a turn. */
export class VideoWork<T extends object> {
  private readonly active = new Set<T>();
  private readonly lastStarted = new WeakMap<T, number>();
  private sequence = 0;
  constructor(private readonly limit: number) {}

  acquire(target: T, candidates: T[]): (() => void) | undefined {
    if (this.active.has(target) || this.active.size >= this.limit) return;
    const waiting = candidates.filter(candidate => !this.active.has(candidate))
      .sort((a, b) => (this.lastStarted.get(a) ?? 0) - (this.lastStarted.get(b) ?? 0));
    if (!waiting.slice(0, this.limit - this.active.size).includes(target)) return;
    this.lastStarted.set(target, ++this.sequence);
    this.active.add(target);
    return () => { this.active.delete(target); };
  }
}
