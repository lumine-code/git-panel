/** @babel */
import { Emitter, CompositeDisposable, watchDirectory } from "lumine";

import path from "path";

import EventLogger from "./event-logger";

export default class FileSystemChangeObserver {
  constructor(repository) {
    this.emitter = new Emitter();
    this.repository = repository;
    this.logger = new EventLogger("fs watcher");

    this.started = false;
    this.destroyed = false;
    this.watchSubscriptions = new CompositeDisposable();
  }

  start() {
    this.startPromise ??= this.watchRepository().then(() => {
      this.started = !this.destroyed;
      return this;
    });
    return this.startPromise;
  }

  async destroy() {
    this.started = false;
    this.destroyed = true;
    this.emitter.dispose();
    await this.stopCurrentFileWatcher();
  }

  isStarted() {
    return this.started;
  }

  didChange(payload) {
    this.emitter.emit("did-change", payload);
  }

  didChangeWorkdirOrHead() {
    this.emitter.emit("did-change-workdir-or-head");
  }

  onDidChange(callback) {
    return this.emitter.on("did-change", callback);
  }

  onDidInvalidate(callback) {
    return this.emitter.on("did-invalidate", callback);
  }

  onDidChangeWorkdirOrHead(callback) {
    return this.emitter.on("did-change-workdir-or-head", callback);
  }

  getRepository() {
    return this.repository;
  }

  async watchRepository() {
    const allPaths = (event) => {
      const ps = [event.path];
      if (event.oldPath) {
        ps.push(event.oldPath);
      }
      return ps;
    };

    const isNonGitFile = (event) =>
      allPaths(event).some((eventPath) => !eventPath.split(path.sep).includes(".git"));

    const isWatchedGitFile = (event) =>
      allPaths(event).some((eventPath) => {
        return (
          ["config", "index", "HEAD", "MERGE_HEAD"].includes(path.basename(eventPath)) ||
          path.dirname(eventPath).includes(path.join(".git", "refs"))
        );
      });

    const handleEvents = (events) => {
      const filteredEvents = events.filter((e) => isNonGitFile(e) || isWatchedGitFile(e));
      if (filteredEvents.length) {
        this.logger.showEvents(filteredEvents);
        this.didChange(filteredEvents);
        const workdirOrHeadEvent = filteredEvents.find((event) => {
          return allPaths(event).every(
            (eventPath) => !["config", "index"].includes(path.basename(eventPath)),
          );
        });
        if (workdirOrHeadEvent) {
          this.logger.showWorkdirOrHeadEvents();
          this.didChangeWorkdirOrHead();
        }
      }
    };

    const watcher = watchDirectory(this.repository.getWorkingDirectoryPath(), { recursive: true });
    this.currentFileWatcher = watcher;
    const reconcile = () => {
      if (this.destroyed) return;
      this.emitter.emit("did-invalidate");
      this.didChangeWorkdirOrHead();
    };
    this.watchSubscriptions.add(
      watcher,
      watcher.onDidChange(handleEvents),
      watcher.onDidInvalidate(reconcile),
      watcher.onDidError((error) => console.warn("Repository watch failed", error)),
    );
    await watcher.ready;
    this.logger.showStarted(this.repository.getWorkingDirectoryPath(), "editor watchDirectory");
  }

  stopCurrentFileWatcher() {
    if (this.currentFileWatcher) {
      const watcher = this.currentFileWatcher;
      this.currentFileWatcher = null;
      this.watchSubscriptions.dispose();
      this.logger.showStopped();
      return watcher.closed;
    }
    return Promise.resolve();
  }
}
