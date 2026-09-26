/** @babel */
/** @jsx React.createElement */
import React from "react";
import { resolveQuery } from "../helpers";
import { CompositeDisposable, Emitter } from "lumine";

import ObserveModel from "../views/observe-model";
import LoadingView from "../views/loading-view";
import CommitPreviewController from "../controllers/commit-preview-controller";

export default class CommitPreviewContainer extends React.Component {
  constructor(props) {
    super(props);

    this.emitter = new Emitter();

    this.patchBuffer = null;

    this.lastMultiFilePatch = null;
    this.sub = new CompositeDisposable();

    this.state = { renderStatusOverrides: {} };
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
    // fetch result and inside the same synchronous React commit that publishes its new props.
    this.adoptPatchBuffer(data.multiFilePatch);
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
    return (
      <ObserveModel
        model={this.props.repository}
        fetchData={this.fetchData}
        prepareData={this.prepareData}
        synchronousUpdates={true}
      >
        {this.renderResult}
      </ObserveModel>
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
              this.setState((prevState) => {
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

  componentWillUnmount() {
    this.sub.dispose();
  }

  onWillUpdatePatch = (cb) => this.emitter.on("will-update-patch", cb);

  onDidUpdatePatch = (cb) => this.emitter.on("did-update-patch", cb);
}
