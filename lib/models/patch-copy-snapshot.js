/** @babel */

// A detached copy owns its snapshot until a renderer accepts it. Closing a
// staged host releases the same ownership even when it was never in a pane.
export default class PatchCopySnapshot {
  constructor(data) {
    const source = data.commit?.isPresent() ? data.commit : data.multiFilePatch;
    this.owner = source.clone();
    try {
      this.data = {
        ...data,
        commit: data.commit?.isPresent() ? this.owner : null,
        multiFilePatch: data.commit?.isPresent() ? this.owner.getMultiFileDiff() : this.owner,
      };
    } catch (error) {
      this.owner.dispose();
      throw error;
    }
    this.transferred = false;
    this.disposed = false;
  }

  clone() {
    if (this.disposed) throw new DOMException("Patch copy was closed", "AbortError");
    return new PatchCopySnapshot(this.data);
  }

  isAvailable() {
    return !this.disposed && !this.transferred;
  }

  takePatch() {
    if (!this.isAvailable() || this.data.commit)
      throw new DOMException("Diff copy is no longer available", "AbortError");
    this.transferred = true;
    return this.data.multiFilePatch;
  }

  take() {
    if (this.disposed || this.transferred)
      throw new DOMException("Patch copy was already accepted", "AbortError");
    this.transferred = true;
    return {
      data: this.data,
      snapshot: {
        source: this.owner,
        owner: this.owner,
        commit: this.data.commit,
        patch: this.data.multiFilePatch,
        transferred: true,
        disposed: false,
      },
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (!this.transferred) this.owner.dispose();
  }
}
