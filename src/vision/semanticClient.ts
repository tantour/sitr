export class SemanticClient {
  private worker?: Worker;
  private nextId = 0;
  private backend = 'unknown';
  private pending = new Map<number, { resolve: (value: Uint8Array) => void; reject: (error: Error) => void }>();

  async initialize(preference: 'auto' | 'cpu'): Promise<void> {
    const worker = new Worker(`${self.location.origin}/semantic-worker.js`);
    this.worker = worker;
    await new Promise<void>((resolve, reject) => {
      const timer = self.setTimeout(() => reject(new Error('Semantic worker initialization timed out')), 20000);
      worker.onmessage = (event: MessageEvent<{ type: string; backend?: string; id?: number; categories?: Uint8Array; message?: string }>) => {
        const message = event.data;
        if (message.type === 'ready') {
          clearTimeout(timer);
          this.backend = message.backend ?? 'unknown';
          resolve();
        } else if (message.type === 'error' && message.id === undefined) {
          clearTimeout(timer);
          reject(new Error(message.message ?? 'Semantic worker failed'));
        } else if (message.id !== undefined) {
          const pending = this.pending.get(message.id);
          if (!pending) return;
          this.pending.delete(message.id);
          if (message.type === 'result' && message.categories) pending.resolve(message.categories);
          else pending.reject(new Error(message.message ?? 'Semantic worker failed'));
        }
      };
      worker.onerror = event => {
        clearTimeout(timer);
        const error = new Error(event.message || 'Semantic worker crashed');
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
        reject(error);
      };
      worker.postMessage({ type: 'initialize', preference });
    }).catch(error => { this.dispose(); throw error; });
  }

  segment(rgba: Uint8Array, size: number): Promise<Uint8Array> {
    if (!this.worker) return Promise.reject(new Error('Semantic worker unavailable'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ type: 'segment', id, rgba, size });
    });
  }

  getBackend(): string { return this.backend; }
  dispose(): void { this.worker?.terminate(); this.worker = undefined; }
}
