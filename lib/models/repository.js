/** @babel */
import { createRequire } from "node:module";
import path from "path";

import { Emitter } from "lumine";
import fs from "fs/promises";
import { streamMarkers } from "./conflicts/marker-lines.js";
import readFileBounded from "../read-file-bounded.js";
import { resolveQuery } from "../helpers.js";

import { getNullActionPipelineManager } from "../action-pipeline.js";
import Author, { nullAuthor } from "./author.js";
import Branch from "./branch.js";
import { Loading, Absent, LoadingGuess, AbsentGuess } from "./repository-states/index.js";

const require = import.meta.require ?? createRequire(import.meta.url);

const MERGE_MARKER_REGEX = /^(?:<{7,}|>{7,}) .+$/m;

// Scan marker metadata in bounded chunks; conflicts can occur at any offset.
const MERGE_MARKER_CHUNK_SIZE = 64 * 1024;

function changedFileStatusesEqual(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

export function hasMergeMarkers(contents) {
  return MERGE_MARKER_REGEX.test(contents);
}

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
    let handle;
    try {
      handle = await fs.open(path.join(this.getWorkingDirectoryPath(), relativePath), "r");
    } catch (e) {
      // EISDIR implies this is a submodule
      if (e.code === "ENOENT" || e.code === "EISDIR") {
        return false;
      } else {
        throw e;
      }
    }

    try {
      const buffer = Buffer.allocUnsafe(MERGE_MARKER_CHUNK_SIZE);
      const chunks = async function* () {
        for (;;) {
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
          if (!bytesRead) return;
          yield buffer.subarray(0, bytesRead);
        }
      };
      for await (const marker of streamMarkers(chunks(), { stopAtBinary: true })) {
        if (marker.kind === "<" || marker.kind === ">") return true;
      }

      return false;
    } catch (e) {
      // Windows opens a directory happily and only refuses at read time, so a
      // submodule reaches us here rather than at the open above.
      if (e.code === "ENOENT" || e.code === "EISDIR") {
        return false;
      } else {
        throw e;
      }
    } finally {
      await handle.close();
    }
  }

  async getMergeMessage() {
    try {
      const contents = await readFileBounded(path.join(this.getGitDirectoryPath(), "MERGE_MSG"), {
        encoding: "utf8",
        maxBytes: 32 * 1024 * 1024,
      });
      return contents
        .split(/\n/)
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .join("\n");
    } catch (e) {
      if (e.code === "ERR_GIT_DIFF_TOO_LARGE")
        lumine.notifications.addWarning("Merge message is too large", {
          detail: e.message,
          dismissable: true,
        });
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

  setCommonDirectoryPath(commonDirectoryPath) {
    this._commonDirectoryPath = commonDirectoryPath;
  }

  getCommonDirectoryPath() {
    return this._commonDirectoryPath || this.getGitDirectoryPath();
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
    return this.getChangedFileList("unstagedFiles");
  }

  async getStagedChanges() {
    return this.getChangedFileList("stagedFiles");
  }

  async getMergeConflicts() {
    return this.getChangedFileList("mergeConflictFiles", false);
  }

  async getChangedFileList(key, sorted = true) {
    const files = (await this.getStatusBundle())[key];
    const paths = Object.keys(files);
    if (sorted) paths.sort();
    this.changedFileLists ??= new Map();
    const previous = this.changedFileLists.get(key);
    if (
      previous?.length === paths.length &&
      paths.every(
        (filePath, index) =>
          previous[index].filePath === filePath &&
          changedFileStatusesEqual(previous[index].status, files[filePath]),
      )
    ) {
      return previous;
    }
    // Model updates also report operation state and commit-message edits. Keep
    // the staging rows mounted when their actual paths and statuses did not change.
    const changes = paths.map((filePath) => ({ filePath, status: files[filePath] }));
    this.changedFileLists.set(key, changes);
    return changes;
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
    await this.setConfig("lumineGit.historySha", historySha);
  }

  async getCommitter(options = {}) {
    const committer = await resolveQuery({
      email: this.getConfig("user.email", options),
      name: this.getConfig("user.name", options),
    });

    return committer.name !== null && committer.email !== null
      ? new Author(committer.email, committer.name)
      : nullAuthor;
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
  "readFileAtEndpoint",

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
  "getCommitMessageSnapshot",
  "fetchCommitMessageTemplate",
  "getCache",
  "acceptInvalidation",
  "observeStatusChange",
];

for (let i = 0; i < delegates.length; i++) {
  const delegate = delegates[i];

  Repository.prototype[delegate] = function (...args) {
    return this.state[delegate](...args);
  };
}
