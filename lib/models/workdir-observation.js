/** @babel */

// A pane owns observation independently of the panel's selected repository.
// Keep the cached model alive, but mount readers only after its snapshots are fresh.
export default class WorkdirObservation {
  constructor(didChange) {
    this.didChange = didChange;
    this.destroyed = false;
    this.readyContext = null;
  }

  getRepository(pool, directory) {
    if (this.destroyed) return null;
    if (pool !== this.pool || directory !== this.directory) {
      this.release();
      this.pool = pool;
      this.directory = directory;
      this.lease = pool.retain(directory);
      this.subscription = pool.onDidChangePoolContexts(() => {
        this.refresh();
        this.didChange();
      });
    }
    this.refresh();
    return this.readyContext?.getRepository() ?? null;
  }

  refresh() {
    if (!this.lease || this.destroyed) return;
    const context = this.lease.context;
    const ready = this.lease.ready;
    if (context === this.pendingContext && ready === this.pendingReady) return;
    this.pendingContext = context;
    this.pendingReady = ready;
    this.readyContext = null;
    this.error = null;
    const lease = this.lease;
    Promise.resolve(ready).then(
      () => {
        if (
          this.destroyed ||
          lease !== this.lease ||
          ready !== this.pendingReady ||
          context !== lease.context
        )
          return;
        this.readyContext = context;
        this.didChange();
      },
      (error) => {
        if (this.destroyed || lease !== this.lease || ready !== this.pendingReady) return;
        this.error = error;
        this.didChange();
      },
    );
  }

  async getReadyRepository(pool, directory) {
    this.getRepository(pool, directory);
    while (!this.destroyed && this.lease) {
      const lease = this.lease;
      const context = lease.context;
      const ready = lease.ready;
      try {
        await ready;
      } catch (error) {
        if (this.destroyed) break;
        if (lease !== this.lease || context !== lease.context || ready !== lease.ready) continue;
        throw error;
      }
      if (this.destroyed) break;
      if (lease !== this.lease || context !== lease.context || ready !== lease.ready) continue;
      this.readyContext = context;
      this.pendingContext = context;
      this.pendingReady = ready;
      this.error = null;
      return context.getRepository();
    }
    throw new DOMException("Repository observation was closed", "AbortError");
  }

  release() {
    this.subscription?.dispose();
    this.lease?.dispose();
    this.subscription = null;
    this.lease = null;
    this.readyContext = null;
    this.pendingContext = null;
    this.pendingReady = null;
    this.error = null;
  }

  dispose() {
    this.destroyed = true;
    this.release();
  }
}
