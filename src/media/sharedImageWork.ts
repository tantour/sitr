// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
/** Page-local single-flight cache. Pending duplicates share a promise; failed
 * work is removed so a later attempt can recover. Only settled entries count
 * toward the budget, and clearing never cancels work another image is awaiting. */
export class SharedImageWork<T> {
  private entries = new Map<string, { promise: Promise<T>; bytes: number }>();
  private bytes = 0;

  constructor(private readonly budget: number, private readonly sizeOf: (value: T) => number,
    private readonly release: (value: T) => void) {}

  get(key: string, produce: () => Promise<T>): { promise: Promise<T>; reused: boolean } {
    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      return { promise: existing.promise, reused: true };
    }
    const entry = { promise: undefined as unknown as Promise<T>, bytes: 0 };
    entry.promise = Promise.resolve().then(produce).then(value => {
      if (this.entries.get(key) !== entry) { this.release(value); return value; }
      entry.bytes = this.sizeOf(value);
      this.bytes += entry.bytes;
      for (const [oldKey, old] of this.entries) {
        if (this.bytes <= this.budget) break;
        // Keep the just-completed value alive until its consumers can adopt it.
        if (old === entry || !old.bytes) continue;
        this.remove(oldKey);
      }
      return value;
    }, error => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, entry);
    return { promise: entry.promise, reused: false };
  }

  remove(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
    // Pending work releases itself when it settles.
    if (entry.bytes) void entry.promise.then(this.release);
  }

  clear(): void { for (const key of this.entries.keys()) this.remove(key); }
}
