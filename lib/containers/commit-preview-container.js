/** @babel */
/** @jsx h */
import { View, h } from "../etch/view";
import { resolveQuery } from "../helpers";
import { CompositeDisposable, Emitter } from "lumine";

import ObserveModel from "../views/observe-model";
import LoadingView from "../views/loading-view";
import CommitPreviewController from "../controllers/commit-preview-controller";

export default class CommitPreviewContainer extends View {
  constructor(props, children) {
    super(props, children);

    this.emitter = new Emitter();

    this.patchBuffer = null;

    this.lastMultiFilePatch = null;
    this.lastSourcePatch = null;
    this.ownedMultiFilePatch = null;
    this.sub = new CompositeDisposable();

    this.state = { renderStatusOverrides: {} };

    this.initialize();
  }

  fetchData = async (repository) => {
    const renderStatusOverrides = { ...this.state.renderStatusOverrides };
    for (const filePatch of this.lastMultiFilePatch?.getFilePatches() || []) {
      if (filePatch.isPresent()) {
        const renderStatus = filePatch.getRenderStatus();
        if (renderStatus.isVisible() || renderStatus.isExpandable()) {
          renderStatusOverrides[filePatch.getPath()] = renderStatus;
        }
      }
    }
    const builderOpts = { renderStatusOverrides };

    if (this.props.largeDiffThreshold !== undefined) {
      builderOpts.largeDiffThreshold = this.props.largeDiffThreshold;
    }

    const data = await resolveQuery({
      multiFilePatch: repository.getStagedChangesPatch({
        builder: builderOpts,
      }),
    });

    return data;
  };

  prepareData = (data) => {
    // Patch adoption mutates the live TextBuffer. ObserveModel invokes this only for an accepted
    // fetch result and inside the same view transaction that publishes its new props.
    const source = data.multiFilePatch;
    if (source.isDisposed?.())
      throw Object.assign(new Error("Git patch was superseded"), { name: "AbortError" });
    if (source === this.lastSourcePatch && this.ownedMultiFilePatch) {
      data.multiFilePatch = this.ownedMultiFilePatch;
      return;
    }
    const snapshot = source.clone?.() ?? source;
    try {
      const desired = { ...this.state.renderStatusOverrides };
      for (const file of this.lastMultiFilePatch?.getFilePatches() || [])
        desired[file.getPath()] = file.getRenderStatus();
      for (const file of snapshot.getFilePatches()) {
        const status = desired[file.getPath()];
        if (!status || !file.isPresent()) continue;
        if (status.isVisible() && file.getRenderStatus().isExpandable())
          snapshot.expandFilePatch(file);
        else if (!status.isVisible() && file.getRenderStatus().isVisible())
          snapshot.collapseFilePatch(file);
      }
      this.adoptPatchBuffer(snapshot);
    } catch (error) {
      if (snapshot !== source) snapshot.dispose();
      throw error;
    }
    const previous = this.ownedMultiFilePatch;
    this.ownedMultiFilePatch = snapshot !== source ? snapshot : null;
    this.lastSourcePatch = source;
    data.multiFilePatch = snapshot;
    if (previous) queueMicrotask(() => previous.dispose());
  };

  adoptPatchBuffer(multiFilePatch) {
    const nextPatchBuffer = multiFilePatch.getPatchBuffer();
    if (this.patchBuffer === null) {
      this.patchBuffer = nextPatchBuffer;
    } else if (nextPatchBuffer !== this.patchBuffer) {
      this.emitter.emit("will-update-patch");
      multiFilePatch.adoptBuffer(this.patchBuffer);
      this.emitter.emit("did-update-patch", multiFilePatch);
    }
  }

  render() {
    return h(
      "span",
      { style: { display: "contents" } },
      <ObserveModel
        model={this.props.repository}
        fetchData={this.fetchData}
        prepareData={this.prepareData}
        synchronousUpdates={true}
      >
        {this.renderResult}
      </ObserveModel>,
    );
  }

  renderResult = (data) => {
    const currentMultiFilePatch = data && data.multiFilePatch;
    if (currentMultiFilePatch !== this.lastMultiFilePatch) {
      this.sub.dispose();
      if (currentMultiFilePatch) {
        /* istanbul ignore else */
        if (this.patchBuffer === null) {
          this.patchBuffer = currentMultiFilePatch.getPatchBuffer();
        }
        this.sub = new CompositeDisposable(
          ...currentMultiFilePatch.getFilePatches().map((fp) =>
            fp.onDidChangeRenderStatus(() => {
              this.updateState((prevState) => {
                return {
                  renderStatusOverrides: {
                    ...prevState.renderStatusOverrides,
                    [fp.getPath()]: fp.getRenderStatus(),
                  },
                };
              });
            }),
          ),
        );
      }
      this.lastMultiFilePatch = currentMultiFilePatch;
    }

    if (this.props.repository.isLoading() || data === null) {
      return <LoadingView />;
    }

    return (
      <CommitPreviewController
        stagingStatus={"staged"}
        onWillUpdatePatch={this.onWillUpdatePatch}
        onDidUpdatePatch={this.onDidUpdatePatch}
        {...data}
        {...this.props}
      />
    );
  };

  willDestroy() {
    this.sub.dispose();
    this.emitter.dispose();
    this.ownedMultiFilePatch?.dispose();
    this.ownedMultiFilePatch = null;
  }

  onWillUpdatePatch = (cb) => this.emitter.on("will-update-patch", cb);

  onDidUpdatePatch = (cb) => this.emitter.on("did-update-patch", cb);
}
