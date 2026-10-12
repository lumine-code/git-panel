/** @babel */
/** @jsx h */
import { View, h, transaction } from "../etch/view";
import { CompositeDisposable, Emitter } from "lumine";

import { autobind, resolveQuery } from "../helpers";
import RefHolder from "../models/ref-holder";
import ObserveModel from "../views/observe-model";
import LoadingView from "../views/loading-view";
import PatchView from "../views/patch-view";
import PatchCopySnapshot from "../models/patch-copy-snapshot";

const superseded = () => new DOMException("Git patch was superseded", "AbortError");

// All patch documents own their snapshots and reuse the same native buffer.
export default class PatchContainer extends View {
  constructor(props, children) {
    super(props, children);
    autobind(this, "fetchData", "prepareData", "renderWithData");
    this.emitter = new Emitter();
    this.sub = new CompositeDisposable();
    this.refObserveModel = new RefHolder();
    this.preparedSnapshots = new WeakMap();
    this.patchBuffer = null;
    this.lastMultiFilePatch = null;
    this.lastSource = null;
    this.ownedSnapshot = null;
    this.state = { renderStatusOverrides: {} };
    if (props.copySnapshot) {
      const accepted = props.copySnapshot.take();
      this.ownedSnapshot = accepted.snapshot;
      this.lastSource = accepted.snapshot.owner;
      this.patchBuffer = accepted.snapshot.patch.getPatchBuffer();
      this.initialData = this.lastData = accepted.data;
    }
    this.initialize();
  }

  getRenderStatusOverrides() {
    const overrides = { ...this.state.renderStatusOverrides };
    for (const file of this.lastMultiFilePatch?.getFilePatches() || []) {
      if (!file.isPresent()) continue;
      const status = file.getRenderStatus();
      if (status.isVisible() || status.isExpandable()) overrides[file.getPath()] = status;
    }
    return overrides;
  }

  async fetchData(repository, navigationDocument) {
    const document = navigationDocument || this.props.document;
    const builder = {};
    if (!navigationDocument) builder.renderStatusOverrides = this.getRenderStatusOverrides();
    if (this.props.largeDiffThreshold !== undefined)
      builder.largeDiffThreshold = this.props.largeDiffThreshold;

    const common = {
      commit: null,
      currentBranch: null,
      currentRemote: null,
      isCommitPushed: false,
      isPartiallyStaged: false,
      hasUndoHistory: false,
    };
    if (document.kind === "file") {
      return {
        ...common,
        ...(await resolveQuery({
          multiFilePatch: repository.getFilePatchForPath(document.relPath, {
            staged: document.stagingStatus === "staged",
            builder,
          }),
          isPartiallyStaged: repository.isPartiallyStaged(document.relPath),
          hasUndoHistory: repository.hasDiscardHistory(document.relPath),
        })),
      };
    }
    if (document.kind === "staged-all") {
      return {
        ...common,
        multiFilePatch: await repository.getStagedChangesPatch({ builder }),
      };
    }
    const data = await resolveQuery({
      commit: repository.getCommit(document.sha),
      currentBranch: repository.getCurrentBranch(),
      currentRemote: async (query) =>
        repository.getRemoteForBranch((await query.currentBranch).getName()),
      isCommitPushed: repository.isCommitPushed(document.sha),
    });
    return {
      ...common,
      ...data,
      multiFilePatch: data.commit.isPresent() ? data.commit.getMultiFileDiff() : null,
    };
  }

  cloneSnapshot(data) {
    const source = data.commit?.isPresent() ? data.commit : data.multiFilePatch;
    if (!source || source.isDisposed()) throw superseded();
    const owner = source.clone();
    try {
      const commit = data.commit?.isPresent() ? owner : null;
      const patch = commit ? commit.getMultiFileDiff() : owner;
      return { source, owner, commit, patch, transferred: false, disposed: false };
    } catch (error) {
      owner.dispose();
      throw error;
    }
  }

  prepareNavigationData(data) {
    const snapshot = this.cloneSnapshot(data);
    const preparedData = {
      ...data,
      commit: snapshot.commit,
      multiFilePatch: snapshot.patch,
    };
    this.preparedSnapshots.set(preparedData, snapshot);
    return {
      data: preparedData,
      dispose: () => {
        if (snapshot.transferred || snapshot.disposed) return;
        snapshot.disposed = true;
        this.preparedSnapshots.delete(preparedData);
        snapshot.owner.dispose();
      },
    };
  }

  replaceDocument(document, repository, prepared) {
    const snapshot = this.preparedSnapshots.get(prepared.data);
    if (
      this.destroyed ||
      !snapshot ||
      snapshot.disposed ||
      snapshot.transferred ||
      snapshot.source.isDisposed() ||
      snapshot.patch.isDisposed()
    )
      throw superseded();
    return transaction(() => {
      this.rememberPrevious();
      this.props = this.resolveProps({ ...this.props, document, repository });
      this.state = { renderStatusOverrides: {} };
      this.replacingDocument = true;
      try {
        // Bind the new repository with its accepted snapshot in one publication.
        this.refObserveModel.get().replaceModelData(prepared.data, repository);
        return this.invalidate();
      } finally {
        this.replacingDocument = false;
      }
    });
  }

  prepareData(data) {
    if (!data.multiFilePatch) return;
    this.lastData = data;
    const staged = this.preparedSnapshots.get(data);
    const source = data.commit?.isPresent() ? data.commit : data.multiFilePatch;
    if (!staged && source.isDisposed()) throw superseded();
    if (
      !staged &&
      this.ownedSnapshot &&
      (source === this.lastSource || source === this.ownedSnapshot.owner)
    ) {
      data.commit = this.ownedSnapshot.commit;
      data.multiFilePatch = this.ownedSnapshot.patch;
      return;
    }
    const snapshot = staged || this.cloneSnapshot(data);
    if (snapshot.disposed || snapshot.patch.isDisposed()) throw superseded();
    try {
      if (!this.replacingDocument) {
        const overrides = this.getRenderStatusOverrides();
        for (const file of snapshot.patch.getFilePatches()) {
          const desired = overrides[file.getPath()];
          if (!desired || !file.isPresent()) continue;
          if (desired.isVisible() && file.getRenderStatus().isExpandable())
            snapshot.patch.expandFilePatch(file);
          else if (!desired.isVisible() && file.getRenderStatus().isVisible())
            snapshot.patch.collapseFilePatch(file);
        }
      }
      this.adoptPatchBuffer(snapshot.patch);
    } catch (error) {
      snapshot.disposed = true;
      this.preparedSnapshots.delete(data);
      snapshot.owner.dispose();
      throw error;
    }
    const previous = this.ownedSnapshot;
    snapshot.transferred = true;
    this.preparedSnapshots.delete(data);
    this.ownedSnapshot = snapshot;
    this.lastSource = snapshot.source;
    data.commit = snapshot.commit;
    data.multiFilePatch = snapshot.patch;
    if (previous) queueMicrotask(() => previous.owner.dispose());
  }

  adoptPatchBuffer(multiFilePatch) {
    const nextBuffer = multiFilePatch.getPatchBuffer();
    if (this.patchBuffer === null) {
      this.patchBuffer = nextBuffer;
    } else if (nextBuffer !== this.patchBuffer) {
      const reset = Boolean(this.replacingDocument);
      this.emitter.emit("will-update-patch", { reset });
      multiFilePatch.adoptBuffer(this.patchBuffer);
      this.emitter.emit("did-update-patch", { multiFilePatch, reset });
    }
  }

  render() {
    return h(
      "span",
      { style: { display: "contents" } },
      <ObserveModel
        ref={this.refObserveModel.setter}
        model={this.props.repository}
        fetchData={this.fetchData}
        prepareData={this.prepareData}
        synchronousUpdates={true}
        initialData={this.initialData}
      >
        {this.renderWithData}
      </ObserveModel>,
    );
  }

  renderWithData(data) {
    const patch = data?.multiFilePatch ?? null;
    if (patch !== this.lastMultiFilePatch) {
      this.sub.dispose();
      this.sub = new CompositeDisposable(
        ...(patch?.getFilePatches() || []).map((file) =>
          file.onDidChangeRenderStatus(() => {
            this.updateState((state) => ({
              renderStatusOverrides: {
                ...state.renderStatusOverrides,
                [file.getPath()]: file.getRenderStatus(),
              },
            }));
          }),
        ),
      );
      this.lastMultiFilePatch = patch;
    }
    if (this.props.repository.isLoading() || !patch) return <LoadingView />;
    const document = this.props.document;
    return (
      <PatchView
        {...this.props}
        {...data}
        document={document}
        relPath={document.relPath}
        stagingStatus={document.getStagingStatus()}
        readOnly={document.isReadOnly()}
        surfaceKind={document.kind === "staged-all" ? undefined : document.kind}
        title={document.stagingStatus === "unstaged" ? "Unstaged Changes" : "Staged Changes"}
        onWillUpdatePatch={this.onWillUpdatePatch}
        onDidUpdatePatch={this.onDidUpdatePatch}
      />
    );
  }

  onWillUpdatePatch = (callback) => this.emitter.on("will-update-patch", callback);

  captureCopySnapshot() {
    return this.lastData && this.ownedSnapshot ? new PatchCopySnapshot(this.lastData) : null;
  }

  onDidUpdatePatch = (callback) =>
    this.emitter.on("did-update-patch", ({ multiFilePatch, reset }) =>
      reset ? callback(multiFilePatch, { reset }) : callback(multiFilePatch),
    );

  willDestroy() {
    this.sub.dispose();
    this.emitter.dispose();
    this.ownedSnapshot?.owner.dispose();
    this.ownedSnapshot = null;
  }
}
