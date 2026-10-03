/** @babel */
/** @jsx h */
import { View, h } from "../etch/view";
import MultiFilePatchController from "../controllers/multi-file-patch-controller";
import RefHolder from "../models/ref-holder";
import DiffViewToggle from "./diff-view-toggle";

export default class ChangesView extends View {
  constructor(props, children) {
    super(props, children);
    this.refPatchController = new RefHolder();
    this.controllerSubscription = this.refPatchController.observe((controller) => {
      this.forwardedPatchController = controller;
      this.props.refPatchController?.setter(controller);
    });
    this.initialize();
  }

  render() {
    return (
      <div className="git-panel-ChangesView">
        <div className="git-panel-ChangesView-header native-key-bindings" tabIndex="-1">
          <h3 className="git-panel-ChangesView-title">{this.props.title}</h3>
          <DiffViewToggle
            diffView={this.refPatchController
              .map((controller) => controller.getDiffView())
              .getOr("unified")}
            onDiffViewChange={this.didChangeDiffView}
          />
        </div>
        <MultiFilePatchController {...this.props} ref={this.refPatchController.setter} />
      </div>
    );
  }

  didChangeDiffView = async (diffView) => {
    await this.refPatchController
      .map((controller) => controller.setDiffView(diffView))
      .getOr(Promise.resolve());
    if (!this.destroyed) await this.invalidate();
  };

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
