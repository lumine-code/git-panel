/** @babel */
/** @jsx h */
import { View, h } from "../etch/view";
import { Emitter } from "lumine";

import { autobind } from "../helpers";
import ChangedFileContainer from "../containers/changed-file-container";
import RefHolder from "../models/ref-holder";
import WorkdirObservation from "../models/workdir-observation";
import LoadingView from "../views/loading-view";

export default class ChangedFileItem extends View {
  static uriPattern =
    "lumine-git://file-patch/{relPath...}?workdir={workingDirectory}&stagingStatus={stagingStatus}";

  static buildURI(relPath, workingDirectory, stagingStatus) {
    return (
      "lumine-git://file-patch/" +
      encodeURIComponent(relPath) +
      `?workdir=${encodeURIComponent(workingDirectory)}` +
      `&stagingStatus=${encodeURIComponent(stagingStatus)}`
    );
  }

  constructor(props, children) {
    super(props, children);
    autobind(this, "destroy");

    this.emitter = new Emitter();
    this.isDestroyed = false;
    this.hasTerminatedPendingState = false;

    this.refEditor = new RefHolder();
    this.refPatchController = new RefHolder();
    this.filePatchLoadedPromise = new Promise((resolve) => {
      this.resolveFilePatchLoaded = resolve;
    });
    this.refPatchController.observe((controller) => this.resolveFilePatchLoaded(controller));
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

  getTitle() {
    let title = this.props.stagingStatus === "staged" ? "Staged" : "Unstaged";
    title += " Changes: ";
    title += this.props.relPath;
    return title;
  }

  getAllowedLocations() {
    return ["center"];
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

  destroy() {
    if (this.isDestroyed) return this.destroyPromise || Promise.resolve();
    this.isDestroyed = true;
    this.observation.dispose();
    this.resolveFilePatchLoaded(null);
    this.emitter.emit("did-destroy");
    const result = super.destroy();
    this.emitter.dispose();
    return result;
  }

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
      <ChangedFileContainer
        itemType={this.constructor}
        repository={repository}
        destroy={this.destroy}
        refEditor={this.refEditor}
        refPatchController={this.refPatchController}
        {...this.props}
      />,
    );
  }

  observeEmbeddedTextEditor(cb) {
    this.refEditor.map((editor) => editor.isAlive() && cb(editor));
    return this.emitter.on("did-change-embedded-text-editor", cb);
  }

  getFilePatchLoadedPromise() {
    return this.filePatchLoadedPromise;
  }

  goToDiffLine(lineNumber) {
    if (!this.destroyed)
      this.refPatchController.map((controller) => controller.goToSourceLine(lineNumber));
  }

  focus() {
    if (!this.destroyed) this.refEditor.map((editor) => editor.getElement().focus());
  }

  serialize() {
    return {
      deserializer: "FilePatchControllerStub",
      uri: ChangedFileItem.buildURI(
        this.props.relPath,
        this.props.workingDirectory,
        this.props.stagingStatus,
      ),
    };
  }

  getStagingStatus() {
    return this.props.stagingStatus;
  }

  getFilePath() {
    return this.props.relPath;
  }

  getWorkingDirectory() {
    return this.props.workingDirectory;
  }

  isFilePatchItem() {
    return true;
  }
}
