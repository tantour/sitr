// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
type Media = HTMLImageElement | HTMLVideoElement;

/** DOM queries and document observers do not cross player shadow boundaries. */
export class MediaDiscovery {
  private readonly roots = new Map<Document | ShadowRoot, { observer: MutationObserver; style: HTMLStyleElement }>();
  constructor(private readonly add: (media: Media) => void, private readonly remove: (media: Media) => void,
    private readonly pendingCss: string) {
    this.watch(document);
    // Attaching a root to an existing host produces no document mutation.
    window.setInterval(() => this.reconcile(), 1000);
  }
  private shadow(element: Element): ShadowRoot | null {
    return element.shadowRoot ?? (element instanceof HTMLElement ? chrome.dom?.openOrClosedShadowRoot(element) : null) ?? null;
  }
  private walk(node: Node, visit: (media: Media) => void, discoverRoots: boolean): void {
    const inspect = (element: Element) => {
      if (element instanceof HTMLImageElement || element instanceof HTMLVideoElement) visit(element);
      const shadow = this.shadow(element);
      if (shadow) {
        if (discoverRoots) this.watch(shadow);
        else this.walk(shadow, visit, false);
      }
    };
    if (node instanceof Element) inspect(node);
    if (node instanceof Element || node instanceof Document || node instanceof DocumentFragment) {
      node.querySelectorAll('*').forEach(inspect);
    }
  }
  inspect(node: Node): void { this.walk(node, this.add, true); }
  private watch(root: Document | ShadowRoot): void {
    if (this.roots.has(root)) return;
    const style = document.createElement('style');
    style.textContent = this.pendingCss;
    const observer = new MutationObserver(mutations => {
      const removed: Node[] = [];
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(node => this.inspect(node));
          mutation.removedNodes.forEach(node => removed.push(node));
          if (mutation.target instanceof HTMLVideoElement) this.add(mutation.target);
        } else if (mutation.target instanceof HTMLImageElement || mutation.target instanceof HTMLVideoElement) {
          this.add(mutation.target);
        } else if (mutation.target instanceof HTMLSourceElement) {
          const parent = mutation.target.parentElement;
          if (parent instanceof HTMLVideoElement) this.add(parent);
          else if (parent instanceof HTMLPictureElement) parent.querySelectorAll('img').forEach(this.add);
        }
      }
      if (removed.length) queueMicrotask(() => {
        removed.forEach(node => this.walk(node, media => { if (!media.isConnected) this.remove(media); }, false));
        this.prune();
      });
      const parent = root instanceof Document ? root.documentElement : root;
      if (parent && !style.isConnected) parent.appendChild(style);
    });
    this.roots.set(root, { observer, style });
    observer.observe(root, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['src', 'srcset', 'sizes', 'media', 'type'] });
    const parent = root instanceof Document ? root.documentElement : root;
    parent?.appendChild(style);
    this.inspect(root);
  }
  private prune(): void {
    for (const [root, state] of this.roots) {
      if (root instanceof ShadowRoot && !root.host.isConnected) {
        this.walk(root, media => { if (!media.isConnected) this.remove(media); }, false);
        state.observer.disconnect();
        state.style.remove();
        this.roots.delete(root);
      }
    }
  }
  private reconcile(): void {
    this.prune();
    for (const root of this.roots.keys()) {
      root.querySelectorAll('*').forEach(element => {
        const shadow = this.shadow(element);
        if (shadow && !this.roots.has(shadow)) this.watch(shadow);
      });
    }
  }
}
