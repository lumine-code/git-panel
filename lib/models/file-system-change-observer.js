/** @babel */
import { Emitter, CompositeDisposable, watchDirectory } from "lumine";

import path from "path";

import EventLogger from "./event-logger";
import {
  containsPath,
  metadataDirectories,
  relativeMetadataPath,
  isRefPath,
  isWatchedMetadataPath,
  isPublishedReftablePath,
} from "./repository-metadata";

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
    const gitDirectories = metadataDirectories(this.repository);
    if (!gitDirectories.length) gitDirectories.push(gitDirectory);
    const relativeGitPath = (eventPath) => relativeMetadataPath(gitDirectories, eventPath);
    const allPaths = (event) => {
      const ps = [event.path];
      if (event.oldPath) {
        ps.push(event.oldPath);
      }
      return ps;
    };

    const isWorkingFile = (eventPath) =>
      containsPath(workingDirectory, eventPath) &&
      !gitDirectories.some((directory) => containsPath(directory, eventPath)) &&
      !path.relative(workingDirectory, eventPath).split(path.sep).includes(".git");
    const isWatchedGitFile = (eventPath) => isWatchedMetadataPath(relativeGitPath(eventPath));
    const isWorkdirOrHeadPath = (eventPath) => {
      const relativePath = relativeGitPath(eventPath);
      return (
        isWorkingFile(eventPath) ||
        ["HEAD", "MERGE_HEAD", "packed-refs"].includes(relativePath) ||
        isRefPath(relativePath) ||
        isPublishedReftablePath(relativePath)
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
      this.currentMetadataWatchers = [];
      // A normal .git directory is already covered by the root's recursive
      // stream. Separate Git directories and worktree metadata need their own.
      const externalRoots = gitDirectories.filter(
        (directory) =>
          !containsPath(workingDirectory, directory) &&
          !gitDirectories.some((other) => other !== directory && containsPath(other, directory)),
      );
      for (const directory of externalRoots) {
        const watcher = watch(directory);
        this.currentMetadataWatchers.push(watcher);
        this.currentGitDirectoryWatcher ??= watcher;
        watchers.push(watcher);
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
    const watchers = [this.currentFileWatcher, ...(this.currentMetadataWatchers || [])].filter(
      Boolean,
    );
    if (watchers.length > 0) {
      this.currentFileWatcher = null;
      this.currentGitDirectoryWatcher = null;
      this.currentMetadataWatchers = [];
      this.watchSubscriptions.dispose();
      this.logger.showStopped();
      return Promise.all(watchers.map((watcher) => watcher.closed));
    }
    return Promise.resolve();
  }
}
