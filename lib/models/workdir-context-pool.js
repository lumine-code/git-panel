/** @babel */

import { Emitter } from "lumine";
import { compareSets } from "../helpers";
import WorkdirContext from "./workdir-context";

/**
 * Manage a WorkdirContext for each open directory.
 */
export default class WorkdirContextPool {
  /**
   * Options will be passed to each `WorkdirContext` as it is created.
   */
  constructor(options = {}) {
    this.options = options;

    this.contexts = new Map();
    this.retainedContexts = new Map();
    this.emitter = new Emitter();
  }

  size() {
    return this.contexts.size;
  }

  /**
   * Access the context mapped to a known directory.
   */
  getContext(directory) {
    const { pipelineManager } = this.options;
    return this.contexts.get(directory) || WorkdirContext.absent({ pipelineManager });
  }

  has(directory) {
    return this.contexts.has(directory);
  }

  add(directory, options = {}, silenceEmitter = false) {
    if (this.contexts.has(directory)) {
      return this.getContext(directory);
    }

    const context = new WorkdirContext(directory, { ...this.options, ...options });
    this.contexts.set(directory, context);
    this.bindRetainedContexts(directory, context);

    const disposable = context.subs;

    const forwardEvent = (subMethod, emitEventName) => {
      const emit = () => this.emitter.emit(emitEventName, context);
      disposable.add(context[subMethod](emit));
    };

    forwardEvent("onDidStartObserver", "did-start-observer");
    forwardEvent("onDidChangeWorkdirOrHead", "did-change-workdir-or-head");
    forwardEvent("onDidChangeRepositoryState", "did-change-repository-state");
    forwardEvent("onDidUpdateRepository", "did-update-repository");
    forwardEvent("onDidDestroyRepository", "did-destroy-repository");

    // Propagate global cache invalidations across all resident contexts
    disposable.add(
      context.getRepository().onDidGloballyInvalidate((spec) => {
        this.withResidentContexts((_workdir, eachContext) => {
          if (eachContext !== context) {
            eachContext.getRepository().acceptInvalidation(spec);
          }
        });
      }),
    );

    if (!silenceEmitter) {
      this.emitter.emit("did-change-contexts", { added: new Set([directory]) });
    }

    return context;
  }

  retain(directory, options = {}) {
    if (directory && !this.contexts.has(directory)) this.add(directory, options);
    const edge = { context: null, observation: null, disposed: false };
    let edges = this.retainedContexts.get(directory);
    if (!edges) this.retainedContexts.set(directory, (edges = new Set()));
    edges.add(edge);
    const context = this.contexts.get(directory);
    if (context) {
      edge.context = context;
      edge.observation = context.retainObservation();
    }
    const pool = this;
    const handle = {
      get context() {
        return edge.context || WorkdirContext.absent(pool.options);
      },
      get ready() {
        return edge.observation?.ready || handle.context.whenObservationReady();
      },
      dispose() {
        if (edge.disposed) return;
        edge.disposed = true;
        edge.observation?.dispose();
        edge.observation = null;
        edge.context = null;
        edges.delete(edge);
        if (edges.size === 0) pool.retainedContexts.delete(directory);
      },
    };
    return handle;
  }

  bindRetainedContexts(directory, context) {
    for (const edge of this.retainedContexts.get(directory) || []) {
      edge.observation?.dispose();
      edge.context = context;
      edge.observation = context?.retainObservation() || null;
    }
  }

  replace(directory, options = {}, silenceEmitter = false) {
    this.remove(directory, true);
    const context = this.add(directory, options, true);

    if (!silenceEmitter) {
      this.emitter.emit("did-change-contexts", { altered: new Set([directory]) });
    }

    return context;
  }

  /**
   * Reconcile a repository that has just been registered by lumine.repositories.
   *
   * A resident context often causes this event itself while its Repository is
   * still loading. Replacing that context restarts its initial reads and lets a
   * transient empty/unborn state reach the UI. Keep any context that is still
   * resolving or already usable; only retry one that definitively resolved as
   * empty (or was destroyed).
   */
  reconcileRepositoryAdded(directory, options = {}, silenceEmitter = false) {
    const existing = this.contexts.get(directory);
    if (!existing) {
      return this.add(directory, options, silenceEmitter);
    }

    const repository = existing.getRepository();
    if (repository.isEmpty() || repository.isDestroyed()) {
      return this.replace(directory, options, silenceEmitter);
    }

    return existing;
  }

  remove(directory, silenceEmitter = false) {
    const existing = this.contexts.get(directory);
    this.contexts.delete(directory);
    this.bindRetainedContexts(directory, null);

    if (existing) {
      existing.destroy();

      if (!silenceEmitter) {
        this.emitter.emit("did-change-contexts", { removed: new Set([directory]) });
      }
    }
  }

  set(directories, options = {}) {
    const previous = new Set(this.contexts.keys());
    const { added, removed } = compareSets(previous, directories);

    for (const directory of added) {
      this.add(directory, options, true);
    }
    for (const directory of removed) {
      this.remove(directory, true);
    }

    if (added.size !== 0 || removed.size !== 0) {
      this.emitter.emit("did-change-contexts", { added, removed });
    }
  }

  getCurrentWorkDirs() {
    return this.contexts.keys();
  }

  withResidentContexts(callback) {
    const results = [];
    for (const [workdir, context] of this.contexts) {
      results.push(callback(workdir, context));
    }
    return results;
  }

  onDidStartObserver(callback) {
    return this.emitter.on("did-start-observer", callback);
  }

  onDidChangePoolContexts(callback) {
    return this.emitter.on("did-change-contexts", callback);
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

  clear() {
    const workdirs = new Set();

    this.withResidentContexts((workdir) => {
      this.remove(workdir, true);
      workdirs.add(workdir);
    });

    WorkdirContext.destroyAbsent();

    if (workdirs.size !== 0) {
      this.emitter.emit("did-change-contexts", { removed: workdirs });
    }
  }
}
