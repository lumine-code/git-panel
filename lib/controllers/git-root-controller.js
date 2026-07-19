/** @babel */
/** @jsx React.createElement */
import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";
import React, { Fragment } from "react";
import { CompositeDisposable } from "atom";

import StatusBar from "../atom/status-bar";
import PaneItem from "../atom/pane-item";
import { openCommitDetailItem } from "../views/open-commit-dialog";
import Commands, { Command } from "../atom/commands";
import ChangedFileItem from "../items/changed-file-item";
import CommitDetailItem from "../items/commit-detail-item";
import CommitPreviewItem from "../items/commit-preview-item";
import GitTabItem from "../items/git-tab-item";
import DialogsController, { dialogRequests } from "./dialogs-controller";
import StatusBarTileController from "./status-bar-tile-controller";
import RepositoryConflictController from "./repository-conflict-controller";
import GitCacheView from "../views/git-cache-view";
import GitTimingsView from "../views/git-timings-view";
import Conflict from "../models/conflicts/conflict";
import { destroyFilePatchPaneItems, destroyEmptyFilePatchPaneItems, autobind } from "../helpers";
import { GitError } from "../git-errors";
import { resolveRepositoryForDirectory } from "../repository-api";

export default class GitRootController extends React.Component {
  constructor(props) {
    super(props);
    autobind(
      this,
      "showWaterfallDiagnostics",
      "showCacheDiagnostics",
      "destroyFilePatchPaneItems",
      "destroyEmptyFilePatchPaneItems",
      "quietlySelectItem",
      "viewUnstagedChangesForCurrentFile",
      "viewStagedChangesForCurrentFile",
      "openFiles",
      "getUnsavedFiles",
      "ensureNoUnsavedFiles",
      "discardWorkDirChangesForPaths",
      "discardLines",
      "undoLastDiscard",
      "refreshResolutionProgress",
    );

    this.state = {
      dialogRequest: dialogRequests.null,
    };

    this.subscription = new CompositeDisposable();
    if (!this.props.repository.isDestroyed()) {
      this.subscription.add(
        this.props.repository.onPullError(this.props.gitTabTracker.ensureVisible),
      );
    }
  }

  componentWillUnmount() {
    this.subscription.dispose();
  }

  componentDidUpdate(prevProps) {
    if (prevProps.repository !== this.props.repository) {
      this.subscription.dispose();
      this.subscription = new CompositeDisposable();
      if (!this.props.repository.isDestroyed()) {
        this.subscription.add(
          this.props.repository.onPullError(() => this.props.gitTabTracker.ensureVisible()),
        );
      }
    }
  }

  render() {
    return (
      <Fragment>
        {this.renderCommands()}
        {this.renderStatusBarTile()}
        {this.renderPaneItems()}
        {this.renderDialogs()}
        {this.renderConflictResolver()}
      </Fragment>
    );
  }

  renderStatusBarTile() {
    return (
      <StatusBar
        statusBar={this.props.statusBar}
        onConsumeStatusBar={(sb) => this.onConsumeStatusBar(sb)}
        className="git-panel-StatusBarTileController"
      >
        <StatusBarTileController
          workspace={this.props.workspace}
          repository={this.props.repository}
          commands={this.props.commands}
          tooltips={this.props.tooltips}
          toggleGitTab={this.props.gitTabTracker.toggle}
        />
      </StatusBar>
    );
  }

  renderCommands() {
    return (
      <Commands registry={this.props.commands} target="atom-workspace">
        <Command
          command="git-panel:toggle-commit-preview"
          callback={this.toggleCommitPreviewItem}
        />
        <Command
          command="git-panel:show-waterfall-diagnostics"
          callback={this.showWaterfallDiagnostics}
        />
        <Command command="git-panel:show-cache-diagnostics" callback={this.showCacheDiagnostics} />
        <Command command="git-panel:toggle-git-tab" callback={this.props.gitTabTracker.toggle} />
        <Command command="git-panel:toggle-focus" callback={this.props.gitTabTracker.toggleFocus} />
        <Command command="git-panel:initialize" callback={() => this.openInitializeDialog()} />
        <Command command="git-panel:clone" callback={() => this.openCloneDialog()} />
        <Command command="git-panel:open-commit" callback={() => this.openCommitDialog()} />
        <Command
          command="git-panel:view-unstaged-changes-for-current-file"
          callback={this.viewUnstagedChangesForCurrentFile}
        />
        <Command
          command="git-panel:view-staged-changes-for-current-file"
          callback={this.viewStagedChangesForCurrentFile}
        />
        <Command
          command="git-panel:close-all-diff-views"
          callback={this.destroyFilePatchPaneItems}
        />
        <Command
          command="git-panel:close-empty-diff-views"
          callback={this.destroyEmptyFilePatchPaneItems}
        />
      </Commands>
    );
  }

  renderDialogs() {
    return (
      <DialogsController
        request={this.state.dialogRequest}
        currentWindow={this.props.currentWindow}
        workspace={this.props.workspace}
        commands={this.props.commands}
        config={this.props.config}
      />
    );
  }

  renderConflictResolver() {
    if (!this.props.repository) {
      return null;
    }

    return (
      <RepositoryConflictController
        workspace={this.props.workspace}
        config={this.props.config}
        repository={this.props.repository}
        resolutionProgress={this.props.resolutionProgress}
        refreshResolutionProgress={this.refreshResolutionProgress}
        commands={this.props.commands}
      />
    );
  }

  renderPaneItems() {
    return (
      <Fragment>
        <PaneItem
          workspace={this.props.workspace}
          uriPattern={GitTabItem.uriPattern}
          className="git-panel-Git-root"
        >
          {({ itemHolder }) => (
            <GitTabItem
              ref={itemHolder.setter}
              workspace={this.props.workspace}
              commands={this.props.commands}
              notificationManager={this.props.notificationManager}
              tooltips={this.props.tooltips}
              grammars={this.props.grammars}
              project={this.props.project}
              confirm={this.props.confirm}
              config={this.props.config}
              repository={this.props.repository}
              openInitializeDialog={this.openInitializeDialog}
              openCloneDialog={this.openCloneDialog}
              resolutionProgress={this.props.resolutionProgress}
              ensureGitTab={this.props.gitTabTracker.ensureVisible}
              openFiles={this.openFiles}
              discardWorkDirChangesForPaths={this.discardWorkDirChangesForPaths}
              undoLastDiscard={this.undoLastDiscard}
              refreshResolutionProgress={this.refreshResolutionProgress}
              currentWorkDir={this.props.currentWorkDir}
            />
          )}
        </PaneItem>
        <PaneItem workspace={this.props.workspace} uriPattern={ChangedFileItem.uriPattern}>
          {({ itemHolder, params }) => (
            <ChangedFileItem
              ref={itemHolder.setter}
              workdirContextPool={this.props.workdirContextPool}
              relPath={path.join(...params.relPath)}
              workingDirectory={params.workingDirectory}
              stagingStatus={params.stagingStatus}
              tooltips={this.props.tooltips}
              commands={this.props.commands}
              keymaps={this.props.keymaps}
              workspace={this.props.workspace}
              config={this.props.config}
              discardLines={this.discardLines}
              undoLastDiscard={this.undoLastDiscard}
              surfaceFileAtPath={this.surfaceFromFileAtPath}
            />
          )}
        </PaneItem>
        <PaneItem
          workspace={this.props.workspace}
          uriPattern={CommitPreviewItem.uriPattern}
          className="git-panel-CommitPreview-root"
        >
          {({ itemHolder, params }) => (
            <CommitPreviewItem
              ref={itemHolder.setter}
              workdirContextPool={this.props.workdirContextPool}
              workingDirectory={params.workingDirectory}
              workspace={this.props.workspace}
              commands={this.props.commands}
              keymaps={this.props.keymaps}
              tooltips={this.props.tooltips}
              config={this.props.config}
              discardLines={this.discardLines}
              undoLastDiscard={this.undoLastDiscard}
              surfaceToCommitPreviewButton={this.surfaceToCommitPreviewButton}
            />
          )}
        </PaneItem>
        <PaneItem
          workspace={this.props.workspace}
          uriPattern={CommitDetailItem.uriPattern}
          className="git-panel-CommitDetail-root"
        >
          {({ itemHolder, params }) => (
            <CommitDetailItem
              ref={itemHolder.setter}
              workdirContextPool={this.props.workdirContextPool}
              workingDirectory={params.workingDirectory}
              workspace={this.props.workspace}
              commands={this.props.commands}
              keymaps={this.props.keymaps}
              tooltips={this.props.tooltips}
              config={this.props.config}
              sha={params.sha}
              surfaceCommit={this.surfaceToRecentCommit}
            />
          )}
        </PaneItem>
        <PaneItem workspace={this.props.workspace} uriPattern={GitTimingsView.uriPattern}>
          {({ itemHolder }) => <GitTimingsView ref={itemHolder.setter} />}
        </PaneItem>
        <PaneItem workspace={this.props.workspace} uriPattern={GitCacheView.uriPattern}>
          {({ itemHolder }) => (
            <GitCacheView ref={itemHolder.setter} repository={this.props.repository} />
          )}
        </PaneItem>
      </Fragment>
    );
  }

  onConsumeStatusBar(statusBar) {
    if (statusBar.disableGitInfoTile) {
      statusBar.disableGitInfoTile();
    }
  }

  closeDialog = () =>
    new Promise((resolve) => this.setState({ dialogRequest: dialogRequests.null }, resolve));

  openInitializeDialog = async (dirPath) => {
    if (!dirPath) {
      const activeEditor = this.props.workspace.getActiveTextEditor();
      if (activeEditor) {
        const [projectPath] = this.props.project.relativizePath(activeEditor.getPath());
        if (projectPath) {
          dirPath = projectPath;
        }
      }
    }

    if (!dirPath) {
      const directories = this.props.project.getDirectories();
      const withRepositories = await Promise.all(
        directories.map(async (directory) => [
          directory,
          await resolveRepositoryForDirectory(this.props.repositories, directory),
        ]),
      );
      const firstUninitialized = withRepositories.find(([d, r]) => !r);
      if (firstUninitialized && firstUninitialized[0]) {
        dirPath = firstUninitialized[0].getPath();
      }
    }

    if (!dirPath) {
      dirPath = this.props.config.get("core.projectHome");
    }

    const dialogRequest = dialogRequests.init({ dirPath });
    dialogRequest.onProgressingAccept(async (chosenPath) => {
      await this.props.initialize(chosenPath);
      await this.closeDialog();
    });
    dialogRequest.onCancel(this.closeDialog);

    return new Promise((resolve) => this.setState({ dialogRequest }, resolve));
  };

  openCloneDialog = (opts) => {
    const dialogRequest = dialogRequests.clone(opts);
    dialogRequest.onProgressingAccept(async (url, chosenPath, sourceRemoteName) => {
      await this.props.clone(url, chosenPath, sourceRemoteName);
      await this.closeDialog();
    });
    dialogRequest.onCancel(this.closeDialog);

    return new Promise((resolve) => this.setState({ dialogRequest }, resolve));
  };

  openCommitDialog = () => {
    const dialogRequest = dialogRequests.commit();
    dialogRequest.onProgressingAccept(async (ref) => {
      await openCommitDetailItem(ref, {
        workspace: this.props.workspace,
        repository: this.props.repository,
      });
      await this.closeDialog();
    });
    dialogRequest.onCancel(this.closeDialog);

    return new Promise((resolve) => this.setState({ dialogRequest }, resolve));
  };

  toggleCommitPreviewItem = () => {
    const workdir = this.props.repository.getWorkingDirectoryPath();
    return this.props.workspace.toggle(CommitPreviewItem.buildURI(workdir));
  };

  showWaterfallDiagnostics() {
    this.props.workspace.open(GitTimingsView.buildURI());
  }

  showCacheDiagnostics() {
    this.props.workspace.open(GitCacheView.buildURI());
  }

  surfaceFromFileAtPath = (filePath, stagingStatus) => {
    const gitTab = this.props.gitTabTracker.getComponent();
    return gitTab && gitTab.focusAndSelectStagingItem(filePath, stagingStatus);
  };

  surfaceToCommitPreviewButton = () => {
    const gitTab = this.props.gitTabTracker.getComponent();
    return gitTab && gitTab.focusAndSelectCommitPreviewButton();
  };

  surfaceToRecentCommit = () => {
    const gitTab = this.props.gitTabTracker.getComponent();
    return gitTab && gitTab.focusAndSelectRecentCommit();
  };

  destroyFilePatchPaneItems() {
    destroyFilePatchPaneItems({ onlyStaged: false }, this.props.workspace);
  }

  destroyEmptyFilePatchPaneItems() {
    destroyEmptyFilePatchPaneItems(this.props.workspace);
  }

  quietlySelectItem(filePath, stagingStatus) {
    const gitTab = this.props.gitTabTracker.getComponent();
    return gitTab && gitTab.quietlySelectItem(filePath, stagingStatus);
  }

  async viewChangesForCurrentFile(stagingStatus) {
    const editor = this.props.workspace.getActiveTextEditor();
    if (!editor.getPath()) {
      return;
    }

    const absFilePath = await fs.realpath(editor.getPath());
    const repoPath = this.props.repository.getWorkingDirectoryPath();
    if (repoPath === null) {
      const [projectPath] = this.props.project.relativizePath(editor.getPath());
      const notification = this.props.notificationManager.addInfo(
        "Hmm, there's nothing to compare this file to",
        {
          description:
            "You can create a Git repository to track changes to the files in your project.",
          dismissable: true,
          buttons: [
            {
              className: "btn btn-primary",
              text: "Create a repository now",
              onDidClick: async () => {
                notification.dismiss();
                const createdPath = await this.initializeRepo(projectPath);
                // If the user confirmed repository creation for this project path,
                // retry the operation that got them here in the first place
                if (createdPath === projectPath) {
                  this.viewChangesForCurrentFile(stagingStatus);
                }
              },
            },
          ],
        },
      );
      return;
    }
    if (absFilePath.startsWith(repoPath)) {
      const filePath = absFilePath.slice(repoPath.length + 1);
      this.quietlySelectItem(filePath, stagingStatus);
      const splitDirection = this.props.config.get(
        "git-panel.viewChangesForCurrentFileDiffPaneSplitDirection",
      );
      const pane = this.props.workspace.getActivePane();
      if (splitDirection === "right") {
        pane.splitRight();
      } else if (splitDirection === "down") {
        pane.splitDown();
      }
      const lineNum = editor.getCursorBufferPosition().row + 1;
      const item = await this.props.workspace.open(
        ChangedFileItem.buildURI(filePath, repoPath, stagingStatus),
        {
          pending: true,
          activatePane: true,
          activateItem: true,
        },
      );
      await item.getRealItemPromise();
      await item.getFilePatchLoadedPromise();
      item.goToDiffLine(lineNum);
      item.focus();
    } else {
      throw new Error(`${absFilePath} does not belong to repo ${repoPath}`);
    }
  }

  viewUnstagedChangesForCurrentFile() {
    return this.viewChangesForCurrentFile("unstaged");
  }

  viewStagedChangesForCurrentFile() {
    return this.viewChangesForCurrentFile("staged");
  }

  openFiles(filePaths, repository = this.props.repository) {
    return Promise.all(
      filePaths.map((filePath) => {
        const absolutePath = path.join(repository.getWorkingDirectoryPath(), filePath);
        return this.props.workspace.open(absolutePath, { pending: filePaths.length === 1 });
      }),
    );
  }

  getUnsavedFiles(filePaths, workdirPath) {
    const isModifiedByPath = new Map();
    this.props.workspace.getTextEditors().forEach((editor) => {
      isModifiedByPath.set(editor.getPath(), editor.isModified());
    });
    return filePaths.filter((filePath) => {
      const absFilePath = path.join(workdirPath, filePath);
      return isModifiedByPath.get(absFilePath);
    });
  }

  ensureNoUnsavedFiles(
    filePaths,
    message,
    workdirPath = this.props.repository.getWorkingDirectoryPath(),
  ) {
    const unsavedFiles = this.getUnsavedFiles(filePaths, workdirPath)
      .map((filePath) => `\`${filePath}\``)
      .join("<br>");
    if (unsavedFiles.length) {
      this.props.notificationManager.addError(message, {
        description: `You have unsaved changes in:<br>${unsavedFiles}.`,
        dismissable: true,
      });
      return false;
    } else {
      return true;
    }
  }

  async discardWorkDirChangesForPaths(filePaths) {
    const destructiveAction = () => {
      return this.props.repository.discardWorkDirChangesForPaths(filePaths);
    };
    return await this.props.repository.storeBeforeAndAfterBlobs(
      filePaths,
      () => this.ensureNoUnsavedFiles(filePaths, "Cannot discard changes in selected files."),
      destructiveAction,
    );
  }

  async discardLines(multiFilePatch, lines, repository = this.props.repository) {
    // (kuychaco) For now we only support discarding rows for MultiFilePatches that contain a single file patch
    // The only way to access this method from the UI is to be in a ChangedFileItem, which only has a single file patch
    if (multiFilePatch.getFilePatches().length !== 1) {
      return Promise.resolve(null);
    }

    const filePath = multiFilePatch.getFilePatches()[0].getPath();
    const destructiveAction = async () => {
      const discardFilePatch = multiFilePatch.getUnstagePatchForLines(lines);
      await repository.applyPatchToWorkdir(discardFilePatch);
    };
    return await repository.storeBeforeAndAfterBlobs(
      [filePath],
      () =>
        this.ensureNoUnsavedFiles(
          [filePath],
          "Cannot discard lines.",
          repository.getWorkingDirectoryPath(),
        ),
      destructiveAction,
      filePath,
    );
  }

  getFilePathsForLastDiscard(partialDiscardFilePath = null) {
    let lastSnapshots = this.props.repository.getLastHistorySnapshots(partialDiscardFilePath);
    if (partialDiscardFilePath) {
      lastSnapshots = lastSnapshots ? [lastSnapshots] : [];
    }
    return lastSnapshots.map((snapshot) => snapshot.filePath);
  }

  async undoLastDiscard(partialDiscardFilePath = null, repository = this.props.repository) {
    const filePaths = this.getFilePathsForLastDiscard(partialDiscardFilePath);
    try {
      const results = await repository.restoreLastDiscardInTempFiles(
        () => this.ensureNoUnsavedFiles(filePaths, "Cannot undo last discard."),
        partialDiscardFilePath,
      );
      if (results.length === 0) {
        return;
      }
      await this.proceedOrPromptBasedOnResults(results, partialDiscardFilePath);
    } catch (e) {
      if (e instanceof GitError && e.stdErr.match(/fatal: Not a valid object name/)) {
        this.cleanUpHistoryForFilePaths(filePaths, partialDiscardFilePath);
      } else {
        // eslint-disable-next-line no-console
        console.error(e);
      }
    }
  }

  async proceedOrPromptBasedOnResults(results, partialDiscardFilePath = null) {
    const conflicts = results.filter(({ conflict }) => conflict);
    if (conflicts.length === 0) {
      await this.proceedWithLastDiscardUndo(results, partialDiscardFilePath);
    } else {
      await this.promptAboutConflicts(results, conflicts, partialDiscardFilePath);
    }
  }

  async promptAboutConflicts(results, conflicts, partialDiscardFilePath = null) {
    const conflictedFiles = conflicts.map(({ filePath }) => `\t${filePath}`).join("\n");
    const choice = this.props.confirm({
      message: "Undoing will result in conflicts...",
      detailedMessage:
        `for the following files:\n${conflictedFiles}\n` +
        "Would you like to apply the changes with merge conflict markers, " +
        "or open the text with merge conflict markers in a new file?",
      buttons: ["Merge with conflict markers", "Open in new file", "Cancel"],
    });
    if (choice === 0) {
      await this.proceedWithLastDiscardUndo(results, partialDiscardFilePath);
    } else if (choice === 1) {
      await this.openConflictsInNewEditors(conflicts.map(({ resultPath }) => resultPath));
    }
  }

  cleanUpHistoryForFilePaths(filePaths, partialDiscardFilePath = null) {
    this.props.repository.clearDiscardHistory(partialDiscardFilePath);
    const filePathsStr = filePaths.map((filePath) => `\`${filePath}\``).join("<br>");
    this.props.notificationManager.addError("Discard history has expired.", {
      description: `Cannot undo discard for<br>${filePathsStr}<br>Stale discard history has been deleted.`,
      dismissable: true,
    });
  }

  async proceedWithLastDiscardUndo(results, partialDiscardFilePath = null) {
    const promises = results.map(async (result) => {
      const { filePath, resultPath, deleted, conflict, theirsSha, commonBaseSha, currentSha } =
        result;
      const absFilePath = path.join(this.props.repository.getWorkingDirectoryPath(), filePath);
      if (deleted && resultPath === null) {
        await fs.rm(absFilePath, { recursive: true, force: true });
      } else {
        await fs.cp(resultPath, absFilePath);
      }
      if (conflict) {
        await this.props.repository.writeMergeConflictToIndex(
          filePath,
          commonBaseSha,
          currentSha,
          theirsSha,
        );
      }
    });
    await Promise.all(promises);
    await this.props.repository.popDiscardHistory(partialDiscardFilePath);
  }

  async openConflictsInNewEditors(resultPaths) {
    const editorPromises = resultPaths.map((resultPath) => {
      return this.props.workspace.open(resultPath);
    });
    return await Promise.all(editorPromises);
  }

  /*
   * Asynchronously count the conflict markers present in a file specified by full path.
   */
  refreshResolutionProgress(fullPath) {
    const readStream = createReadStream(fullPath, { encoding: "utf8" });
    return new Promise((resolve) => {
      Conflict.countFromStream(readStream).then((count) => {
        this.props.resolutionProgress.reportMarkerCount(fullPath, count);
      });
    });
  }
}
