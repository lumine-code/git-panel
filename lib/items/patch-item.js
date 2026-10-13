/** @babel */
/** @jsx h */
import { View, h } from "../etch/view.js";
import { CompositeDisposable, Disposable, Emitter } from "lumine";
import PatchContainer from "../containers/patch-container.js";
import PatchDocument from "../models/patch-document.js";
import RefHolder from "../models/ref-holder.js";
import WorkdirObservation from "../models/workdir-observation.js";
import LoadingView from "../views/loading-view.js";

// A pane owns one patch surface. Its document determines data and actions,
// while pending navigation keeps the native renderer and layout alive.
export default class PatchItem extends View {
  constructor(props, children) {
    super(props, children);
    this.emitter = new Emitter();
    this.subscriptions = new CompositeDisposable();
    this.hasTerminatedPendingState = false;
    this.refEditor = new RefHolder();
    this.refPatchController = new RefHolder();
    this.refContainer = new RefHolder();
    this.patchLoadedPromise = new Promise((resolve) => {
      this.resolvePatchLoaded = resolve;
    });
    this.subscriptions.add(
      this.refPatchController.observe((controller) => this.resolvePatchLoaded(controller)),
      this.refEditor.observe((editor) => {
        if (!editor.isAlive()) return;
        this.emitter.emit("did-change-embedded-text-editor", editor);
        const registration = lumine.textEditors.add(editor, { role: "viewer" });
        editor.onDidDestroy(() => registration.dispose());
      }),
    );
    this.observation = this.createObservation();
    this.initialize();
  }

  createObservation() {
    const observation = new WorkdirObservation(() => {
      if (this.observation === observation) this.invalidate();
    });
    return observation;
  }

  getDocument() {
    return this.props.document;
  }

  getTitle() {
    return this.getDocument().getTitle();
  }

  getIconName() {
    return this.getDocument().getIconName();
  }

  getAllowedLocations() {
    return ["center"];
  }

  terminatePendingState() {
    if (this.hasTerminatedPendingState) return;
    this.hasTerminatedPendingState = true;
    this.pendingNavigation?.controller.abort();
    this.emitter.emit("did-terminate-pending-state");
  }

  onDidTerminatePendingState(callback) {
    return this.emitter.on("did-terminate-pending-state", callback);
  }

  canReusePendingItem(document) {
    return Boolean(
      document instanceof PatchDocument &&
      !this.destroyed &&
      !this.hasTerminatedPendingState &&
      !this.refContainer.isEmpty() &&
      !this.refPatchController.isEmpty(),
    );
  }

  async reusePendingItem(document, { signal }) {
    if (!this.canReusePendingItem(document)) return false;
    signal.throwIfAborted();
    this.pendingNavigation?.controller.abort();
    const controller = new AbortController();
    const request = { controller };
    this.pendingNavigation = request;
    const onAbort = () => controller.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    const container = this.refContainer.get();
    const pool = this.props.workdirContextPool;
    const previousObservation = this.observation;
    const replaceObservation =
      previousObservation.pool !== pool ||
      previousObservation.directory !== document.workingDirectory;
    const observation = replaceObservation ? this.createObservation() : previousObservation;
    let prepared;
    let repositorySubscription;
    let repositoryRevision = 0;
    let preparedRevision;
    let committed = false;
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      repositorySubscription?.dispose();
      if (replaceObservation && !committed) observation.dispose();
      prepared?.dispose();
      if (this.pendingNavigation === request) this.pendingNavigation = null;
    };
    controller.signal.addEventListener("abort", cleanup, { once: true });
    const assertCurrent = () => {
      controller.signal.throwIfAborted();
      if (
        this.pendingNavigation !== request ||
        !this.canReusePendingItem(document) ||
        this.refContainer.getOr(null) !== container ||
        this.props.workdirContextPool !== pool ||
        this.observation !== previousObservation
      )
        throw new DOMException("Patch navigation was superseded", "AbortError");
    };
    try {
      const repository = await withAbort(
        observation.getReadyRepository(pool, document.workingDirectory),
        controller.signal,
      );
      assertCurrent();
      repositorySubscription = repository.onDidUpdate(() => repositoryRevision++);
      while (!prepared) {
        const revision = repositoryRevision;
        const data = await withAbort(container.fetchData(repository, document), controller.signal);
        assertCurrent();
        if (
          repository.isDestroyed?.() ||
          observation.getRepository(pool, document.workingDirectory) !== repository
        )
          throw new DOMException("Git repository was replaced", "AbortError");
        if (revision !== repositoryRevision) continue;
        prepared = container.prepareNavigationData(data);
        preparedRevision = revision;
      }
      const commit = () => {
        assertCurrent();
        if (
          observation.getRepository(pool, document.workingDirectory) !== repository ||
          repository.isDestroyed?.() ||
          repositoryRevision !== preparedRevision
        )
          throw new DOMException("Git repository was replaced", "AbortError");
        this.observation = observation;
        try {
          container.replaceDocument(document, repository, prepared);
          this.update({ ...this.props, document });
          committed = true;
          if (replaceObservation) previousObservation.dispose();
        } catch (error) {
          this.observation = previousObservation;
          throw error;
        }
      };
      commit.dispose = cleanup;
      return commit;
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  render() {
    const document = this.getDocument();
    const repository = this.observation.getRepository(
      this.props.workdirContextPool,
      document.workingDirectory,
    );
    if (this.observation.error) return <div>{this.observation.error.message}</div>;
    if (!repository) return <LoadingView />;
    return (
      <PatchContainer
        {...this.props}
        ref={this.refContainer.setter}
        repository={repository}
        destroy={this.destroy}
        refEditor={this.refEditor}
        refPatchController={this.refPatchController}
        surface={this.surface}
        openMirrorPatch={this.openMirrorPatch}
      />
    );
  }

  surface = () => this.props.surfaceDocument?.(this.getDocument());

  openMirrorPatch = (relPath, stagingStatus) => {
    const document = PatchDocument.file(this.getWorkingDirectory(), relPath, stagingStatus);
    return this.props.workspace.open(document.getURI(), { pending: true });
  };

  destroy = () => super.destroy();

  willDestroy() {
    this.pendingNavigation?.controller.abort();
    this.observation.dispose();
    this.resolvePatchLoaded(null);
    this.subscriptions.dispose();
    this.emitter.emit("did-destroy");
    this.emitter.dispose();
  }

  onDidDestroy(callback) {
    return this.emitter.on("did-destroy", callback);
  }

  observeEmbeddedTextEditor(callback) {
    this.refEditor.map((editor) => editor.isAlive() && callback(editor));
    return this.emitter.on("did-change-embedded-text-editor", callback);
  }

  getPatchLoadedPromise() {
    return this.patchLoadedPromise;
  }

  observeNavigationHeaders(callback) {
    let observation;
    callback([]);
    const reference = this.refPatchController.observe((controller) => {
      observation?.dispose();
      observation = controller.observeNavigationHeaders(callback);
    });
    return new CompositeDisposable(reference, new Disposable(() => observation?.dispose()));
  }

  navigateToNavigationHeader(header, options) {
    return this.refPatchController.getOr(null)?.navigateToNavigationHeader(header, options);
  }

  goToDiffLine(lineNumber) {
    if (!this.destroyed)
      this.refPatchController.map((controller) => controller.goToSourceLine(lineNumber));
  }

  focus() {
    if (!this.destroyed) this.refPatchController.getOr(null)?.focus();
  }

  captureCopyState() {
    const controller = this.refPatchController.getOr(null);
    return {
      presentationState: controller?.capturePresentationState() ?? this.props.presentationState,
      copySnapshot:
        this.refContainer.getOr(null)?.captureCopySnapshot() ??
        (!this.props.copySnapshot?.transferred ? this.props.copySnapshot?.clone() : null) ??
        null,
    };
  }

  serialize() {
    return { deserializer: "PatchPaneItem", uri: this.getDocument().getURI() };
  }

  getWorkingDirectory() {
    return this.getDocument().workingDirectory;
  }

  getStagingStatus() {
    return this.getDocument().getStagingStatus();
  }

  getFilePath() {
    return this.getDocument().relPath;
  }

  getSha() {
    return this.getDocument().sha;
  }

  isPatchItem() {
    return true;
  }

  isFilePatchItem() {
    return this.getDocument().kind === "file";
  }

  isEmpty() {
    const patch = this.refPatchController.getOr(null)?.props.multiFilePatch;
    return Boolean(patch && !patch.anyPresent());
  }
}

function withAbort(value, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(value)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}
