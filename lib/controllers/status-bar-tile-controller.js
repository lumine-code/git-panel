/** @babel */
/** @jsx React.createElement */
import React, { Fragment } from "react";

import BranchView from "../views/branch-view";
import BranchMenuView from "../views/branch-menu-view";
import PushPullView from "../views/push-pull-view";
import ChangedFilesCountView from "../views/changed-files-count-view";
import Tooltip from "../atom/tooltip";
import Commands, { Command } from "../atom/commands";
import ObserveModel from "../views/observe-model";
import RefHolder from "../models/ref-holder";
import yubikiri from "yubikiri";

export default class StatusBarTileController extends React.Component {
  lastData = null;

  constructor(props) {
    super(props);

    this.refBranchViewRoot = new RefHolder();
  }

  getChangedFilesCount(data) {
    const { stagedFiles, unstagedFiles, mergeConflictFiles } = data.statusesForChangedFiles;
    const changedFiles = new Set();

    for (const filePath in unstagedFiles) {
      changedFiles.add(filePath);
    }
    for (const filePath in stagedFiles) {
      changedFiles.add(filePath);
    }
    for (const filePath in mergeConflictFiles) {
      changedFiles.add(filePath);
    }

    return changedFiles.size;
  }

  fetchData = (repository) => {
    return yubikiri({
      repository,
      currentBranch: repository.getCurrentBranch(),
      branches: repository.getBranches(),
      statusesForChangedFiles: repository.getStatusesForChangedFiles(),
      currentRemote: async (query) =>
        repository.getRemoteForBranch((await query.currentBranch).getName()),
      aheadCount: async (query) => repository.getAheadCount((await query.currentBranch).getName()),
      behindCount: async (query) =>
        repository.getBehindCount((await query.currentBranch).getName()),
      originExists: async () => (await repository.getRemotes()).withName("origin").isPresent(),
    });
  };

  render() {
    return (
      <ObserveModel model={this.props.repository} fetchData={this.fetchData}>
        {(data) => {
          let dataProps = data;

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
          }

          return dataProps ? this.renderWithData(dataProps) : null;
        }}
      </ObserveModel>
    );
  }

  renderWithData(data) {
    let changedFilesCount, mergeConflictsPresent;
    if (data.statusesForChangedFiles) {
      changedFilesCount = this.getChangedFilesCount(data);
      mergeConflictsPresent =
        Object.keys(data.statusesForChangedFiles.mergeConflictFiles).length > 0;
    }

    const repoProps = {
      repository: data.repository || this.props.repository,
      currentBranch: data.currentBranch,
      branches: data.branches,
      currentRemote: data.currentRemote,
      aheadCount: data.aheadCount,
      behindCount: data.behindCount,
      originExists: data.originExists,
      changedFilesCount,
      mergeConflictsPresent,
    };

    return (
      <Fragment>
        {this.renderTiles(repoProps)}
        <ChangedFilesCountView
          didClick={this.props.toggleGitTab}
          changedFilesCount={repoProps.changedFilesCount}
          mergeConflictsPresent={repoProps.mergeConflictsPresent}
        />
      </Fragment>
    );
  }

  renderTiles(repoProps) {
    if (!repoProps.repository.showStatusBarTiles()) {
      return null;
    }

    const operationStates = repoProps.repository.getOperationStates();
    const pushInProgress = operationStates.isPushInProgress();
    const pullInProgress = operationStates.isPullInProgress();
    const fetchInProgress = operationStates.isFetchInProgress();

    return (
      <Fragment>
        <Commands registry={this.props.commands} target="atom-workspace">
          <Command command="git-panel:fetch" callback={this.fetch(repoProps)} />
          <Command command="git-panel:pull" callback={this.pull(repoProps)} />
          <Command
            command="git-panel:push"
            callback={() =>
              this.push(repoProps)({
                force: false,
                setUpstream: !repoProps.currentRemote.isPresent(),
              })
            }
          />
          <Command
            command="git-panel:force-push"
            callback={() =>
              this.push(repoProps)({
                force: true,
                setUpstream: !repoProps.currentRemote.isPresent(),
              })
            }
          />
        </Commands>
        <BranchView
          refRoot={this.refBranchViewRoot.setter}
          workspace={this.props.workspace}
          checkout={this.checkout(repoProps.repository)}
          currentBranch={repoProps.currentBranch}
        />
        <Tooltip
          manager={this.props.tooltips}
          target={this.refBranchViewRoot}
          trigger="click"
          className="git-panel-StatusBarTileController-tooltipMenu"
        >
          <BranchMenuView
            workspace={this.props.workspace}
            notificationManager={this.props.notificationManager}
            commands={this.props.commands}
            checkout={this.checkout(repoProps.repository)}
            branches={repoProps.branches}
            currentBranch={repoProps.currentBranch}
          />
        </Tooltip>
        <PushPullView
          isSyncing={fetchInProgress || pullInProgress || pushInProgress}
          isFetching={fetchInProgress}
          isPulling={pullInProgress}
          isPushing={pushInProgress}
          push={this.push(repoProps)}
          pull={this.pull(repoProps)}
          fetch={this.fetch(repoProps)}
          tooltipManager={this.props.tooltips}
          currentBranch={repoProps.currentBranch}
          currentRemote={repoProps.currentRemote}
          behindCount={repoProps.behindCount}
          aheadCount={repoProps.aheadCount}
          originExists={repoProps.originExists}
        />
      </Fragment>
    );
  }

  handleOpenGitTimingsView = (e) => {
    e && e.preventDefault();
    this.props.workspace.open("atom-github://debug/timings");
  };

  checkout(repository) {
    return async (branchName, options) => {
      try {
        return await repository.checkout(branchName, options);
      } catch (e) {
        if (atom.config.get("git-panel.debug")) {
          console.error(e);
        }
      }
      return null;
    };
  }

  push(data) {
    return async ({ force, setUpstream } = {}) => {
      try {
        return await data.repository.push(data.currentBranch.getName(), {
          force,
          setUpstream,
          refSpec: data.currentBranch.getRefSpec("PUSH"),
        });
      } catch (e) {
        if (atom.config.get("git-panel.debug")) {
          console.error(e);
        }
      }
      return null;
    };
  }

  pull(data) {
    return async () => {
      try {
        return await data.repository.pull(data.currentBranch.getName(), {
          refSpec: data.currentBranch.getRefSpec("PULL"),
        });
      } catch (e) {
        if (atom.config.get("git-panel.debug")) {
          console.error(e);
        }
      }
      return null;
    };
  }

  fetch(data) {
    return async () => {
      try {
        const upstream = data.currentBranch.getUpstream();
        return await data.repository.fetch(upstream.getRemoteRef(), {
          remoteName: upstream.getRemoteName(),
        });
      } catch (e) {
        if (atom.config.get("git-panel.debug")) {
          console.error(e);
        }
      }
      return null;
    };
  }
}

function repositoryIsDestroyed(repository) {
  return !repository || (repository.isDestroyed && repository.isDestroyed());
}
