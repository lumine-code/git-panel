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
    const workingDirectory = this.repository.getWorkingDirectoryPath();
    const gitDirectory =
      this.repository.getGitDirectoryPath?.() || path.join(workingDirectory, ".git");
    const contains = (directoryPath, eventPath) => {
      const relativePath = path.relative(directoryPath, eventPath);
      return (
        relativePath !== ".." &&
        !relativePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativePath)
      );
    };
    const relativeGitPath = (eventPath) => path.relative(gitDirectory, eventPath);
    const isRefPath = (relativePath) =>
      relativePath === "refs" || relativePath.startsWith(`refs${path.sep}`);
    const allPaths = (event) => {
      const ps = [event.path];
      if (event.oldPath) {
        ps.push(event.oldPath);
      }
      return ps;
    };

    const isWorkingFile = (eventPath) =>
      contains(workingDirectory, eventPath) &&
      !contains(gitDirectory, eventPath) &&
      !path.relative(workingDirectory, eventPath).split(path.sep).includes(".git");
    const isWatchedGitFile = (eventPath) => {
      const relativePath = relativeGitPath(eventPath);
      return (
        ["config", "index", "HEAD", "MERGE_HEAD"].includes(relativePath) || isRefPath(relativePath)
      );
    };
    const isWorkdirOrHeadPath = (eventPath) => {
      const relativePath = relativeGitPath(eventPath);
      return (
        isWorkingFile(eventPath) ||
        ["HEAD", "MERGE_HEAD"].includes(relativePath) ||
        isRefPath(relativePath)
      );
    };

    const handleEvents = (events) => {
      const filteredEvents = events.filter((event) =>
        allPaths(event).some(
          (eventPath) => isWorkingFile(eventPath) || isWatchedGitFile(eventPath),
        ),
      );
      if (filteredEvents.length) {
        this.logger.showEvents(filteredEvents);
        this.didChange(filteredEvents);
        const workdirOrHeadEvent = filteredEvents.some((event) =>
          allPaths(event).some(isWorkdirOrHeadPath),
        );
        if (workdirOrHeadEvent) {
          this.logger.showWorkdirOrHeadEvents();
          this.didChangeWorkdirOrHead();
        }
      }
    };

    const reconcile = () => {
      if (this.destroyed) return;
      this.emitter.emit("did-invalidate");
      this.didChangeWorkdirOrHead();
    };
    const watch = (directoryPath) => {
      const watcher = watchDirectory(directoryPath, { recursive: true });
      this.watchSubscriptions.add(
        watcher,
        watcher.onDidChange(handleEvents),
        watcher.onDidInvalidate(reconcile),
        watcher.onDidError((error) => console.warn("Repository watch failed", error)),
      );
      return watcher;
    };
    try {
      this.currentFileWatcher = watch(workingDirectory);
      const watchers = [this.currentFileWatcher];
      // A normal .git directory is already covered by the root's recursive
      // stream. Separate Git directories and worktree metadata need their own.
      if (!contains(workingDirectory, gitDirectory)) {
        this.currentGitDirectoryWatcher = watch(gitDirectory);
        watchers.push(this.currentGitDirectoryWatcher);
      }
      await Promise.all(watchers.map((watcher) => watcher.ready));
    } catch (error) {
      await this.stopCurrentFileWatcher();
      throw error;
    }
    if (this.destroyed) return;
    this.logger.showStarted(workingDirectory, "editor watchDirectory");
  }

  stopCurrentFileWatcher() {
    const watchers = [this.currentFileWatcher, this.currentGitDirectoryWatcher].filter(Boolean);
    if (watchers.length > 0) {
      this.currentFileWatcher = null;
      this.currentGitDirectoryWatcher = null;
      this.watchSubscriptions.dispose();
      this.logger.showStopped();
      return Promise.all(watchers.map((watcher) => watcher.closed));
    }
    return Promise.resolve();
  }
}
