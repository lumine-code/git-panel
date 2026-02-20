/** @babel */
/** @jsx React.createElement */
import React from "react";
import yubikiri from "yubikiri";
import { CompositeDisposable } from "atom";

import ObserveModel from "../views/observe-model";
import LoadingView from "../views/loading-view";
import CommitDetailController from "../controllers/commit-detail-controller";

export default class CommitDetailContainer extends React.Component {
  constructor(props) {
    super(props);

    this.lastCommit = null;
    this.sub = new CompositeDisposable();
  }

  fetchData = (repository) => {
    return yubikiri({
      commit: repository.getCommit(this.props.sha),
      currentBranch: repository.getCurrentBranch(),
      currentRemote: async (query) =>
        repository.getRemoteForBranch((await query.currentBranch).getName()),
      isCommitPushed: repository.isCommitPushed(this.props.sha),
    });
  };

  render() {
    return (
      <ObserveModel model={this.props.repository} fetchData={this.fetchData}>
        {this.renderResult}
      </ObserveModel>
    );
  }

  renderResult = (data) => {
    const currentCommit = data && data.commit;
    if (currentCommit !== this.lastCommit) {
      this.sub.dispose();
      if (currentCommit && currentCommit.isPresent()) {
        this.sub = new CompositeDisposable(
          ...currentCommit
            .getMultiFileDiff()
            .getFilePatches()
            .map((fp) =>
              fp.onDidChangeRenderStatus(() => {
                this.forceUpdate();
              }),
            ),
        );
      }
      this.lastCommit = currentCommit;
    }

    if (this.props.repository.isLoading() || data === null || !data.commit.isPresent()) {
      return <LoadingView />;
    }

    return <CommitDetailController {...data} {...this.props} />;
  };

  componentWillUnmount() {
    this.sub.dispose();
  }
}
