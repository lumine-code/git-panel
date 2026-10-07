/** @babel */
/** @jsx h */
import { View, h } from "../etch/view";
import { Emitter } from "lumine";

import CommitDetailContainer from "../containers/commit-detail-container";
import RefHolder from "../models/ref-holder";
import WorkdirObservation from "../models/workdir-observation";
import LoadingView from "../views/loading-view";

export default class CommitDetailItem extends View {
  static uriPattern = "lumine-git://commit-detail?workdir={workingDirectory}&sha={sha}";

  static buildURI(workingDirectory, sha) {
    return `lumine-git://commit-detail?workdir=${encodeURIComponent(workingDirectory)}&sha=${encodeURIComponent(sha)}`;
  }

  constructor(props, children) {
    super(props, children);

    this.emitter = new Emitter();
    this.isDestroyed = false;
    this.hasTerminatedPendingState = false;
    this.shouldFocus = true;
    this.refInitialFocus = new RefHolder();

    this.refEditor = new RefHolder();
    this.refEditor.observe((editor) => {
      if (editor.isAlive()) {
        this.emitter.emit("did-change-embedded-text-editor", editor);
        const disposable = lumine.textEditors.add(editor, { role: "viewer" });
        editor.onDidDestroy(() => disposable.dispose());
      }
    });

    this.observation = new WorkdirObservation(() => this.invalidate());
    this.initialize();
  }

  terminatePendingState() {
    if (!this.hasTerminatedPendingState) {
      this.emitter.emit("did-terminate-pending-state");
      this.hasTerminatedPendingState = true;
    }
  }

  onDidTerminatePendingState(callback) {
    return this.emitter.on("did-terminate-pending-state", callback);
  }

  destroy = () => {
    if (this.isDestroyed) return this.destroyPromise || Promise.resolve();
    this.isDestroyed = true;
    this.observation.dispose();
    this.emitter.emit("did-destroy");
    const result = super.destroy();
    this.emitter.dispose();
    return result;
  };

  onDidDestroy(callback) {
    return this.emitter.on("did-destroy", callback);
  }

  render() {
    const repository = this.observation.getRepository(
      this.props.workdirContextPool,
      this.props.workingDirectory,
    );
    if (this.observation.error) return <div>{this.observation.error.message}</div>;
    if (!repository) return <LoadingView />;

    return h(
      "span",
      { style: { display: "contents" } },
      <CommitDetailContainer
        itemType={this.constructor}
        repository={repository}
        {...this.props}
        destroy={this.destroy}
        refEditor={this.refEditor}
        refInitialFocus={this.refInitialFocus}
      />,
    );
  }

  getTitle() {
    return `Commit: ${this.props.sha}`;
  }

  getIconName() {
    return "git-commit";
  }

  getAllowedLocations() {
    return ["center"];
  }

  observeEmbeddedTextEditor(cb) {
    this.refEditor.map((editor) => editor.isAlive() && cb(editor));
    return this.emitter.on("did-change-embedded-text-editor", cb);
  }

  getWorkingDirectory() {
    return this.props.workingDirectory;
  }

  getSha() {
    return this.props.sha;
  }

  serialize() {
    return {
      deserializer: "CommitDetailStub",
      uri: CommitDetailItem.buildURI(this.props.workingDirectory, this.props.sha),
    };
  }

  preventFocus() {
    this.shouldFocus = false;
  }

  focus() {
    this.refInitialFocus.getPromise().then((focusable) => {
      if (this.destroyed || !this.shouldFocus) {
        return;
      }

      focusable.focus();
    });
  }
}
