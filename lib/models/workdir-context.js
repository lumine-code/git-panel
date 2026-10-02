/** @babel */
import { Emitter, CompositeDisposable } from "lumine";

import Repository from "./repository";
import ResolutionProgress from "./conflicts/resolution-progress";
import FileSystemChangeObserver from "./file-system-change-observer";
import WorkspaceChangeObserver from "./workspace-change-observer";
import { Keys } from "./repository-states/cache/keys";
import { autobind } from "../helpers";

export const createRepoSym = Symbol("createRepo");

let absentWorkdirContext;

/*
 * Bundle of model objects associated with a git working directory.
 *
 * Provides synchronous access to each model in the form of a getter method that returns the model or `null` if it
 * has not yet been initialized, and asynchronous access in the form of a Promise generation method that will resolve
 * once the model is available. Initializes the platform-appropriate change observer and proxies select filesystem
 * change events.
 */
export default class WorkdirContext {
  /*
   * Available options:
   * - `options.window`: Browser window global, used on Linux by the WorkspaceChangeObserver.
   * - `options.workspace`: the editor's workspace singleton, used on Linux by the WorkspaceChangeObserver.
   * - `options.promptCallback`: Callback used to collect information interactively through the editor.
   */
  constructor(directory, options = {}) {
    autobind(this, "repositoryChangedState");

    this.directory = directory;

    const { pipelineManager } = options;
    this.repository = (
      options[createRepoSym] || (() => new Repository(directory, null, { pipelineManager }))
    )();

    this.destroyed = false;
    this.options = options;
    this.emitter = new Emitter();
    this.subs = new CompositeDisposable();
    this.observer = null;
    this.observationRetainers = new Set();
    this.observationGeneration = 0;
    this.observation = null;
    this.observationTeardown = Promise.resolve();
    this.idleObservationReady = Promise.resolve(this);
    this.destroyedObservationReady = Promise.resolve(null);
    this.resolutionProgress = new ResolutionProgress();

    // Wire up event forwarding among models
    this.subs.add(this.repository.onDidChangeState(this.repositoryChangedState));
    this.coreRepositoryLease = null;

    // If a pre-loaded Repository was provided, broadcast an initial state change event.
    this.repositoryChangedState({ from: null, to: this.repository.state });
  }

  /*
   * Invalidate the panel's status and refs caches whenever Lumine's own repository state
   * changes, so the panel stays in sync with writes made through lumine.repositories by other
   * consumers and with core-driven snapshot refreshes. Subscribing also declares interest in
   * the status snapshot, which activates core's own refresh scheduling for this repository.
   */
  async subscribeToCoreRepository(observation) {
    if (!this.directory || !this.isCurrentObservation(observation)) return null;

    let lease;
    try {
      lease = await lumine.repositories.add(this.directory, { persist: false });
    } catch (_error) {
      return null;
    }
    if (!lease) {
      return null;
    }
    if (!this.isCurrentObservation(observation)) {
      lease.dispose();
      return null;
    }

    observation.coreLease = lease;
    this.coreRepositoryLease = lease;
    const coreRepository = lease.repository;
    observation.subs.add(
      coreRepository.onDidChangeStatusSnapshot(() => {
        if (!this.isCurrentObservation(observation)) return;
        this.repository.acceptInvalidation(() => [
          Keys.statusBundle,
          Keys.stagedChanges,
          Keys.index.all,
          Keys.filePatch.all,
        ]);
      }),
      coreRepository.onDidChangeRefsSnapshot(() => {
        if (!this.isCurrentObservation(observation)) return;
        this.repository.acceptInvalidation(() => [
          Keys.remotes,
          Keys.config.all,
          ...Keys.headOperationKeys(),
          Keys.index.all,
          Keys.filePatch.all,
        ]);
      }),
    );
    return coreRepository;
  }

  retainObservation() {
    const token = {};
    if (!this.destroyed) {
      this.observationRetainers.add(token);
      if (this.observationRetainers.size === 1) this.resumeObservation();
    }
    let disposed = false;
    const context = this;
    return {
      get ready() {
        return context.whenObservationReady();
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        if (!context.observationRetainers.delete(token)) return;
        if (context.observationRetainers.size === 0) context.suspendObservation();
      },
    };
  }

  whenObservationReady() {
    if (this.destroyed) return this.destroyedObservationReady;
    return this.observation?.ready || this.idleObservationReady;
  }

  isCurrentObservation(observation) {
    return (
      !this.destroyed &&
      this.observationRetainers.size > 0 &&
      this.observation === observation &&
      !observation.controller.signal.aborted
    );
  }

  createChangeObserver() {
    const theWindow = this.options.window || globalThis.window;
    const workspace = this.options.workspace || lumine.workspace;
    return this.useWorkspaceChangeObserver()
      ? new WorkspaceChangeObserver(theWindow, workspace, this.repository)
      : new FileSystemChangeObserver(this.repository);
  }

  clearReadCache(notify = false) {
    this.repository.getCache()?.clear();
    if (notify) this.repository.acceptInvalidation(() => []);
  }

  resumeObservation() {
    const observation = {
      generation: ++this.observationGeneration,
      controller: new AbortController(),
      subs: new CompositeDisposable(),
      observer: null,
      coreLease: null,
      starting: true,
    };
    this.observation = observation;
    this.clearReadCache();
    observation.ready = this.startObservation(observation);
    observation.ready.catch(() => {});
  }

  waitForObservation(observation, operation) {
    const { signal } = observation.controller;
    return new Promise((resolve, reject) => {
      const abort = () => resolve(null);
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve(operation).then(
        (value) => {
          signal.removeEventListener("abort", abort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
      if (signal.aborted) abort();
    });
  }

  async startObservation(observation) {
    try {
      await this.waitForObservation(observation, this.observationTeardown);
      if (!this.isCurrentObservation(observation)) return null;
      if (this.repository.isAbsent()) return this;
      await this.waitForObservation(observation, this.repository.getLoadPromise());
      if (!this.isCurrentObservation(observation)) return null;
      if (!this.repository.isPresent()) return this;

      const observer = this.createChangeObserver();
      observation.observer = observer;
      this.observer = observer;
      observation.subs.add(
        observer.onDidChange((events) => {
          if (this.isCurrentObservation(observation))
            this.repository.observeFilesystemChange(events);
        }),
        observer.onDidInvalidate(() => {
          if (this.isCurrentObservation(observation)) this.repository.refresh();
        }),
        observer.onDidChangeWorkdirOrHead(() => {
          if (this.isCurrentObservation(observation))
            this.emitter.emit("did-change-workdir-or-head");
        }),
      );
      await this.waitForObservation(observation, observer.start());
      if (!this.isCurrentObservation(observation)) return null;
      const coreRepository = await this.waitForObservation(
        observation,
        this.subscribeToCoreRepository(observation),
      );
      if (!this.isCurrentObservation(observation)) return null;
      if (coreRepository) {
        const watermark = this.repository.captureStatusChangeWatermark?.();
        const status = coreRepository
          .refreshStatusSnapshot({ signal: observation.controller.signal })
          .then((snapshot) => {
            if (this.isCurrentObservation(observation) && watermark !== undefined) {
              this.repository.acknowledgeStatusChangeWatermark(watermark);
            }
            return snapshot;
          });
        const refsWatermark = this.repository.captureRefsChangeWatermark?.();
        const refs = coreRepository
          .refreshRefsSnapshot({ signal: observation.controller.signal })
          .then((snapshot) => {
            if (this.isCurrentObservation(observation) && refsWatermark !== undefined) {
              this.repository.acknowledgeRefsChangeWatermark(refsWatermark);
            }
            return snapshot;
          });
        await this.waitForObservation(observation, Promise.all([status, refs]));
      }
      if (!this.isCurrentObservation(observation)) return null;
      this.clearReadCache(true);
      this.emitter.emit("did-start-observer");
      return this;
    } catch (error) {
      if (!this.isCurrentObservation(observation)) return null;
      console.warn("Unable to observe repository", error);
      this.stopObservation(observation);
      throw error;
    } finally {
      observation.starting = false;
    }
  }

  suspendObservation() {
    const observation = this.observation;
    if (!observation) return;
    this.observation = null;
    this.stopObservation(observation);
  }

  stopObservation(observation) {
    if (observation.stopped) return;
    observation.stopped = true;
    observation.controller.abort();
    observation.subs.dispose();
    observation.coreLease?.dispose();
    if (this.coreRepositoryLease === observation.coreLease) this.coreRepositoryLease = null;
    if (this.observer === observation.observer) this.observer = null;
    const closed = observation.observer?.destroy() || Promise.resolve();
    this.observationTeardown = Promise.all([this.observationTeardown, closed]).then(
      () => {},
      (error) => console.warn("Unable to stop repository observation", error),
    );
    this.observationTeardown.catch(() => {});
  }

  static absent(options) {
    if (!absentWorkdirContext) {
      absentWorkdirContext = new AbsentWorkdirContext(options);
    }
    return absentWorkdirContext;
  }

  static destroyAbsent() {
    if (absentWorkdirContext) {
      absentWorkdirContext.destroy();
      absentWorkdirContext = null;
    }
  }

  static guess(options, pipelineManager) {
    const projectPathCount = options.projectPathCount || 0;
    const initPathCount = options.initPathCount || 0;

    const createRepo =
      options.preferLoading ||
      projectPathCount === 1 ||
      (projectPathCount === 0 && initPathCount === 1)
        ? () => Repository.loadingGuess({ pipelineManager })
        : () => Repository.absentGuess({ pipelineManager });

    return new WorkdirContext(null, { [createRepoSym]: createRepo });
  }

  /**
   * Respond to changes in `Repository` state. Load resolution progress and start the change observer when it becomes
   * present. Stop the change observer when it is destroyed. Re-broadcast the event to context subscribers
   * regardless.
   *
   * The ResolutionProgress will be loaded before the change event is re-broadcast, but change observer modifications
   * will not be complete.
   */
  repositoryChangedState(payload) {
    if (this.destroyed) {
      return;
    }

    if (
      this.repository.isPresent() &&
      this.observation &&
      !this.observation.starting &&
      !this.observer
    ) {
      this.clearReadCache();
      this.observation.starting = true;
      this.observation.ready = this.startObservation(this.observation);
      this.observation.ready.catch(() => {});
    } else if (this.repository.isDestroyed()) {
      this.emitter.emit("did-destroy-repository");
      this.suspendObservation();
    }

    this.emitter.emit("did-change-repository-state", payload);
  }

  isPresent() {
    return true;
  }

  isDestroyed() {
    return this.destroyed;
  }

  useWorkspaceChangeObserver() {
    return !!process.env.LUMINE_GIT_WORKSPACE_OBSERVER || process.platform === "linux";
  }

  // Event subscriptions

  onDidStartObserver(callback) {
    return this.emitter.on("did-start-observer", callback);
  }

  onDidChangeWorkdirOrHead(callback) {
    return this.emitter.on("did-change-workdir-or-head", callback);
  }

  onDidChangeRepositoryState(callback) {
    return this.emitter.on("did-change-repository-state", callback);
  }

  onDidUpdateRepository(callback) {
    return this.emitter.on("did-update-repository", callback);
  }

  onDidDestroyRepository(callback) {
    return this.emitter.on("did-destroy-repository", callback);
  }

  /**
   * Return a Promise that will resolve the next time that a Repository transitions to the requested state. Most
   * useful for test cases; most callers should prefer subscribing to `onDidChangeRepositoryState`.
   */
  getRepositoryStatePromise(stateName) {
    return new Promise((resolve) => {
      const sub = this.onDidChangeRepositoryState(() => {
        if (this.repository.isInState(stateName)) {
          resolve();
          sub.dispose();
        }
      });
    });
  }

  /**
   * Return a Promise that will resolve the next time that a ChangeObserver successfully starts. Most useful for
   * test cases.
   */
  getObserverStartedPromise() {
    return new Promise((resolve) => {
      const sub = this.onDidStartObserver(() => {
        resolve();
        sub.dispose();
      });
    });
  }

  getWorkingDirectory() {
    return this.directory;
  }

  getRepository() {
    return this.repository;
  }

  getChangeObserver() {
    return this.observer;
  }

  getResolutionProgress() {
    return this.resolutionProgress;
  }

  /*
   * Cleanly destroy any models that need to be cleaned, including stopping the filesystem watcher.
   */
  async destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.suspendObservation();
    this.observationRetainers.clear();
    this.subs.dispose();
    this.repository.destroy();
    this.emitter.dispose();

    await this.observationTeardown;
  }
}

class AbsentWorkdirContext extends WorkdirContext {
  constructor(options) {
    super(null, { [createRepoSym]: () => Repository.absent(options) });
  }

  isPresent() {
    return false;
  }
}
