/** @babel */
import path from "path";

let CompositeGitStrategy;
let BranchSet;
let RemoteSet;
let MultiFilePatch;
let nullCommit;
let nullOperationStates;
let Keys;

function getCompositeGitStrategy() {
  if (!CompositeGitStrategy) {
    const compositeGitStrategyModule = require("../../composite-git-strategy");
    CompositeGitStrategy = compositeGitStrategyModule.default || compositeGitStrategyModule;
  }
  return CompositeGitStrategy;
}

function getBranchSet() {
  if (!BranchSet) {
    const branchSetModule = require("../branch-set");
    BranchSet = branchSetModule.default || branchSetModule;
  }
  return BranchSet;
}

function getRemoteSet() {
  if (!RemoteSet) {
    const remoteSetModule = require("../remote-set");
    RemoteSet = remoteSetModule.default || remoteSetModule;
  }
  return RemoteSet;
}

function getMultiFilePatch() {
  if (!MultiFilePatch) {
    const multiFilePatchModule = require("../patch/multi-file-patch");
    MultiFilePatch = multiFilePatchModule.default || multiFilePatchModule;
  }
  return MultiFilePatch;
}

function getNullCommit() {
  if (!nullCommit) {
    ({ nullCommit } = require("../commit"));
  }
  return nullCommit;
}

function getNullOperationStates() {
  if (!nullOperationStates) {
    ({ nullOperationStates } = require("../operation-states"));
  }
  return nullOperationStates;
}

function getKeys() {
  if (!Keys) {
    ({ Keys } = require("./cache/keys"));
  }
  return Keys;
}

function requireState(stateName) {
  const statePaths = {
    Empty: "./empty",
    Initializing: "./initializing",
    Cloning: "./cloning",
    Present: "./present",
    Destroyed: "./destroyed",
    TooLarge: "./too-large",
  };
  const statePath = statePaths[stateName];
  if (statePath) {
    require(statePath);
  }
}

/**
 * Map of registered subclasses to allow states to transition to one another without circular dependencies.
 * Subclasses of State should call `State.register` to add themselves here.
 */
const stateConstructors = new Map();

/**
 * Base class for Repository states. Implements default "null" behavior.
 */
export default class State {
  constructor(repository) {
    this.repository = repository;
  }

  static register(Subclass) {
    stateConstructors.set(Subclass.name, Subclass);
  }

  // This state has just been entered. Perform any asynchronous initialization that needs to occur.
  start() {
    return Promise.resolve();
  }

  // State probe predicates ////////////////////////////////////////////////////////////////////////////////////////////
  // Allow external callers to identify which state a Repository is in if necessary.

  isLoadingGuess() {
    return false;
  }

  isAbsentGuess() {
    return false;
  }

  isAbsent() {
    return false;
  }

  isLoading() {
    return false;
  }

  isEmpty() {
    return false;
  }

  isPresent() {
    return false;
  }

  isTooLarge() {
    return false;
  }

  isDestroyed() {
    return false;
  }

  // Behavior probe predicates /////////////////////////////////////////////////////////////////////////////////////////
  // Determine specific rendering behavior based on the current state.

  isUndetermined() {
    return false;
  }

  showGitTabInit() {
    return false;
  }

  showGitTabInitInProgress() {
    return false;
  }

  showGitTabLoading() {
    return false;
  }

  showStatusBarTiles() {
    return false;
  }

  hasDirectory() {
    return true;
  }

  isPublishable() {
    return false;
  }

  // Lifecycle actions /////////////////////////////////////////////////////////////////////////////////////////////////
  // These generally default to rejecting a Promise with an error.

  init() {
    return unsupportedOperationPromise(this, "init");
  }

  clone(remoteUrl) {
    return unsupportedOperationPromise(this, "clone");
  }

  destroy() {
    return this.transitionTo("Destroyed");
  }

  /* istanbul ignore next */
  refresh() {
    // No-op
  }

  /* istanbul ignore next */
  observeFilesystemChange(events) {
    this.repository.refresh();
  }

  /* istanbul ignore next */
  updateCommitMessageAfterFileSystemChange() {
    // this is only used in unit tests, we don't need no stinkin coverage
    this.repository.refresh();
  }

  // Git operations ////////////////////////////////////////////////////////////////////////////////////////////////////
  // These default to rejecting a Promise with an error stating that the operation is not supported in the current
  // state.

  // Staging and unstaging

  stageFiles(paths) {
    return unsupportedOperationPromise(this, "stageFiles");
  }

  unstageFiles(paths) {
    return unsupportedOperationPromise(this, "unstageFiles");
  }

  stageFilesFromParentCommit(paths) {
    return unsupportedOperationPromise(this, "stageFilesFromParentCommit");
  }

  applyPatchToIndex(patch) {
    return unsupportedOperationPromise(this, "applyPatchToIndex");
  }

  applyPatchToWorkdir(patch) {
    return unsupportedOperationPromise(this, "applyPatchToWorkdir");
  }

  // Committing

  commit(message, options) {
    return unsupportedOperationPromise(this, "commit");
  }

  // Merging

  merge(branchName) {
    return unsupportedOperationPromise(this, "merge");
  }

  abortMerge() {
    return unsupportedOperationPromise(this, "abortMerge");
  }

  checkoutSide(side, paths) {
    return unsupportedOperationPromise(this, "checkoutSide");
  }

  mergeFile(oursPath, commonBasePath, theirsPath, resultPath) {
    return unsupportedOperationPromise(this, "mergeFile");
  }

  writeMergeConflictToIndex(filePath, commonBaseSha, oursSha, theirsSha) {
    return unsupportedOperationPromise(this, "writeMergeConflictToIndex");
  }

  // Checkout

  checkout(revision, options = {}) {
    return unsupportedOperationPromise(this, "checkout");
  }

  checkoutPathsAtRevision(paths, revision = "HEAD") {
    return unsupportedOperationPromise(this, "checkoutPathsAtRevision");
  }

  // Reset

  undoLastCommit() {
    return unsupportedOperationPromise(this, "undoLastCommit");
  }

  // Remote interactions

  fetch(branchName) {
    return unsupportedOperationPromise(this, "fetch");
  }

  pull(branchName) {
    return unsupportedOperationPromise(this, "pull");
  }

  push(branchName) {
    return unsupportedOperationPromise(this, "push");
  }

  // Configuration

  async setConfig(optionName, value, options = {}) {
    await this.workdirlessGit().setConfig(optionName, value, options);
    this.didUpdate();
    if (options.global) {
      this.didGloballyInvalidate(() => getKeys().config.eachWithSetting(optionName));
    }
  }

  unsetConfig(option) {
    return unsupportedOperationPromise(this, "unsetConfig");
  }

  // Direct blob interactions

  createBlob({ filePath, stdin } = {}) {
    return unsupportedOperationPromise(this, "createBlob");
  }

  expandBlobToFile(absFilePath, sha) {
    return unsupportedOperationPromise(this, "expandBlobToFile");
  }

  // Discard history

  createDiscardHistoryBlob() {
    return unsupportedOperationPromise(this, "createDiscardHistoryBlob");
  }

  updateDiscardHistory() {
    return unsupportedOperationPromise(this, "updateDiscardHistory");
  }

  storeBeforeAndAfterBlobs(filePaths, isSafe, destructiveAction, partialDiscardFilePath = null) {
    return unsupportedOperationPromise(this, "storeBeforeAndAfterBlobs");
  }

  restoreLastDiscardInTempFiles(isSafe, partialDiscardFilePath = null) {
    return unsupportedOperationPromise(this, "restoreLastDiscardInTempFiles");
  }

  popDiscardHistory(partialDiscardFilePath = null) {
    return unsupportedOperationPromise(this, "popDiscardHistory");
  }

  clearDiscardHistory(partialDiscardFilePath = null) {
    return unsupportedOperationPromise(this, "clearDiscardHistory");
  }

  discardWorkDirChangesForPaths(paths) {
    return unsupportedOperationPromise(this, "discardWorkDirChangesForPaths");
  }

  // Accessors /////////////////////////////////////////////////////////////////////////////////////////////////////////
  // When possible, these default to "empty" results when invoked in states that don't have information available, or
  // fail in a way that's consistent with the requested information not being found.

  // Index queries

  getStatusBundle() {
    return Promise.resolve({
      stagedFiles: {},
      unstagedFiles: {},
      mergeConflictFiles: {},
      branch: {
        oid: null,
        head: null,
        upstream: null,
        aheadBehind: { ahead: null, behind: null },
      },
    });
  }

  getStatusesForChangedFiles() {
    return Promise.resolve({
      stagedFiles: [],
      unstagedFiles: [],
      mergeConflictFiles: [],
    });
  }

  getFilePatchForPath(filePath, options = {}) {
    return Promise.resolve(getMultiFilePatch().createNull());
  }

  getDiffsForFilePath(filePath, options = {}) {
    return Promise.resolve([]);
  }

  getStagedChangesPatch() {
    return Promise.resolve(getMultiFilePatch().createNull());
  }

  readFileFromIndex(filePath) {
    return Promise.reject(
      new Error(`fatal: Path ${filePath} does not exist (neither on disk nor in the index).`),
    );
  }

  // Commit access

  getLastCommit() {
    return Promise.resolve(getNullCommit());
  }

  getCommit() {
    return Promise.resolve(getNullCommit());
  }

  getRecentCommits() {
    return Promise.resolve([]);
  }

  isCommitPushed(sha) {
    return false;
  }

  // Author information

  getAuthors() {
    return Promise.resolve([]);
  }

  // Branches

  getBranches() {
    const BranchSetClass = getBranchSet();
    return Promise.resolve(new BranchSetClass());
  }

  getHeadDescription() {
    return Promise.resolve("(no repository)");
  }

  // Merging and rebasing status

  isMerging() {
    return Promise.resolve(false);
  }

  isRebasing() {
    return Promise.resolve(false);
  }

  // Remotes

  getRemotes() {
    const RemoteSetClass = getRemoteSet();
    return Promise.resolve(new RemoteSetClass([]));
  }

  addRemote() {
    return unsupportedOperationPromise(this, "addRemote");
  }

  getAheadCount(branchName) {
    return Promise.resolve(0);
  }

  getBehindCount(branchName) {
    return Promise.resolve(0);
  }

  getConfig(optionName, options) {
    return this.workdirlessGit().getConfig(optionName, options);
  }

  // Direct blob access

  getBlobContents(sha) {
    return Promise.reject(new Error(`fatal: Not a valid object name ${sha}`));
  }

  // Discard history

  hasDiscardHistory(partialDiscardFilePath = null) {
    return false;
  }

  getDiscardHistory(partialDiscardFilePath = null) {
    return [];
  }

  getLastHistorySnapshots(partialDiscardFilePath = null) {
    return null;
  }

  // Atom repo state

  getOperationStates() {
    return getNullOperationStates();
  }

  setCommitMessage(message) {
    return unsupportedOperationPromise(this, "setCommitMessage");
  }

  getCommitMessage() {
    return "";
  }

  fetchCommitMessageTemplate() {
    return unsupportedOperationPromise(this, "fetchCommitMessageTemplate");
  }

  // Cache

  getCache() {
    return null;
  }

  acceptInvalidation() {
    return null;
  }

  // Internal //////////////////////////////////////////////////////////////////////////////////////////////////////////
  // Non-delegated methods that provide subclasses with convenient access to Repository properties.

  git() {
    return this.repository.git;
  }

  workdir() {
    return this.repository.getWorkingDirectoryPath();
  }

  // Call methods on the active Repository state, even if the state has transitioned beneath you.
  // Use this to perform operations within `start()` methods to guard against interrupted state transitions.
  current() {
    return this.repository.state;
  }

  // pipeline
  executePipelineAction(...args) {
    return this.repository.executePipelineAction(...args);
  }

  // Return a Promise that will resolve once the state transitions from Loading.
  getLoadPromise() {
    return this.repository.getLoadPromise();
  }

  getRemoteForBranch(branchName) {
    return this.repository.getRemoteForBranch(branchName);
  }

  saveDiscardHistory() {
    return this.repository.saveDiscardHistory();
  }

  // Initiate a transition to another state.
  transitionTo(stateName, ...payload) {
    requireState(stateName);
    const StateConstructor = stateConstructors.get(stateName);
    /* istanbul ignore if */
    if (StateConstructor === undefined) {
      throw new Error(`Attempt to transition to unrecognized state ${stateName}`);
    }
    return this.repository.transition(this, StateConstructor, ...payload);
  }

  // Event broadcast

  didDestroy() {
    return this.repository.emitter.emit("did-destroy");
  }

  didUpdate() {
    return this.repository.emitter.emit("did-update");
  }

  didGloballyInvalidate(spec) {
    return this.repository.emitter.emit("did-globally-invalidate", spec);
  }

  // Direct git access
  // Non-delegated git operations for internal use within states.

  workdirlessGit() {
    // We want to report config values from the global or system level, but never local ones (unless we're in the
    // present state, which overrides this).
    // The filesystem root is the most likely and convenient place for this to be true.
    const { root } = path.parse(process.cwd());
    return getCompositeGitStrategy().create(root);
  }

  /* istanbul ignore next */
  directResolveDotGitDir() {
    return Promise.resolve(null);
  }

  /* istanbul ignore next */
  directGetConfig(key, options = {}) {
    return Promise.resolve(null);
  }

  /* istanbul ignore next */
  directGetBlobContents() {
    return Promise.reject(new Error("Not a valid object name"));
  }

  /* istanbul ignore next */
  directInit() {
    return Promise.resolve();
  }

  /* istanbul ignore next */
  directClone(remoteUrl, options) {
    return Promise.resolve();
  }

  // Deferred operations
  // Direct raw git operations to the current state, even if the state has been changed. Use these methods within
  // start() methods.

  resolveDotGitDir() {
    return this.current().directResolveDotGitDir();
  }

  doInit(workdir) {
    return this.current().directInit();
  }

  doClone(remoteUrl, options) {
    return this.current().directClone(remoteUrl, options);
  }

  // Parse a DiscardHistory payload from the SHA recorded in config.
  async loadHistoryPayload() {
    let historySha;
    try {
      historySha = await this.current().directGetConfig("atomGithub.historySha");
    } catch (e) {
      if (this.current().isDestroyed()) {
        return {};
      }

      throw e;
    }

    if (!historySha || this.current().isDestroyed()) {
      return {};
    }

    let blob;
    try {
      blob = await this.current().directGetBlobContents(historySha);
    } catch (e) {
      if (this.current().isDestroyed()) {
        return {};
      }

      const errorOutput = e.stdErr || e.message || "";
      if (/Not a valid object name/.test(errorOutput)) {
        return {};
      }

      throw e;
    }

    try {
      return JSON.parse(blob);
    } catch (e) {
      return {};
    }
  }

  // Debugging assistance.

  toString() {
    return this.constructor.name;
  }
}

function unsupportedOperationPromise(self, opName) {
  return Promise.reject(new Error(`${opName} is not available in ${self} state`));
}
