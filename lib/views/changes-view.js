/** @babel */
/** @jsx h */
import { View, h } from "../etch/view";
import MultiFilePatchController from "../controllers/multi-file-patch-controller";
import RefHolder from "../models/ref-holder";
import DiffViewToggle from "./diff-view-toggle";
import { CompositeDisposable, Disposable, Emitter } from "lumine";

export default class ChangesView extends View {
  constructor(props, children) {
    const ownedPatch = props.readOnly ? props.multiFilePatch.clone() : null;
    super(ownedPatch ? { ...props, multiFilePatch: ownedPatch } : props, children);
    this.sourcePatch = props.multiFilePatch;
    this.ownedPatch = ownedPatch;
    this.patchEvents = new Emitter();
    this.refPatchController = new RefHolder();
    this.controllerSubscription = this.refPatchController.observe((controller) => {
      this.forwardedPatchController = controller;
      this.props.refPatchController?.setter(controller);
    });
    this.initialize();
  }

  render() {
    return (
      <div
        className={`git-panel-ChangesView${this.props.compact ? " git-panel-ChangesView--compact" : ""}`}
      >
        <div className="git-panel-ChangesView-header native-key-bindings" tabIndex="-1">
          <h3 className="git-panel-ChangesView-title">{this.props.title}</h3>
          <DiffViewToggle
            diffView={this.refPatchController
              .map((controller) => controller.getDiffView())
              .getOr("unified")}
            onDiffViewChange={this.didChangeDiffView}
          />
        </div>
        <MultiFilePatchController
          {...this.props}
          ref={this.refPatchController.setter}
          onWillUpdatePatch={this.onWillUpdatePatch}
          onDidUpdatePatch={this.onDidUpdatePatch}
        />
      </div>
    );
  }

  didChangeDiffView = async (diffView) => {
    await this.refPatchController
      .map((controller) => controller.setDiffView(diffView))
      .getOr(Promise.resolve());
    if (!this.destroyed) {
      this.props.onDiffViewChange?.(this.getDiffView());
      await this.invalidate();
    }
  };

  getDiffView() {
    return this.refPatchController.map((controller) => controller.getDiffView()).getOr("unified");
  }

  setDiffView(diffView) {
    return this.didChangeDiffView(diffView);
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
    if (this.destroyed) return Promise.resolve();
    if (!props.readOnly) return super.update(props, children);
    const source = props.multiFilePatch;
    if (source === this.sourcePatch || source === this.ownedPatch)
      return super.update({ ...props, multiFilePatch: this.ownedPatch }, children);
    const snapshot = source.clone();
    const previous = this.ownedPatch;
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

  didUpdate(previous) {
    if (previous.refPatchController !== this.props.refPatchController) {
      this.clearExternalController(previous.refPatchController);
      if (this.forwardedPatchController)
        this.props.refPatchController?.setter(this.forwardedPatchController);
    }
  }

  clearExternalController(holder) {
    if (holder && (!holder.getOr || holder.getOr(null) === this.forwardedPatchController))
      holder.setter(null);
  }

  willDestroy() {
    this.controllerSubscription.dispose();
    this.clearExternalController(this.props.refPatchController);
    this.forwardedPatchController = null;
    this.patchEvents.dispose();
    this.ownedPatch?.dispose();
    this.ownedPatch = null;
  }
}
