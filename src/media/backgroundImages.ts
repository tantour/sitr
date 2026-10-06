// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
import type { AnalysisResult } from '../state/contracts';
import { backgroundLayers, backgroundUrl } from './backgroundLayers';
import { renderBackground } from '../rendering/background';

export interface BackgroundSurface {
  element: HTMLElement;
  protect(): void;
  release(): void;
  source(blob: Blob): void;
  accept(result: AnalysisResult): void;
}
type Controller = { dispose(): void };
type Layer = { source: string; image: HTMLImageElement; controller?: Controller; blob?: Blob;
  output?: string; generation: number; active: boolean; ready: boolean };
type Background = { element: HTMLElement; original: string; priority: string; applied?: string;
  layers: string[]; slots: Map<number, Layer> };

/** Discover CSS URL layers in bounded batches; preserve all CSS layout properties. */
export class BackgroundImages {
  private records = new Map<HTMLElement, Background>();
  private pending = new Set<HTMLElement>();
  private scheduled = false;
  private editing = false;
  private observer = new MutationObserver(records => this.mutations(records));
  private options: MutationObserverInit = { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['class', 'style'] };

  constructor(private enabled: () => boolean,
    private create: (image: HTMLImageElement, surface: BackgroundSurface) => Controller) {
    this.observer.observe(document, this.options);
    document.addEventListener('load', event => {
      if (event.target instanceof HTMLLinkElement) this.refresh();
    }, true);
    window.addEventListener('resize', () => this.refresh());
    document.addEventListener('DOMContentLoaded', () => this.refresh(), { once: true });
    this.refresh();
  }
  refresh(): void {
    if (!this.enabled()) {
      this.pending.clear();
      this.edit(() => { for (const record of [...this.records.values()]) this.remove(record); });
      return;
    }
    this.enqueue(document.documentElement);
  }
  private enqueue(root: Node | null): void {
    if (!this.enabled() || !root) return;
    if (root instanceof HTMLElement) this.pending.add(root);
    if (root instanceof Element) for (const element of Array.from(root.querySelectorAll<HTMLElement>('*')))
      if (element instanceof HTMLElement) this.pending.add(element);
    if (!this.scheduled && this.pending.size) {
      this.scheduled = true;
      // Finish discovery before the next paint; rAF batches spread initial
      // protection over several visible frames on large image grids.
      queueMicrotask(() => this.scan());
    }
  }
  private mutations(mutations: MutationRecord[]): void {
    for (const mutation of mutations) {
      if (mutation.target instanceof Element && mutation.target.closest('[data-local-media-censor-overlay]')) continue;
      if (mutation.type === 'attributes') this.enqueue(mutation.target);
      else if (mutation.target instanceof HTMLStyleElement || mutation.target.parentElement instanceof HTMLStyleElement) this.refresh();
      else for (const node of Array.from(mutation.addedNodes)) this.enqueue(node);
    }
    for (const record of [...this.records.values()]) if (!record.element.isConnected)
      this.edit(() => this.remove(record));
  }
  private edit(action: () => void): void {
    if (this.editing) { action(); return; }
    const queued = this.observer.takeRecords();
    this.observer.disconnect(); this.editing = true;
    try { action(); }
    finally { this.editing = false; this.observer.observe(document, this.options); }
    if (queued.length) this.mutations(queued);
  }
  private restore(record: Background): void {
    const style = record.element.style;
    // Preserve an author update to the inline background or shorthand.
    if (record.applied !== undefined && style.backgroundImage !== record.applied) {
      record.original = style.backgroundImage;
      record.priority = style.getPropertyPriority('background-image');
    }
    if (record.original) style.setProperty('background-image', record.original, record.priority);
    else style.removeProperty('background-image');
    record.applied = undefined;
  }
  private write(record: Background): void {
    if (!this.enabled()) { this.restore(record); return; }
    const values = record.layers.map((value, index) => {
      const slot = record.slots.get(index);
      return !slot?.active ? value : slot.output ? `url("${slot.output}")` : 'linear-gradient(#000, #000)';
    });
    record.element.style.setProperty('background-image', values.join(', '), 'important');
    record.applied = record.element.style.backgroundImage;
    record.element.dataset.localMediaCensorBackground = [...record.slots.values()].every(slot => slot.ready) ? 'protected' : 'pending';
  }
  private remove(record: Background): void {
    this.records.delete(record.element);
    for (const slot of record.slots.values()) this.drop(slot);
    this.restore(record);
    delete record.element.dataset.localMediaCensorBackground;
  }
  private drop(slot: Layer): void {
    slot.generation++;
    slot.controller?.dispose();
    if (slot.output) URL.revokeObjectURL(slot.output);
  }
  private scan(): void {
    this.scheduled = false;
    if (!this.enabled()) return;
    this.edit(() => {
      const started = performance.now();
      let count = 0;
      for (const element of this.pending) {
        this.pending.delete(element);
        if (element.isConnected && !element.closest('[data-local-media-censor-overlay]') &&
            !['SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'NOSCRIPT'].includes(element.tagName)) {
          let record = this.records.get(element);
          // Never touch unrelated completed backgrounds during discovery.
          // Disable transitions during the author-style read so a computed-style
          // flush cannot start a crossfade through the uncensored source.
          const transitions = ['transition-property', 'transition-duration', 'transition-timing-function',
            'transition-delay', 'transition-behavior'].map(name => ({ name,
            value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name) }));
          if (record) {
            element.style.setProperty('transition', 'none', 'important');
            this.restore(record);
          }
          const layers = backgroundLayers(getComputedStyle(element).backgroundImage);
          const sources = layers.map(backgroundUrl);
          if (!sources.some(Boolean)) { if (record) this.remove(record); }
          else {
            element.style.setProperty('transition', 'none', 'important');
            if (!record) {
              record = { element, original: element.style.backgroundImage,
                priority: element.style.getPropertyPriority('background-image'), layers, slots: new Map() };
              this.records.set(element, record);
            }
            record.layers = layers;
            for (const [index, slot] of record.slots) if (sources[index] !== slot.source) {
              this.drop(slot); record.slots.delete(index);
            }
            sources.forEach((source, index) => {
              if (!source || record!.slots.has(index)) return;
              const slot: Layer = { source, image: new Image(), generation: 0, active: true, ready: false };
              record!.slots.set(index, slot);
              const owner = record!;
              slot.controller = this.create(slot.image, {
                element,
                source: blob => { slot.blob = blob; },
                protect: () => {
                  slot.generation++; slot.active = true; slot.ready = false;
                  if (slot.output) URL.revokeObjectURL(slot.output);
                  slot.output = undefined;
                  this.edit(() => this.write(owner));
                },
                release: () => { slot.active = false; this.edit(() => this.write(owner)); },
                accept: result => {
                  const generation = ++slot.generation;
                  if (!slot.blob) return;
                  void renderBackground(slot.blob, result).then(async blob => {
                    if (generation !== slot.generation || !this.enabled() || !element.isConnected) return;
                    const output = URL.createObjectURL(blob);
                    try {
                      const ready = new Image(); ready.src = output;
                      await ready.decode();
                    } catch (error) { URL.revokeObjectURL(output); throw error; }
                    if (generation !== slot.generation || !this.enabled() || !element.isConnected) {
                      URL.revokeObjectURL(output); return;
                    }
                    if (slot.output) URL.revokeObjectURL(slot.output);
                    slot.output = output; slot.active = true; slot.ready = true;
                    this.edit(() => this.write(owner));
                  }).catch(() => {
                    // Keep the opaque placeholder if acquisition or encoding fails.
                    if (generation === slot.generation) element.dataset.localMediaCensorBackground = 'render-error';
                  });
                },
              });
              slot.image.src = source;
            });
            this.write(record);
          }
          if (record || sources.some(Boolean)) {
            // Commit the protected style before allowing authored transitions.
            void getComputedStyle(element).backgroundImage;
            element.style.removeProperty('transition');
            for (const transition of transitions) if (transition.value)
              element.style.setProperty(transition.name, transition.value, transition.priority);
          }
        }
        if (++count >= 150 || performance.now() - started >= 8) break;
      }
    });
    if (this.pending.size && !this.scheduled) {
      this.scheduled = true; queueMicrotask(() => this.scan());
    }
  }
}
