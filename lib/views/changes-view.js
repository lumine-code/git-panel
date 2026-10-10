/** @babel */
import { transaction } from "../etch/view";
import { CompositeDisposable, Disposable, Emitter } from "lumine";
import PatchView from "./patch-view";

// Diff service consumers supply shared snapshots. Own the displayed copy so
// expanding files and refreshing the native buffer never modify their data.
export default class ChangesView extends PatchView {
  constructor(props, children) {
    const ownedPatch = props.readOnly ? props.multiFilePatch.clone() : null;
    super(ownedPatch ? { ...props, multiFilePatch: ownedPatch } : props, children, false);
    this.sourcePatch = props.multiFilePatch;
    this.ownedPatch = ownedPatch;
    this.patchEvents = new Emitter();
    this.initialize();
  }

  getPatchControllerProps() {
    return {
      ...this.props,
      onWillUpdatePatch: this.onWillUpdatePatch,
      onDidUpdatePatch: this.onDidUpdatePatch,
    };
  }

  onWillUpdatePatch = (callback) =>
    new CompositeDisposable(
      this.patchEvents.on("will-update", callback),
      this.props.onWillUpdatePatch?.(callback) || new Disposable(),
    );

  onDidUpdatePatch = (callback) =>
    new CompositeDisposable(
      this.patchEvents.on("did-update", callback),
      this.props.onDidUpdatePatch?.(callback) || new Disposable(),
    );

  update(props, children) {
    // Consumers can use another Etch instance. Adopt and publish within the
    // same native transaction, before any renderer sees the new buffer.
    return transaction(() => this.updatePatch(props, children));
  }

  updatePatch(props, children) {
    if (this.destroyed) return Promise.resolve();
    const source = props.multiFilePatch;
    const previous = this.ownedPatch;
    if (!props.readOnly) {
      this.sourcePatch = source;
      this.ownedPatch = null;
      return Promise.resolve(super.update(props, children)).finally(() => previous?.dispose());
    }
    if (previous && (source === this.sourcePatch || source === previous))
      return super.update({ ...props, multiFilePatch: previous }, children);
    const snapshot = source.clone();
    try {
      if (previous) {
        this.patchEvents.emit("will-update");
        snapshot.adoptBuffer(previous.getPatchBuffer());
        this.patchEvents.emit("did-update", snapshot);
      }
    } catch (error) {
      snapshot.dispose();
      throw error;
    }
    this.sourcePatch = source;
    this.ownedPatch = snapshot;
    return Promise.resolve(super.update({ ...props, multiFilePatch: snapshot }, children)).finally(
      () => previous?.dispose(),
    );
  }

  willDestroy() {
    super.willDestroy();
    this.patchEvents.dispose();
    this.ownedPatch?.dispose();
    this.ownedPatch = null;
  }
}
