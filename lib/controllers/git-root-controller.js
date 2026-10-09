/** @babel */
/** @jsx h */
import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { View, h, Fragment } from "../etch/view";
import { CompositeDisposable } from "lumine";

import PaneItem from "../lumine/pane-item";
import { openCommitDetailItem } from "../views/open-commit-dialog";
import ChangedFileItem from "../items/changed-file-item";
import CommitDetailItem from "../items/commit-detail-item";
import CommitPreviewItem from "../items/commit-preview-item";
import GitTabItem from "../items/git-tab-item";
import DialogsController, { dialogRequests } from "./dialogs-controller";
import RepositoryConflictController from "./repository-conflict-controller";
import GitCacheView from "../views/git-cache-view";
import GitTimingsView from "../views/git-timings-view";
import Conflict from "../models/conflicts/conflict";
import { keyForPath } from "../models/conflicts/resolution-progress";
import { Keys } from "../models/repository-states/cache/keys";
import {
  destroyFilePatchPaneItems,
  destroyEmptyFilePatchPaneItems,
  autobind,
  withBusyMessage,
} from "../helpers";
import { isGitError } from "../git-errors";
import { resolveRepositoryForDirectory, resolveRepositoryForPath } from "../repository-api";

export default class GitRootController extends View {
  constructor(props, children) {
    super(props, children);
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

    this.initialize();
  }

  willDestroy() {
    this.subscription.dispose();
  }

  didUpdate(prevProps) {
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
    return h(
      "span",
      { style: { display: "contents" } },
      <Fragment>
        {this.renderPaneItems()}
        {this.renderDialogs()}
        {this.renderConflictResolver()}
      </Fragment>,
    );
  }

  renderDialogs() {
    return (
      <DialogsController
        request={this.state.dialogRequest}
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
          createPaneItem={this.props.createGitPaneItem}
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
              busySignal={this.props.busySignal}
              discardWorkDirChangesForPaths={this.discardWorkDirChangesForPaths}
              undoLastDiscard={this.undoLastDiscard}
              refreshResolutionProgress={this.refreshResolutionProgress}
              currentWorkDir={this.props.currentWorkDir}
            />
          )}
        </PaneItem>
        <PaneItem
          workspace={this.props.workspace}
          uriPattern={ChangedFileItem.uriPattern}
          className="git-panel-FilePatch-root"
          createPaneItem={this.props.createFilePatchPaneItem}
        >
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
          createPaneItem={this.props.createCommitPreviewPaneItem}
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
          createPaneItem={this.props.createCommitDetailPaneItem}
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
        <PaneItem
          workspace={this.props.workspace}
          uriPattern={GitTimingsView.uriPattern}
          className="git-panel-GitTimings-root"
          createPaneItem={this.props.createGitTimingsPaneItem}
        >
          {({ itemHolder }) => <GitTimingsView ref={itemHolder.setter} />}
        </PaneItem>
        <PaneItem
          workspace={this.props.workspace}
          uriPattern={GitCacheView.uriPattern}
          className="git-panel-GitCache-root"
          createPaneItem={this.props.createGitCachePaneItem}
        >
          {({ itemHolder }) => (
            <GitCacheView ref={itemHolder.setter} repository={this.props.repository} />
          )}
        </PaneItem>
      </Fragment>
    );
  }

  closeDialog = () => this.updateState({ dialogRequest: dialogRequests.null });

  openInitializeDialog = async (dirPath) => {
    const activeEditorPath = this.props.workspace.getActiveTextEditor()?.getPath();
    if (activeEditorPath && this.props.repository.showGitTabInit()) {
      dirPath = path.dirname(activeEditorPath);
    }

    if (!dirPath) {
      if (activeEditorPath) {
        const [projectPath] = this.props.project.relativizePath(activeEditorPath);
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

    return this.updateState({ dialogRequest });
  };

  openCloneDialog = (opts) => {
    const dialogRequest = dialogRequests.clone(opts);
    dialogRequest.onProgressingAccept(async (url, chosenPath, sourceRemoteName) => {
      await this.props.clone(url, chosenPath, sourceRemoteName);
      await this.closeDialog();
    });
    dialogRequest.onCancel(this.closeDialog);

    return this.updateState({ dialogRequest });
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

    return this.updateState({ dialogRequest });
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

  async viewChangesForCurrentFile(stagingStatus, event) {
    const registry = this.props.repositories;
    const context = registry.getCommandContext(event, { scope: "file" });
    const editor = context.editor;
    if (!editor) return;
    if (!editor.getPath()) {
      this.props.notificationManager.addWarning("Save the file before viewing its Git changes.");
      return;
    }

    const absFilePath = await fs.realpath(editor.getPath());
    const repository =
      context.repository || (await resolveRepositoryForPath(registry, absFilePath));
    const repoPath = repository?.getWorkingDirectory() || null;
    if (repoPath === null) {
      const [projectPath] = this.props.project.relativizePath(editor.getPath());
      const notification = this.props.notificationManager.addWarning(
        "This file is outside a Git repository.",
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
                const createdPath = await this.props.initialize(projectPath);
                // If the user confirmed repository creation for this project path,
                // retry the operation that got them here in the first place
                if (!this.destroyed && createdPath === projectPath) {
                  this.viewChangesForCurrentFile(stagingStatus, event);
                }
              },
            },
          ],
        },
      );
      return;
    }
    {
      const filePath = path.normalize(repository.posixRelativePath(absFilePath));
      if (this.props.repository.getWorkingDirectoryPath() === repoPath)
        this.quietlySelectItem(filePath, stagingStatus);
      const splitDirection = this.props.config.get(
        "git-panel.viewChangesForCurrentFileDiffPaneSplitDirection",
      );
      const pane =
        this.props.workspace.paneForItem?.(editor) || this.props.workspace.getActivePane();
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
      // An open can decline, e.g. when the workspace center is full.
      if (!item) return;
      const view = await item.whenHydrated();
      if (!view) return;
      await view.getFilePatchLoadedPromise();
      if (view.destroyed) return;
      view.goToDiffLine(lineNum);
      view.focus();
    }
  }

  viewUnstagedChangesForCurrentFile(event) {
    return this.viewChangesForCurrentFile("unstaged", event);
  }

  viewStagedChangesForCurrentFile(event) {
    return this.viewChangesForCurrentFile("staged", event);
  }

  async openFiles(filePaths, repository = this.props.repository, { split } = {}) {
    const { workspace } = this.props;
    if (!split) {
      return Promise.all(
        filePaths.map((filePath) => {
          const absolutePath = path.join(repository.getWorkingDirectoryPath(), filePath);
          return workspace.open(absolutePath, { pending: filePaths.length === 1 });
        }),
      );
    }

    if (filePaths.length === 0) return [];

    let pane = workspace.getCenter().getActivePane();
    const items = [];
    for (const filePath of filePaths) {
      const absolutePath = path.join(repository.getWorkingDirectoryPath(), filePath);
      const item = await workspace.open(absolutePath, {
        pane,
        ...(items.length === 0 ? { split } : {}),
        pending: filePaths.length === 1,
      });
      if (!item) break;
      items.push(item);
      pane = workspace.paneForItem(item);
    }
    return items;
  }

  getUnsavedFiles(filePaths, workdirPath) {
    const hasUnsavedChangesByPath = new Map();
    this.props.workspace.getTextEditors().forEach((editor) => {
      hasUnsavedChangesByPath.set(editor.getPath(), editor.getFileState() !== "unmodified");
    });
    return filePaths.filter((filePath) => {
      const absFilePath = path.join(workdirPath, filePath);
      return hasUnsavedChangesByPath.get(absFilePath);
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
    const { repository, busySignal } = this.props;
    const destructiveAction = () => {
      return repository.discardWorkDirChangesForPaths(filePaths);
    };
    const label = filePaths.length === 1 ? "1 file" : `${filePaths.length} files`;
    return await withBusyMessage(busySignal, `Discarding ${label}`, () =>
      repository.storeBeforeAndAfterBlobs(
        filePaths,
        () =>
          this.ensureNoUnsavedFiles(
            filePaths,
            "Cannot discard changes in selected files.",
            repository.getWorkingDirectoryPath(),
          ),
        destructiveAction,
      ),
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
      try {
        await repository.applyPatchToWorkdir(discardFilePatch);
      } finally {
        discardFilePatch.dispose();
      }
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

  getFilePathsForLastDiscard(partialDiscardFilePath = null, repository = this.props.repository) {
    let lastSnapshots = repository.getLastHistorySnapshots(partialDiscardFilePath);
    if (partialDiscardFilePath) {
      lastSnapshots = lastSnapshots ? [lastSnapshots] : [];
    }
    return lastSnapshots.map((snapshot) => snapshot.filePath);
  }

  async undoLastDiscard(partialDiscardFilePath = null, repository = this.props.repository) {
    const filePaths = this.getFilePathsForLastDiscard(partialDiscardFilePath, repository);
    try {
      const results = await withBusyMessage(
        this.props.busySignal,
        "Restoring discarded changes",
        () =>
          repository.restoreLastDiscardInTempFiles(
            () =>
              this.ensureNoUnsavedFiles(
                filePaths,
                "Cannot undo last discard.",
                repository.getWorkingDirectoryPath(),
              ),
            partialDiscardFilePath,
          ),
      );
      if (results.length === 0) {
        return;
      }
      await this.proceedOrPromptBasedOnResults(results, partialDiscardFilePath, repository);
    } catch (e) {
      if (isGitError(e) && (e.stderr || "").match(/fatal: Not a valid object name/)) {
        this.cleanUpHistoryForFilePaths(filePaths, partialDiscardFilePath, repository);
      } else {
        console.error(e);
      }
    }
  }

  async proceedOrPromptBasedOnResults(
    results,
    partialDiscardFilePath = null,
    repository = this.props.repository,
  ) {
    const conflicts = results.filter(({ conflict }) => conflict);
    if (conflicts.length === 0) {
      await this.proceedWithLastDiscardUndo(results, partialDiscardFilePath, repository);
    } else {
      await this.promptAboutConflicts(results, conflicts, partialDiscardFilePath, repository);
    }
  }

  async promptAboutConflicts(
    results,
    conflicts,
    partialDiscardFilePath = null,
    repository = this.props.repository,
  ) {
    const conflictedFiles = conflicts.map(({ filePath }) => `\t${filePath}`).join("\n");
    const choice = await this.props.confirm({
      message: "Undoing will result in conflicts...",
      detail:
        `for the following files:\n${conflictedFiles}\n` +
        "Would you like to apply the changes with merge conflict markers, " +
        "or open the text with merge conflict markers in a new file?",
      buttons: ["Merge with conflict markers", "Open in new file", "Cancel"],
    });
    if (choice === 0) {
      await this.proceedWithLastDiscardUndo(results, partialDiscardFilePath, repository);
    } else if (choice === 1) {
      await this.openConflictsInNewEditors(conflicts.map(({ resultPath }) => resultPath));
    }
  }

  cleanUpHistoryForFilePaths(
    filePaths,
    partialDiscardFilePath = null,
    repository = this.props.repository,
  ) {
    repository.clearDiscardHistory(partialDiscardFilePath);
    const filePathsStr = filePaths.map((filePath) => `\`${filePath}\``).join("<br>");
    this.props.notificationManager.addError("Discard history has expired.", {
      description: `Cannot undo discard for<br>${filePathsStr}<br>Stale discard history has been deleted.`,
      dismissable: true,
    });
  }

  async proceedWithLastDiscardUndo(
    results,
    partialDiscardFilePath = null,
    repository = this.props.repository,
  ) {
    const promises = results.map(async (result) => {
      const { filePath, resultPath, deleted, conflict, theirsSha, commonBaseSha, currentSha } =
        result;
      const absFilePath = path.join(repository.getWorkingDirectoryPath(), filePath);
      if (deleted && resultPath === null) {
        await fs.rm(absFilePath, { recursive: true, force: true });
      } else {
        await fs.cp(resultPath, absFilePath);
      }
      if (conflict) {
        await repository.writeMergeConflictToIndex(filePath, commonBaseSha, currentSha, theirsSha);
      }
    });
    await Promise.all(promises);
    // The fs restore above bypasses the repository model, so invalidate the
    // restored paths directly instead of waiting for the watcher round trip.
    const restoredPaths = results.map(({ filePath }) => filePath);
    repository.observeStatusChange();
    repository.acceptInvalidation(() => Keys.workdirOperationKeys(restoredPaths));
    await repository.popDiscardHistory(partialDiscardFilePath);
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
  async refreshResolutionProgress(fullPath) {
    if (!this.resolutionProgressRefreshes) this.resolutionProgressRefreshes = new Map();
    const key = keyForPath(fullPath);
    const readStream = createReadStream(fullPath, { encoding: "utf8" });
    const refresh = { readStream };
    this.resolutionProgressRefreshes.get(key)?.readStream.destroy();
    this.resolutionProgressRefreshes.set(key, refresh);
    try {
      const count = await Conflict.countFromStream(readStream);
      if (this.resolutionProgressRefreshes.get(key) === refresh) {
        this.props.resolutionProgress.reportDiskMarkerCount(fullPath, count);
      }
      return count;
    } catch (error) {
      if (this.resolutionProgressRefreshes.get(key) !== refresh) return null;
      if (error.code === "ENOENT") {
        this.props.resolutionProgress.reportDiskMarkerCount(fullPath, 0);
        return 0;
      }
      this.props.notificationManager.addError(`Unable to inspect merge conflicts in ${fullPath}`, {
        detail: error.message,
        dismissable: true,
      });
      if (lumine.config.get("git-panel.debug")) console.error(error);
      return null;
    } finally {
      if (this.resolutionProgressRefreshes.get(key) === refresh) {
        this.resolutionProgressRefreshes.delete(key);
      }
    }
  }
}
