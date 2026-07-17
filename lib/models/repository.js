/** @babel */
import path from "path";

import { Emitter } from "atom";
import fs from "fs/promises";
import yubikiri from "yubikiri";

import { getNullActionPipelineManager } from "../action-pipeline";
import Author, { nullAuthor } from "./author";
import Branch from "./branch";
import { Loading, Absent, LoadingGuess, AbsentGuess } from "./repository-states";

const MERGE_MARKER_REGEX = /^(>|<){7} \S+$/m;

let CompositeGitStrategy;

function getCompositeGitStrategy() {
  if (!CompositeGitStrategy) {
    const compositeGitStrategyModule = require("../composite-git-strategy");
    CompositeGitStrategy = compositeGitStrategyModule.default || compositeGitStrategyModule;
  }
  return CompositeGitStrategy;
}

// Internal option keys used to designate the desired initial state of a Repository.
const initialStateSym = Symbol("initialState");

export default class Repository {
  constructor(workingDirectoryPath, gitStrategy = null, options = {}) {
    this.workingDirectoryPath = workingDirectoryPath;
    this._git = gitStrategy;
    this._promptCallback = null;

    this.emitter = new Emitter();

    this.loadPromise = new Promise((resolve) => {
      const sub = this.onDidChangeState(() => {
        if (!this.isLoading()) {
          resolve();
          sub.dispose();
        } else if (this.isDestroyed()) {
          sub.dispose();
        }
      });
    });

    this.pipelineManager = options.pipelineManager || getNullActionPipelineManager();
    this.transitionTo(options[initialStateSym] || Loading);
  }

  get git() {
    if (!this._git) {
      this._git = getCompositeGitStrategy().create(this.workingDirectoryPath);
      if (this._promptCallback) {
        this._git
          .getImplementers()
          .forEach((strategy) => strategy.setPromptCallback(this._promptCallback));
      }
    }
    return this._git;
  }

  destroyGitStrategy() {
    if (this._git && this._git.destroy) {
      this._git.destroy();
    }
  }

  static absent(options) {
    return new Repository(null, null, { [initialStateSym]: Absent, ...options });
  }

  static loadingGuess(options) {
    return new Repository(null, null, { [initialStateSym]: LoadingGuess, ...options });
  }

  static absentGuess(options) {
    return new Repository(null, null, { [initialStateSym]: AbsentGuess, ...options });
  }

  // State management //////////////////////////////////////////////////////////////////////////////////////////////////

  transition(currentState, StateConstructor, ...payload) {
    if (currentState !== this.state) {
      // Attempted transition from a non-active state, most likely from an asynchronous start() method.
      return Promise.resolve();
    }

    const nextState = new StateConstructor(this, ...payload);
    this.state = nextState;

    this.emitter.emit("did-change-state", { from: currentState, to: this.state });
    if (!this.isDestroyed()) {
      this.emitter.emit("did-update");
    }

    return this.state.start();
  }

  transitionTo(StateConstructor, ...payload) {
    return this.transition(this.state, StateConstructor, ...payload);
  }

  getLoadPromise() {
    return this.isAbsent()
      ? Promise.reject(new Error("An absent repository will never load"))
      : this.loadPromise;
  }

  /*
   * Use `callback` to request user input from all git strategies.
   */
  setPromptCallback(callback) {
    this._promptCallback = callback;
    if (this._git) {
      this._git.getImplementers().forEach((strategy) => strategy.setPromptCallback(callback));
    }
  }

  // Pipeline
  getPipeline(actionName) {
    const actionKey = this.pipelineManager.actionKeys[actionName];
    return this.pipelineManager.getPipeline(actionKey);
  }

  executePipelineAction(actionName, fn, ...args) {
    const pipeline = this.getPipeline(actionName);
    return pipeline.run(fn, this, ...args);
  }

  // Event subscription ////////////////////////////////////////////////////////////////////////////////////////////////

  onDidDestroy(callback) {
    return this.emitter.on("did-destroy", callback);
  }

  onDidChangeState(callback) {
    return this.emitter.on("did-change-state", callback);
  }

  onDidUpdate(callback) {
    return this.emitter.on("did-update", callback);
  }

  onDidGloballyInvalidate(callback) {
    return this.emitter.on("did-globally-invalidate", callback);
  }

  onPullError(callback) {
    return this.emitter.on("pull-error", callback);
  }

  didPullError() {
    return this.emitter.emit("pull-error");
  }

  // State-independent actions /////////////////////////////////////////////////////////////////////////////////////////
  // Actions that use direct filesystem access or otherwise don't need `this.git` to be available.

  async pathHasMergeMarkers(relativePath) {
    try {
      const contents = await fs.readFile(path.join(this.getWorkingDirectoryPath(), relativePath), {
        encoding: "utf8",
      });
      return MERGE_MARKER_REGEX.test(contents);
    } catch (e) {
      // EISDIR implies this is a submodule
      if (e.code === "ENOENT" || e.code === "EISDIR") {
        return false;
      } else {
        throw e;
      }
    }
  }

  async getMergeMessage() {
    try {
      const contents = await fs.readFile(path.join(this.getGitDirectoryPath(), "MERGE_MSG"), {
        encoding: "utf8",
      });
      return contents
        .split(/\n/)
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .join("\n");
    } catch (e) {
      return null;
    }
  }

  // State-independent accessors ///////////////////////////////////////////////////////////////////////////////////////

  getWorkingDirectoryPath() {
    return this.workingDirectoryPath;
  }

  setGitDirectoryPath(gitDirectoryPath) {
    this._gitDirectoryPath = gitDirectoryPath;
  }

  getGitDirectoryPath() {
    if (this._gitDirectoryPath) {
      return this._gitDirectoryPath;
    } else if (this.getWorkingDirectoryPath()) {
      return path.join(this.getWorkingDirectoryPath(), ".git");
    } else {
      // Absent/Loading/etc.
      return null;
    }
  }

  isInState(stateName) {
    return this.state.constructor.name === stateName;
  }

  toString() {
    return `Repository(state=${this.state.constructor.name}, workdir="${this.getWorkingDirectoryPath()}")`;
  }

  // Compound Getters //////////////////////////////////////////////////////////////////////////////////////////////////
  // Accessor methods for data derived from other, state-provided getters.

  async getCurrentBranch() {
    const branches = await this.getBranches();
    const head = branches.getHeadBranch();
    if (head.isPresent()) {
      return head;
    }

    // A freshly initialized repository is on an unborn branch: HEAD names a
    // branch that has no commit yet, so `git for-each-ref` lists nothing and
    // the branch set is empty. The status bundle still carries the branch name
    // from the core status snapshot, so report it as the current branch rather
    // than falling through to a detached HEAD.
    const { branch } = await this.getStatusBundle();
    if (branch && branch.head && branch.head !== "(detached)") {
      return new Branch(branch.head);
    }

    const description = await this.getHeadDescription();
    return Branch.createDetached(description || "no branch");
  }

  async getUnstagedChanges() {
    const { unstagedFiles } = await this.getStatusBundle();
    return Object.keys(unstagedFiles)
      .sort()
      .map((filePath) => {
        return { filePath, status: unstagedFiles[filePath] };
      });
  }

  async getStagedChanges() {
    const { stagedFiles } = await this.getStatusBundle();
    return Object.keys(stagedFiles)
      .sort()
      .map((filePath) => {
        return { filePath, status: stagedFiles[filePath] };
      });
  }

  async getMergeConflicts() {
    const { mergeConflictFiles } = await this.getStatusBundle();
    return Object.keys(mergeConflictFiles).map((filePath) => {
      return { filePath, status: mergeConflictFiles[filePath] };
    });
  }

  async isPartiallyStaged(fileName) {
    const { unstagedFiles, stagedFiles } = await this.getStatusBundle();
    const u = unstagedFiles[fileName];
    const s = stagedFiles[fileName];
    return (
      (u === "modified" && s === "modified") ||
      (u === "modified" && s === "added") ||
      (u === "added" && s === "deleted") ||
      (u === "deleted" && s === "modified")
    );
  }

  async getRemoteForBranch(branchName) {
    const name = await this.getConfig(`branch.${branchName}.remote`);
    return (await this.getRemotes()).withName(name);
  }

  async saveDiscardHistory() {
    if (this.isDestroyed()) {
      return;
    }

    const historySha = await this.createDiscardHistoryBlob();
    if (this.isDestroyed()) {
      return;
    }
    await this.setConfig("atomGithub.historySha", historySha);
  }

  async getCommitter(options = {}) {
    const committer = await yubikiri({
      email: this.getConfig("user.email", options),
      name: this.getConfig("user.name", options),
    });

    return committer.name !== null && committer.email !== null
      ? new Author(committer.email, committer.name)
      : nullAuthor;
  }

  async getCurrentGitHubRemote() {
    let currentRemote = null;

    const remotes = await this.getRemotes();

    const gitHubRemotes = remotes.filter((remote) => remote.isGithubRepo());
    const selectedRemoteName = await this.getConfig("atomGithub.currentRemote");
    currentRemote = gitHubRemotes.withName(selectedRemoteName);

    if (!currentRemote.isPresent() && gitHubRemotes.size() === 1) {
      currentRemote = Array.from(gitHubRemotes)[0];
    } else if (!currentRemote.isPresent() && gitHubRemotes.size() > 1) {
      // When multiple GitHub remotes exist and none is chosen, prefer "origin" as a default.
      const origin = gitHubRemotes.withName("origin");
      if (origin.isPresent()) {
        currentRemote = origin;
      }
    }
    return currentRemote;
  }

  async hasGitHubRemote(host, owner, name) {
    const remotes = await this.getRemotes();
    return remotes.matchingGitHubRepository(owner, name).length > 0;
  }
}

// The methods named here will be delegated to the current State.
//
// Duplicated here rather than just using `expectedDelegates` directly so that this file is grep-friendly for answering
// the question of "what all can a Repository do exactly".
const delegates = [
  "isLoadingGuess",
  "isAbsentGuess",
  "isAbsent",
  "isLoading",
  "isEmpty",
  "isPresent",
  "isTooLarge",
  "isDestroyed",

  "isUndetermined",
  "showGitTabInit",
  "showGitTabInitInProgress",
  "showGitTabLoading",
  "showStatusBarTiles",
  "hasDirectory",
  "isPublishable",

  "init",
  "clone",
  "destroy",
  "refresh",
  "observeFilesystemChange",
  "updateCommitMessageAfterFileSystemChange",

  "stageFiles",
  "unstageFiles",
  "stageFilesFromParentCommit",
  "stageFileModeChange",
  "stageFileSymlinkChange",
  "applyPatchToIndex",
  "applyPatchToWorkdir",

  "commit",

  "merge",
  "abortMerge",
  "checkoutSide",
  "mergeFile",
  "writeMergeConflictToIndex",

  "checkout",
  "checkoutPathsAtRevision",

  "undoLastCommit",

  "fetch",
  "pull",
  "push",

  "setConfig",

  "createBlob",
  "expandBlobToFile",

  "createDiscardHistoryBlob",
  "updateDiscardHistory",
  "storeBeforeAndAfterBlobs",
  "restoreLastDiscardInTempFiles",
  "popDiscardHistory",
  "clearDiscardHistory",
  "discardWorkDirChangesForPaths",

  "getStatusBundle",
  "getStatusesForChangedFiles",
  "getFilePatchForPath",
  "getDiffsForFilePath",
  "getStagedChangesPatch",
  "readFileFromIndex",

  "getLastCommit",
  "getCommit",
  "getRecentCommits",
  "isCommitPushed",

  "getAuthors",

  "getBranches",
  "getHeadDescription",

  "isMerging",
  "isRebasing",

  "getRemotes",
  "addRemote",

  "getAheadCount",
  "getBehindCount",

  "getConfig",
  "unsetConfig",

  "getBlobContents",

  "hasDiscardHistory",
  "getDiscardHistory",
  "getLastHistorySnapshots",

  "getOperationStates",

  "setCommitMessage",
  "getCommitMessage",
  "fetchCommitMessageTemplate",
  "getCache",
  "acceptInvalidation",
];

for (let i = 0; i < delegates.length; i++) {
  const delegate = delegates[i];

  Repository.prototype[delegate] = function (...args) {
    return this.state[delegate](...args);
  };
}
