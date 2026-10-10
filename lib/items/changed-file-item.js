/** @babel */
/** @jsx h */
import { View, h } from "../etch/view";
import { Emitter } from "lumine";

import { autobind } from "../helpers";
import ChangedFileContainer from "../containers/changed-file-container";
import RefHolder from "../models/ref-holder";
import WorkdirObservation from "../models/workdir-observation";
import LoadingView from "../views/loading-view";
import path from "path";

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
    this.refContainer = new RefHolder();
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

  canReusePendingItem(params) {
    return Boolean(
      !this.destroyed &&
      !this.hasTerminatedPendingState &&
      this.props.workingDirectory === params.workingDirectory &&
      ["staged", "unstaged"].includes(params.stagingStatus) &&
      !this.refContainer.isEmpty() &&
      !this.refPatchController.isEmpty(),
    );
  }

  async reusePendingItem(params, { signal }) {
    if (!this.canReusePendingItem(params)) return false;
    signal.throwIfAborted();
    const request = {};
    this.pendingNavigation = request;
    const container = this.refContainer.get();
    const repository = container.props.repository;
    const nextProps = {
      relPath: path.join(...params.relPath),
      workingDirectory: params.workingDirectory,
      stagingStatus: params.stagingStatus,
    };
    const data = await container.fetchData(repository, nextProps);
    const assertCurrent = () => {
      signal.throwIfAborted();
      if (
        this.pendingNavigation !== request ||
        !this.canReusePendingItem(params) ||
        this.refContainer.getOr(null) !== container ||
        container.props.repository !== repository
      )
        throw new DOMException("Patch navigation was superseded", "AbortError");
      if (data.multiFilePatch.isDisposed?.())
        throw new DOMException("Git patch was superseded", "AbortError");
    };
    assertCurrent();
    data.navigationSnapshot = data.multiFilePatch.clone?.();
    // PaneItem commits this together with its URI and copy identity, without
    // yielding between replacing the buffer and publishing the new document.
    const commit = () => {
      assertCurrent();
      container.pendingNavigationData = data;
      this.update({ ...this.props, ...nextProps });
      this.pendingNavigation = null;
    };
    commit.dispose = () => data.navigationSnapshot?.dispose();
    return commit;
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
        ref={this.refContainer.setter}
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

  isEmpty() {
    const patch = this.refPatchController.getOr(null)?.props.multiFilePatch;
    return Boolean(patch && patch.getFilePatches().every((file) => !file.isPresent()));
  }
}
