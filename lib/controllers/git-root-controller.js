/** @babel */
/** @jsx h */
import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { View, h, Fragment } from "../etch/view.js";
import { CompositeDisposable } from "lumine";

import PaneItem from "../lumine/pane-item.js";
import { openCommitDetailItem } from "../views/open-commit-dialog.js";
import PatchItem from "../items/patch-item.js";
import PatchDocument from "../models/patch-document.js";
import GitTabItem from "../items/git-tab-item.js";
import DialogsController, { dialogRequests } from "./dialogs-controller.js";
import RepositoryConflictController from "./repository-conflict-controller.js";
import GitCacheView from "../views/git-cache-view.js";
import GitTimingsView from "../views/git-timings-view.js";
import Conflict from "../models/conflicts/conflict.js";
import { keyForPath } from "../models/conflicts/resolution-progress.js";
import { Keys } from "../models/repository-states/cache/keys.js";
import {
  destroyPatchPaneItems,
  destroyEmptyPatchPaneItems,
  autobind,
  withBusyMessage,
} from "../helpers.js";
import { isGitError } from "../git-errors.js";
import { resolveRepositoryForPath } from "../repository-api.js";
import openInNextPane from "../open-in-next-pane.js";
import commandAvailability from "../command-availability.js";

export default class GitRootController extends View {
  constructor(props, children) {
    super(props, children);
    autobind(
      this,
      "showWaterfallDiagnostics",
      "showCacheDiagnostics",
      "destroyPatchPaneItems",
      "destroyEmptyPatchPaneItems",
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

    this.gitTabRepositoryData = new WeakMap();

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
              repositoryDataCache={this.gitTabRepositoryData}
              startupContextPending={this.props.startupContextPending}
              repositorySetup={this.props.repositorySetup}
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
          uriPattern={PatchDocument.uriPattern}
          className="git-panel-Patch-root"
          createPaneItem={this.props.createPatchPaneItem}
          canReusePendingItem={(view, { document }) => view.canReusePendingItem(document)}
          reusePendingItem={(view, { document }, options) =>
            view.reusePendingItem(document, options)
          }
        >
          {({ itemHolder, params, deserialized }) => (
            <PatchItem
              ref={itemHolder.setter}
              workdirContextPool={this.props.workdirContextPool}
              document={params.document}
              presentationState={deserialized.presentationState}
              copySnapshot={deserialized.copySnapshot}
              tooltips={this.props.tooltips}
              commands={this.props.commands}
              keymaps={this.props.keymaps}
              workspace={this.props.workspace}
              config={this.props.config}
              discardLines={this.discardLines}
              undoLastDiscard={this.undoLastDiscard}
              surfaceDocument={this.surfaceDocument}
            />
          )}
        </PaneItem>
        <PaneItem
          workspace={this.props.workspace}
          uriPattern={GitTimingsView.uriPattern}
          className="git-panel-GitTimings-root"
          createPaneItem={this.props.createGitTimingsPaneItem}
        >
          {({ itemHolder, deserialized }) => (
            <GitTimingsView {...deserialized} ref={itemHolder.setter} />
          )}
        </PaneItem>
        <PaneItem
          workspace={this.props.workspace}
          uriPattern={GitCacheView.uriPattern}
          className="git-panel-GitCache-root"
          createPaneItem={this.props.createGitCachePaneItem}
        >
          {({ itemHolder, deserialized }) => (
            <GitCacheView
              {...deserialized}
              ref={itemHolder.setter}
              repository={this.props.repository}
            />
          )}
        </PaneItem>
      </Fragment>
    );
  }

  closeDialog = () => this.updateState({ dialogRequest: dialogRequests.null });

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
    if (!workdir) {
      this.props.notificationManager.addWarning(
        "Select a Git repository before previewing staged changes.",
      );
      return Promise.resolve();
    }
    const uri = PatchDocument.staged(workdir).getURI();
    if (this.props.workspace.hide(uri)) return Promise.resolve();
    return this.props.workspace.open(uri, { searchAllPanes: true, pending: true });
  };

  showWaterfallDiagnostics() {
    this.props.workspace.open(GitTimingsView.buildURI());
  }

  showCacheDiagnostics() {
    this.props.workspace.open(GitCacheView.buildURI());
  }

  surfaceDocument = async (document) => {
    await this.props.selectRepository(document.workingDirectory);
    if (this.destroyed) return;
    await this.props.gitTabTracker.ensureVisible();
    const gitTab = this.props.gitTabTracker.getComponent();
    if (!gitTab) return;
    if (document.kind === "file")
      return gitTab.focusAndSelectStagingItem(document.relPath, document.stagingStatus);
    if (document.kind === "staged-all") return gitTab.focusAndSelectCommitPreviewButton();
    return gitTab.focusAndSelectRecentCommit();
  };

  destroyPatchPaneItems() {
    destroyPatchPaneItems({ onlyStaged: false }, this.props.workspace);
  }

  destroyEmptyPatchPaneItems() {
    destroyEmptyPatchPaneItems(this.props.workspace);
  }

  quietlySelectItem(filePath, stagingStatus) {
    const gitTab = this.props.gitTabTracker.getComponent();
    return gitTab && gitTab.quietlySelectItem(filePath, stagingStatus);
  }

  async viewChangesForCurrentFile(stagingStatus, event) {
    const registry = this.props.repositories;
    const context = commandAvailability.fileContext(event, registry);
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
      const directoryPath = projectPath || path.dirname(absFilePath);
      const notification = this.props.notificationManager.addWarning(
        "This file is outside a Git repository.",
        {
          description:
            "You can create a Git repository to track changes to the files in your project.",
          dismissable: true,
          buttons: this.props.repositorySetup
            ? [
                {
                  className: "btn btn-primary",
                  text: "Create a repository now",
                  onDidClick: async () => {
                    notification.dismiss();
                    const repository = await this.props.repositorySetup?.openInitializeDialog({
                      event,
                      directoryPath,
                    });
                    const createdPath = repository?.getWorkingDirectory();
                    const normalize = (value) => {
                      const normalized = path.resolve(value);
                      return process.platform === "win32" ? normalized.toLowerCase() : normalized;
                    };
                    // If the user confirmed repository creation for this project path,
                    // retry the operation that got them here in the first place
                    if (
                      !this.destroyed &&
                      createdPath &&
                      normalize(createdPath) === normalize(directoryPath)
                    ) {
                      this.viewChangesForCurrentFile(stagingStatus, event);
                    }
                  },
                },
              ]
            : [],
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
        PatchDocument.file(repoPath, filePath, stagingStatus).getURI(),
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
      await view.getPatchLoadedPromise();
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

  async openFiles(filePaths, repository = this.props.repository, { split, nextPane } = {}) {
    const { workspace } = this.props;
    if (nextPane) {
      return openInNextPane(
        workspace,
        filePaths.map((filePath) => (options) => {
          const absolutePath = path.join(repository.getWorkingDirectoryPath(), filePath);
          return workspace.open(absolutePath, { pending: filePaths.length === 1, ...options });
        }),
      );
    }
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
    // Discard operates on the selected rows of one file.
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
