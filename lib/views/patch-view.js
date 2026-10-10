/** @babel */
/** @jsx h */
import { View, h, transaction } from "../etch/view";
import MultiFilePatchController from "../controllers/multi-file-patch-controller";
import RefHolder from "../models/ref-holder";
import DiffViewToggle from "./diff-view-toggle";
import CommitDetailHeaderView from "./commit-detail-header-view";

// The document owns data; this frame owns the patch renderer for its whole lifetime.
export default class PatchView extends View {
  constructor(props, children, initialize = true) {
    super(props, children);
    this.refRoot = new RefHolder();
    this.refPatchController = new RefHolder();
    this.controllerSubscription = this.refPatchController.observe((controller) => {
      this.forwardedPatchController = controller;
      this.props.refPatchController?.setter(controller);
    });
    if (initialize) this.initialize();
  }

  render() {
    const commit = Boolean(
      this.props.commit &&
      (this.props.document?.kind === "commit" || this.props.surfaceKind === "commit"),
    );
    return (
      <div
        className={`git-panel-ChangesView${commit ? " git-panel-CommitDetailView" : ""}${this.props.compact ? " git-panel-ChangesView--compact" : ""}`}
        ref={this.refRoot.setter}
      >
        {commit ? (
          <CommitDetailHeaderView
            key="patch-header"
            document={this.props.document}
            commit={this.props.commit}
            currentRemote={this.props.currentRemote}
            isCommitPushed={this.props.isCommitPushed}
            commands={this.props.commands}
            commandTarget={this.refRoot}
            surface={this.props.surface}
            diffView={this.getDiffView()}
            onDiffViewChange={this.didChangeDiffView}
          />
        ) : (
          <div
            key="patch-header"
            className="git-panel-ChangesView-header native-key-bindings"
            tabIndex="-1"
          >
            <h3 className="git-panel-ChangesView-title">{this.props.title}</h3>
            <DiffViewToggle
              diffView={this.getDiffView()}
              onDiffViewChange={this.didChangeDiffView}
            />
          </div>
        )}
        <MultiFilePatchController
          {...this.getPatchControllerProps()}
          key="patch-controller"
          ref={this.refPatchController.setter}
        />
      </div>
    );
  }

  getPatchControllerProps() {
    return this.props;
  }

  update(props, children) {
    return transaction(() => super.update(props, children));
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
    return this.refPatchController
      .map((controller) => controller.getDiffView())
      .getOr(this.props.initialDiffView === "side-by-side" ? "side-by-side" : "unified");
  }

  setDiffView(diffView) {
    return this.didChangeDiffView(diffView);
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
  }
}
