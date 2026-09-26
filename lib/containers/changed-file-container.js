/** @babel */
/** @jsx React.createElement */
import React from "react";
import { resolveQuery } from "../helpers";
import { CompositeDisposable, Emitter } from "lumine";

import { autobind } from "../helpers";
import ObserveModel from "../views/observe-model";
import LoadingView from "../views/loading-view";
import ChangedFileController from "../controllers/changed-file-controller";

export default class ChangedFileContainer extends React.Component {
  constructor(props) {
    super(props);
    autobind(this, "fetchData", "prepareData", "renderWithData");

    this.emitter = new Emitter();

    this.patchBuffer = null;
    this.lastMultiFilePatch = null;
    this.sub = new CompositeDisposable();

    this.state = { renderStatusOverride: null };
  }

  async fetchData(repository) {
    const staged = this.props.stagingStatus === "staged";

    const builderOpts = {};
    let renderStatusOverride = this.state.renderStatusOverride;
    const [currentFilePatch] = this.lastMultiFilePatch?.getFilePatches() || [];
    if (currentFilePatch?.isPresent()) {
      renderStatusOverride = currentFilePatch.getRenderStatus();
    }
    if (renderStatusOverride !== null) {
      builderOpts.renderStatusOverrides = { [this.props.relPath]: renderStatusOverride };
    }
    if (this.props.largeDiffThreshold !== undefined) {
      builderOpts.largeDiffThreshold = this.props.largeDiffThreshold;
    }

    const data = await resolveQuery({
      multiFilePatch: repository.getFilePatchForPath(this.props.relPath, {
        staged,
        builder: builderOpts,
      }),
      isPartiallyStaged: repository.isPartiallyStaged(this.props.relPath),
      hasUndoHistory: repository.hasDiscardHistory(this.props.relPath),
    });

    return data;
  }

  prepareData(data) {
    // Patch adoption mutates the live TextBuffer. ObserveModel invokes this only for an accepted
    // fetch result and inside the same synchronous React commit that publishes its new props.
    this.adoptPatchBuffer(data.multiFilePatch);
  }

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
    return (
      <ObserveModel
        model={this.props.repository}
        fetchData={this.fetchData}
        prepareData={this.prepareData}
        synchronousUpdates={true}
      >
        {this.renderWithData}
      </ObserveModel>
    );
  }

  renderWithData(data) {
    const currentMultiFilePatch = data && data.multiFilePatch;
    if (currentMultiFilePatch !== this.lastMultiFilePatch) {
      this.sub.dispose();
      /* istanbul ignore else */
      if (currentMultiFilePatch) {
        /* istanbul ignore else */
        if (this.patchBuffer === null) {
          this.patchBuffer = currentMultiFilePatch.getPatchBuffer();
        }
        // Keep this component's renderStatusOverride synchronized with the FilePatch we're rendering
        this.sub = new CompositeDisposable(
          ...currentMultiFilePatch.getFilePatches().map((fp) =>
            fp.onDidChangeRenderStatus(() => {
              this.setState({ renderStatusOverride: fp.getRenderStatus() });
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
      <ChangedFileController
        onWillUpdatePatch={this.onWillUpdatePatch}
        onDidUpdatePatch={this.onDidUpdatePatch}
        {...data}
        {...this.props}
      />
    );
  }

  componentWillUnmount() {
    this.sub.dispose();
  }

  onWillUpdatePatch = (cb) => this.emitter.on("will-update-patch", cb);

  onDidUpdatePatch = (cb) => this.emitter.on("did-update-patch", cb);
}
