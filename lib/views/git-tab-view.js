/** @babel */
/** @jsx React.createElement */
import React, { Fragment } from "react";
import cx from "classnames";
import { CompositeDisposable, Disposable } from "atom";

import StagingView from "./staging-view";
import GitIdentityView from "./git-identity-view";
import GitTabHeaderController from "../controllers/git-tab-header-controller";
import CommitController from "../controllers/commit-controller";
import RecentCommitsController from "../controllers/recent-commits-controller";
import RefHolder from "../models/ref-holder";
import { isValidWorkdir, autobind } from "../helpers";

export default class GitTabView extends React.Component {
  static focus = {
    ...GitTabHeaderController.focus,
    ...StagingView.focus,
    ...CommitController.focus,
    ...RecentCommitsController.focus,
  };

  constructor(props, context) {
    super(props, context);
    autobind(
      this,
      "initializeRepo",
      "cloneRepo",
      "blur",
      "closePanel",
      "advanceFocus",
      "retreatFocus",
      "focusProject",
      "focusUnstaged",
      "focusStaged",
      "focusCommit",
      "focusRecentCommits",
      "quietlySelectItem",
    );

    this.subscriptions = new CompositeDisposable();

    this.refHeaderController = new RefHolder();
    this.refCommitController = new RefHolder();
    this.refRecentCommitsController = new RefHolder();
  }

  componentDidMount() {
    this.props.refRoot.map((root) => {
      return this.subscriptions.add(
        this.props.commands.add(root, {
          "tool-panel:unfocus": this.blur,
          "core:close": (e) => {
            e.stopPropagation();
            this.closePanel();
          },
          "core:focus-next": this.advanceFocus,
          "core:focus-previous": this.retreatFocus,
          "git-panel:focus-project": this.focusProject,
          "git-panel:focus-unstaged": this.focusUnstaged,
          "git-panel:focus-staged": this.focusStaged,
          "git-panel:focus-commit": this.focusCommit,
          "git-panel:focus-recent-commits": this.focusRecentCommits,
        }),
      );
    });
  }

  render() {
    let renderMethod = "renderNormal";
    let isEmpty = false;
    let isLoading = false;
    if (this.props.editingIdentity) {
      renderMethod = "renderIdentityView";
    } else if (this.props.repository.isTooLarge()) {
      renderMethod = "renderTooLarge";
      isEmpty = true;
    } else if (
      this.props.repository.hasDirectory() &&
      this.props.repository.getWorkingDirectoryPath() &&
      !isValidWorkdir(this.props.repository.getWorkingDirectoryPath())
    ) {
      renderMethod = "renderUnsupportedDir";
      isEmpty = true;
    } else if (this.props.repository.showGitTabInit()) {
      renderMethod = "renderNoRepo";
      isEmpty = true;
    } else if (this.props.isLoading || this.props.repository.showGitTabLoading()) {
      isLoading = true;
    }

    return (
      <div
        className={cx("git-panel-Git", {
          "is-empty": isEmpty,
          "is-loading": !isEmpty && isLoading,
          "is-switching-repository": this.props.isSwitchingRepository,
        })}
        aria-busy={this.props.isSwitchingRepository}
        tabIndex="-1"
        ref={this.props.refRoot.setter}
      >
        {this.renderHeader()}
        {this[renderMethod]()}
      </div>
    );
  }

  renderHeader() {
    const { repository } = this.props;
    return (
      <GitTabHeaderController
        ref={this.refHeaderController.setter}
        getCommitter={() => (repository.isDestroyed() ? null : repository.getCommitter())}
        // Workspace
        currentWorkDir={this.props.workingDirectoryPath}
        getCurrentWorkDirs={this.props.getCurrentWorkDirs}
        contextLocked={this.props.contextLocked}
        changeWorkingDirectory={this.props.changeWorkingDirectory}
        setContextLock={this.props.setContextLock}
        // Event Handlers
        onDidClickAvatar={this.props.toggleIdentityEditor}
        onDidChangeWorkDirs={this.props.onDidChangeWorkDirs}
        onDidUpdateRepo={(callback) =>
          repository.isDestroyed() ? new Disposable(() => {}) : repository.onDidUpdate(callback)
        }
      />
    );
  }

  renderNormal() {
    return (
      <Fragment>
        <StagingView
          ref={this.props.refStagingView.setter}
          commands={this.props.commands}
          notificationManager={this.props.notificationManager}
          workspace={this.props.workspace}
          stagedChanges={this.props.stagedChanges}
          unstagedChanges={this.props.unstagedChanges}
          mergeConflicts={this.props.mergeConflicts}
          workingDirectoryPath={this.props.workingDirectoryPath}
          resolutionProgress={this.props.resolutionProgress}
          openFiles={this.props.openFiles}
          discardWorkDirChangesForPaths={this.props.discardWorkDirChangesForPaths}
          attemptFileStageOperation={this.props.attemptFileStageOperation}
          attemptStageAllOperation={this.props.attemptStageAllOperation}
          undoLastDiscard={this.props.undoLastDiscard}
          abortMerge={this.props.abortMerge}
          resolveAsOurs={this.props.resolveAsOurs}
          resolveAsTheirs={this.props.resolveAsTheirs}
          lastCommit={this.props.lastCommit}
          isLoading={this.props.isLoading}
          hasUndoHistory={this.props.hasUndoHistory}
          isMerging={this.props.isMerging}
        />
        <CommitController
          ref={this.refCommitController.setter}
          tooltips={this.props.tooltips}
          config={this.props.config}
          stagedChangesExist={this.props.stagedChanges.length > 0}
          mergeConflictsExist={this.props.mergeConflicts.length > 0}
          prepareToCommit={this.props.prepareToCommit}
          commit={this.props.commit}
          abortMerge={this.props.abortMerge}
          currentBranch={this.props.currentBranch}
          workspace={this.props.workspace}
          commands={this.props.commands}
          notificationManager={this.props.notificationManager}
          grammars={this.props.grammars}
          mergeMessage={this.props.mergeMessage}
          isMerging={this.props.isMerging}
          isLoading={this.props.isLoading}
          lastCommit={this.props.lastCommit}
          repository={this.props.repository}
          userStore={this.props.userStore}
          selectedCoAuthors={this.props.selectedCoAuthors}
          updateSelectedCoAuthors={this.props.updateSelectedCoAuthors}
        />
        <RecentCommitsController
          ref={this.refRecentCommitsController.setter}
          commands={this.props.commands}
          commits={this.props.recentCommits}
          hasMoreCommits={this.props.hasMoreRecentCommits}
          loadMoreCommits={this.props.loadMoreRecentCommits}
          isLoading={this.props.isLoading}
          undoLastCommit={this.props.undoLastCommit}
          checkout={this.props.checkout}
          workspace={this.props.workspace}
          repository={this.props.repository}
        />
      </Fragment>
    );
  }

  renderTooLarge() {
    return (
      <div className="git-panel-Git too-many-changes">
        <div className="git-panel-Git-LargeIcon icon icon-diff" />
        <h1>Too many changes</h1>
        <div className="initialize-repo-description">
          The repository at <strong>{this.props.workingDirectoryPath}</strong> has too many changed
          files to display in {atom.branding.name}. Ensure that you have set up an appropriate{" "}
          <code>.gitignore</code> file.
        </div>
      </div>
    );
  }

  renderUnsupportedDir() {
    return (
      <div className="git-panel-Git unsupported-directory">
        <div className="git-panel-Git-LargeIcon icon icon-alert" />
        <h1>Unsupported directory</h1>
        <div className="initialize-repo-description">
          {atom.branding.name} does not support managing Git repositories in your home or root
          directories.
        </div>
      </div>
    );
  }

  renderNoRepo() {
    return (
      <div className="git-panel-Git no-repository">
        <div className="git-panel-Git-LargeIcon icon icon-repo" />
        <h1>Create Repository</h1>
        <div className="initialize-repo-description">
          {this.props.repository.hasDirectory() ? (
            <span>
              Initialize <strong>{this.props.workingDirectoryPath}</strong> with a Git repository
            </span>
          ) : (
            <span>Initialize a new project directory with a Git repository</span>
          )}
        </div>
        <button
          onClick={this.initializeRepo}
          disabled={this.props.repository.showGitTabInitInProgress()}
          className="btn btn-primary"
        >
          {this.props.repository.showGitTabInitInProgress()
            ? "Creating repository..."
            : "Create repository"}
        </button>
        <button
          onClick={this.cloneRepo}
          disabled={this.props.repository.showGitTabInitInProgress()}
          className="btn"
        >
          Clone repository
        </button>
      </div>
    );
  }

  renderIdentityView() {
    return (
      <GitIdentityView
        usernameBuffer={this.props.usernameBuffer}
        emailBuffer={this.props.emailBuffer}
        canWriteLocal={this.props.repository.isPresent()}
        setLocal={this.props.setLocalIdentity}
        setGlobal={this.props.setGlobalIdentity}
        close={this.props.closeIdentityEditor}
      />
    );
  }

  componentWillUnmount() {
    this.subscriptions.dispose();
  }

  initializeRepo(event) {
    event.preventDefault();

    const workdir = this.props.repository.isAbsent()
      ? null
      : this.props.repository.getWorkingDirectoryPath();
    return this.props.openInitializeDialog(workdir);
  }

  cloneRepo(event) {
    event.preventDefault();
    return this.props.openCloneDialog();
  }

  getFocus(element) {
    for (const ref of [
      this.refHeaderController,
      this.props.refStagingView,
      this.refCommitController,
      this.refRecentCommitsController,
    ]) {
      const focus = ref.map((sub) => sub.getFocus(element)).getOr(null);
      if (focus !== null) {
        return focus;
      }
    }
    return null;
  }

  setFocus(focus) {
    for (const ref of [
      this.refHeaderController,
      this.props.refStagingView,
      this.refCommitController,
      this.refRecentCommitsController,
    ]) {
      if (ref.map((sub) => sub.setFocus(focus)).getOr(false)) {
        return true;
      }
    }

    if (focus === GitTabView.focus.STAGING) {
      return this.setFocus(this.getFirstStagingFocus() || GitTabView.focus.EDITOR);
    }

    return false;
  }

  blur() {
    this.props.workspace.getCenter().activate();
  }

  closePanel() {
    const uri = "atom-github://dock-item/git";
    const pane = this.props.workspace.paneForURI(uri);
    if (pane) {
      const item = pane.itemForURI(uri);
      if (item) {
        pane.destroyItem(item);
      }
    }
  }

  async advanceFocus(evt) {
    const currentFocus = this.getFocus(document.activeElement);

    let next = null;
    if (currentFocus === GitTabView.focus.PROJECT) {
      next = this.getFirstStagingFocus() || GitTabView.focus.EDITOR;
    } else if (this.isStagingFocus(currentFocus)) {
      next = await this.props.refStagingView
        .map((view) => view.advanceFocusFrom(currentFocus))
        .getOr(null);
    } else if (this.isCommitFocus(currentFocus)) {
      next = await this.refCommitController
        .map((view) => view.advanceFocusFrom(currentFocus))
        .getOr(null);
      next = next || GitTabView.focus.RECENT_COMMIT;
    } else if (currentFocus === GitTabView.focus.RECENT_COMMIT) {
      next = GitTabView.focus.PROJECT;
    } else {
      next = GitTabView.focus.PROJECT;
    }

    if (next !== null) {
      evt.stopPropagation();
      if (next !== currentFocus) {
        this.setFocus(next);
      }
    }
  }

  async retreatFocus(evt) {
    const currentFocus = this.getFocus(document.activeElement);

    let previous = null;
    if (currentFocus === GitTabView.focus.PROJECT) {
      previous = GitTabView.focus.RECENT_COMMIT;
    } else if (this.isStagingFocus(currentFocus)) {
      previous = await this.props.refStagingView
        .map((view) => view.retreatFocusFrom(currentFocus))
        .getOr(null);
      previous = previous || GitTabView.focus.PROJECT;
    } else if (this.isCommitFocus(currentFocus)) {
      previous = await this.refCommitController
        .map((view) => view.retreatFocusFrom(currentFocus))
        .getOr(null);
      previous = previous || this.getLastStagingFocus() || GitTabView.focus.PROJECT;
    } else if (currentFocus === GitTabView.focus.RECENT_COMMIT) {
      previous = await this.refRecentCommitsController
        .map((view) => view.retreatFocusFrom(currentFocus))
        .getOr(null);
      previous = previous || GitTabView.focus.EDITOR;
    } else {
      previous = GitTabView.focus.RECENT_COMMIT;
    }

    if (previous !== null) {
      evt.stopPropagation();
      if (previous !== currentFocus) {
        this.setFocus(previous);
      }
    }
  }

  focusProject(evt) {
    if (this.abortFromTextEditor(evt)) {
      return;
    }
    evt.stopPropagation();
    this.setFocus(GitTabView.focus.PROJECT);
  }

  focusUnstaged(evt) {
    if (this.abortFromTextEditor(evt)) {
      return;
    }
    evt.stopPropagation();
    this.setFocus(GitTabView.focus.UNSTAGED);
  }

  focusStaged(evt) {
    if (this.abortFromTextEditor(evt)) {
      return;
    }
    evt.stopPropagation();
    this.setFocus(GitTabView.focus.STAGED);
  }

  focusCommit(evt) {
    if (this.abortFromTextEditor(evt)) {
      return;
    }
    evt.stopPropagation();
    this.setFocus(GitTabView.focus.EDITOR);
  }

  focusRecentCommits(evt) {
    if (this.abortFromTextEditor(evt)) {
      return;
    }
    evt.stopPropagation();
    this.setFocus(GitTabView.focus.RECENT_COMMIT);
  }

  abortFromTextEditor(evt) {
    if (!evt.target || !evt.target.closest("atom-text-editor")) {
      return false;
    }

    evt.abortKeyBinding();
    return true;
  }

  isStagingFocus(focus) {
    return this.props.refStagingView.map((view) => view.isStagingFocus(focus)).getOr(false);
  }

  getFirstStagingFocus() {
    return this.props.refStagingView.map((view) => view.getFirstFocus()).getOr(null);
  }

  getLastStagingFocus() {
    return this.props.refStagingView.map((view) => view.getLastFocus()).getOr(null);
  }

  isCommitFocus(focus) {
    return [
      GitTabView.focus.COMMIT_PREVIEW_BUTTON,
      GitTabView.focus.EDITOR,
      GitTabView.focus.COAUTHOR_INPUT,
      GitTabView.focus.ABORT_MERGE_BUTTON,
      GitTabView.focus.COMMIT_BUTTON,
    ].includes(focus);
  }

  async focusAndSelectStagingItem(filePath, stagingStatus) {
    await this.quietlySelectItem(filePath, stagingStatus);
    this.setFocus(GitTabView.focus.STAGING);
  }

  focusAndSelectRecentCommit() {
    this.setFocus(RecentCommitsController.focus.RECENT_COMMIT);
  }

  focusAndSelectCommitPreviewButton() {
    this.setFocus(GitTabView.focus.COMMIT_PREVIEW_BUTTON);
  }

  quietlySelectItem(filePath, stagingStatus) {
    return this.props.refStagingView
      .map((view) => view.quietlySelectItem(filePath, stagingStatus))
      .getOr(false);
  }

  hasFocus() {
    return this.props.refRoot.map((root) => root.contains(document.activeElement)).getOr(false);
  }
}
