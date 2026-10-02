/** @babel */
import path from "path";
import { CompositeDisposable, Disposable, Emitter } from "lumine";
import { watchDirectory } from "lumine";

import EventLogger from "./event-logger";
import { autobind } from "../helpers";

export const FOCUS = Symbol("focus");

export default class WorkspaceChangeObserver {
  constructor(window, workspace, repository) {
    autobind(this, "observeTextEditor");

    this.window = window;
    this.repository = repository;
    this.workspace = workspace;
    this.observedBuffers = new WeakSet();
    this.emitter = new Emitter();
    this.disposables = new CompositeDisposable();
    this.logger = new EventLogger("workspace watcher");
    this.started = false;
    this.destroyed = false;
  }

  start() {
    this.startPromise ??= this.startWatching();
    return this.startPromise;
  }

  async startWatching() {
    const focusHandler = (event) => {
      if (this.repository) {
        this.logger.showFocusEvent();
        this.didChange([{ special: FOCUS }]);
      }
    };
    this.window.addEventListener("focus", focusHandler);
    this.disposables.add(
      this.workspace.observeTextEditors(this.observeTextEditor),
      new Disposable(() => this.window.removeEventListener("focus", focusHandler)),
    );
    await this.watchActiveRepositoryGitDirectory();
    this.started = !this.destroyed;
    return this;
  }

  async destroy() {
    this.started = false;
    this.destroyed = true;
    this.observedBuffers = new WeakSet();
    this.emitter.dispose();
    this.disposables.dispose();
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

  async watchActiveRepositoryGitDirectory() {
    const repository = this.getRepository();
    const gitDirectoryPath = repository.getGitDirectoryPath();

    const pathsOfInterest = ["config", "index", "HEAD", "MERGE_HEAD"];
    const isRefPath = (relativePath) =>
      relativePath === "refs" || relativePath.startsWith(`refs${path.sep}`);
    const relativeGitPath = (eventPath) => path.relative(gitDirectoryPath, eventPath);

    const eventPaths = (event) => {
      const ps = [event.path];
      if (event.oldPath) {
        ps.push(event.oldPath);
      }
      return ps;
    };

    const acceptEvent = (event) => {
      return eventPaths(event).some((eventPath) => {
        const relativePath = relativeGitPath(eventPath);
        return pathsOfInterest.includes(relativePath) || isRefPath(relativePath);
      });
    };

    const isWorkdirOrHeadEvent = (event) => {
      return eventPaths(event).some((eventPath) => {
        const relativePath = relativeGitPath(eventPath);
        return ["HEAD", "MERGE_HEAD"].includes(relativePath) || isRefPath(relativePath);
      });
    };

    const watcher = watchDirectory(gitDirectoryPath, { recursive: true });
    this.currentFileWatcher = watcher;
    this.disposables.add(
      watcher,
      watcher.onDidChange((events) => {
        const filteredEvents = events.filter(acceptEvent);

        if (filteredEvents.length) {
          this.logger.showEvents(filteredEvents);
          this.didChange(filteredEvents);
          if (filteredEvents.some(isWorkdirOrHeadEvent)) {
            this.logger.showWorkdirOrHeadEvents();
            this.didChangeWorkdirOrHead();
          }
        }
      }),
      watcher.onDidInvalidate(() => {
        if (this.destroyed) return;
        this.emitter.emit("did-invalidate");
        this.didChangeWorkdirOrHead();
      }),
    );

    this.disposables.add(
      watcher.onDidError((error) => {
        const workingDirectory = repository.getWorkingDirectoryPath();

        console.warn(`Error in WorkspaceChangeObserver in ${workingDirectory}:`, error);
      }),
    );
    await watcher.ready;

    this.logger.showStarted(gitDirectoryPath, "workspace emulated");
  }

  stopCurrentFileWatcher() {
    if (this.currentFileWatcher) {
      const watcher = this.currentFileWatcher;
      watcher.dispose();
      this.currentFileWatcher = null;
      this.logger.showStopped();
      return watcher.closed;
    }
    return Promise.resolve();
  }

  activeRepositoryContainsPath(filePath) {
    const repository = this.getRepository();
    if (filePath && repository) {
      const relativePath = path.relative(repository.getWorkingDirectoryPath(), filePath);
      return (
        relativePath !== ".." &&
        !relativePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativePath)
      );
    } else {
      return false;
    }
  }

  observeTextEditor(editor) {
    const buffer = editor.getBuffer();
    if (!this.observedBuffers.has(buffer)) {
      let lastPath = buffer.getPath();
      const didChange = () => {
        const currentPath = buffer.getPath();
        const affectsRepository =
          this.activeRepositoryContainsPath(currentPath) ||
          this.activeRepositoryContainsPath(lastPath);
        const events =
          currentPath === lastPath
            ? [{ action: "modified", path: currentPath }]
            : [{ action: "renamed", path: currentPath, oldPath: lastPath }];
        lastPath = currentPath;
        if (!affectsRepository) return;
        this.logger.showEvents(events);
        this.didChange(events);
      };

      this.observedBuffers.add(buffer);
      const disposables = new CompositeDisposable(
        buffer.onDidSave(didChange),
        buffer.onDidReload(didChange),
        buffer.onDidDestroy(() => {
          didChange();
          disposables.dispose();
        }),
      );
      this.disposables.add(disposables);
    }
  }
}
