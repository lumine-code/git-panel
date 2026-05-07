/** @babel */
/** @jsx React.createElement */
import React from "react";
import yubikiri from "yubikiri";

import { nullCommit } from "../models/commit";
import { nullBranch } from "../models/branch";
import ObserveModel from "../views/observe-model";
import GitTabController from "../controllers/git-tab-controller";

const DEFAULT_REPO_DATA = {
  repository: null,
  username: "",
  email: "",
  lastCommit: nullCommit,
  recentCommits: [],
  isMerging: false,
  isRebasing: false,
  hasUndoHistory: false,
  currentBranch: nullBranch,
  unstagedChanges: [],
  stagedChanges: [],
  mergeConflicts: [],
  workingDirectoryPath: null,
  mergeMessage: null,
  fetchInProgress: true,
};

export default class GitTabContainer extends React.Component {
  lastData = null;

  fetchData = (repository) => {
    return yubikiri({
      repository,
      username: repository.getConfig("user.name").then((n) => n || ""),
      email: repository.getConfig("user.email").then((n) => n || ""),
      lastCommit: repository.getLastCommit(),
      recentCommits: repository.getRecentCommits({ max: 10 }),
      isMerging: repository.isMerging(),
      isRebasing: repository.isRebasing(),
      hasUndoHistory: repository.hasDiscardHistory(),
      currentBranch: repository.getCurrentBranch(),
      unstagedChanges: repository.getUnstagedChanges(),
      stagedChanges: repository.getStagedChanges(),
      mergeConflicts: repository.getMergeConflicts(),
      workingDirectoryPath: repository.getWorkingDirectoryPath(),
      mergeMessage: async (query) => {
        const isMerging = await query.isMerging;
        return isMerging ? repository.getMergeMessage() : null;
      },
      fetchInProgress: false,
    });
  };

  render() {
    return (
      <ObserveModel model={this.props.repository} fetchData={this.fetchData}>
        {(data) => {
          let dataProps = data || DEFAULT_REPO_DATA;
          let isSwitchingRepository = false;

          if (this.lastData && repositoryIsDestroyed(this.lastData.repository)) {
            this.lastData = null;
          }

          if (
            data &&
            data.repository === this.props.repository &&
            !repositoryIsDestroyed(data.repository)
          ) {
            this.lastData = data;
          } else if (this.lastData && this.lastData.repository !== this.props.repository) {
            dataProps = this.lastData;
            isSwitchingRepository = true;
          }

          return (
            <GitTabController
              {...dataProps}
              {...this.props}
              repository={dataProps.repository || this.props.repository}
              isSwitchingRepository={isSwitchingRepository}
              repositoryDrift={this.props.repository !== dataProps.repository}
            />
          );
        }}
      </ObserveModel>
    );
  }
}

function repositoryIsDestroyed(repository) {
  return !repository || (repository.isDestroyed && repository.isDestroyed());
}
