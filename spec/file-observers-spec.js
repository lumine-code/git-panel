/** @babel */
import fs from "fs";
import os from "os";
import path from "path";
import { Disposable } from "lumine";
import FileSystemChangeObserver from "../lib/models/file-system-change-observer";
import WorkspaceChangeObserver from "../lib/models/workspace-change-observer";

describe("file observation for repository state", () => {
  let directory, observer;
  beforeEach(() => {
    jasmine.useRealClock();
    directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "git-observer-")));
    observer = new FileSystemChangeObserver({ getWorkingDirectoryPath: () => directory });
  });
  afterEach(async () => {
    await observer.destroy();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  it("delivers native changes after ready and releases the subscription on destroy", async () => {
    const events = [];
    observer.onDidChange((batch) => events.push(...batch));
    const firstStart = observer.start();
    expect(observer.start()).toBe(firstStart);
    await firstStart;
    const filePath = path.join(directory, "outside.txt");
    fs.writeFileSync(filePath, "outside");
    await globalThis.conditionPromise(() => events.some((event) => event.path === filePath));
    await observer.destroy();
    expect(observer.isStarted()).toBe(false);
    expect(observer.currentFileWatcher).toBeNull();
  });
  it("invalidates repository state when the watch stream loses continuity", async () => {
    let invalidate;
    const handle = {
      path: directory,
      ready: Promise.resolve(),
      closed: Promise.resolve(),
      onDidChange: () => new Disposable(),
      onDidInvalidate: (callback) => {
        invalidate = callback;
        return new Disposable();
      },
      onDidError: () => new Disposable(),
      dispose() {},
    };
    spyOn(lumine.fileWatchClient, "watchDirectory").and.returnValue(handle);
    const changed = jasmine.createSpy("changed");
    const workdirChanged = jasmine.createSpy("workdirChanged");
    observer.onDidInvalidate(changed);
    observer.onDidChangeWorkdirOrHead(workdirChanged);
    await observer.start();
    invalidate({ path: directory, reason: "worker-restart", generation: 2 });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(workdirChanged).toHaveBeenCalledTimes(1);
  });
});

describe("workspace observation for repository state", () => {
  let workingDirectory, gitDirectory, observer;

  beforeEach(() => {
    workingDirectory = path.join(os.tmpdir(), "git-workspace-observer-repo");
    gitDirectory = path.join(workingDirectory, ".git");
    observer = new WorkspaceChangeObserver(null, null, {
      getWorkingDirectoryPath: () => workingDirectory,
      getGitDirectoryPath: () => gitDirectory,
    });
  });

  afterEach(async () => {
    await observer.destroy();
  });

  function observeBuffer(initialPath) {
    let filePath = initialPath;
    const callbacks = {};
    const buffer = {
      getPath: () => filePath,
      onDidSave: (callback) => {
        callbacks.save = callback;
        return new Disposable();
      },
      onDidReload: (callback) => {
        callbacks.reload = callback;
        return new Disposable();
      },
      onDidDestroy: (callback) => {
        callbacks.destroy = callback;
        return new Disposable();
      },
    };
    observer.observeTextEditor({ getBuffer: () => buffer });
    return {
      save: (newPath = filePath) => {
        filePath = newPath;
        callbacks.save();
      },
      reload: () => callbacks.reload(),
      destroy: () => callbacks.destroy(),
    };
  }

  async function observeMetadata() {
    let onChange;
    const handle = {
      ready: Promise.resolve(),
      closed: Promise.resolve(),
      onDidChange: (callback) => {
        onChange = callback;
        return new Disposable();
      },
      onDidInvalidate: () => new Disposable(),
      onDidError: () => new Disposable(),
      dispose() {},
    };
    const watch = spyOn(lumine.fileWatchClient, "watchDirectory").and.returnValue(handle);
    await observer.watchActiveRepositoryGitDirectory();
    expect(watch).toHaveBeenCalledOnceWith(gitDirectory, { recursive: true });
    return onChange;
  }

  it("reports HEAD and ref changes as working-directory or HEAD changes", async () => {
    const changed = jasmine.createSpy("changed");
    const workdirChanged = jasmine.createSpy("workdirChanged");
    observer.onDidChange(changed);
    observer.onDidChangeWorkdirOrHead(workdirChanged);
    const notify = await observeMetadata();

    for (const relativePath of ["HEAD", "MERGE_HEAD", path.join("refs", "heads", "main")]) {
      const event = { action: "modified", path: path.join(gitDirectory, relativePath) };
      notify([event]);
      expect(changed.calls.mostRecent().args).toEqual([[event]]);
    }

    expect(workdirChanged).toHaveBeenCalledTimes(3);
  });

  it("reports index and config edits without declaring a HEAD change", async () => {
    const changed = jasmine.createSpy("changed");
    const workdirChanged = jasmine.createSpy("workdirChanged");
    observer.onDidChange(changed);
    observer.onDidChangeWorkdirOrHead(workdirChanged);
    const notify = await observeMetadata();

    for (const relativePath of ["index", "config"]) {
      notify([{ action: "modified", path: path.join(gitDirectory, relativePath) }]);
    }

    expect(changed).toHaveBeenCalledTimes(2);
    expect(workdirChanged).not.toHaveBeenCalled();
  });

  it("observes refs relative to a separate Git directory with an arbitrary name", async () => {
    gitDirectory = path.join(os.tmpdir(), "repository-metadata");
    const changed = jasmine.createSpy("changed");
    const workdirChanged = jasmine.createSpy("workdirChanged");
    observer.onDidChange(changed);
    observer.onDidChangeWorkdirOrHead(workdirChanged);
    const notify = await observeMetadata();
    const event = {
      action: "renamed",
      path: path.join(gitDirectory, "refs", "heads", "new-name"),
      oldPath: path.join(gitDirectory, "refs", "heads", "old-name"),
    };

    notify([event]);

    expect(changed).toHaveBeenCalledOnceWith([event]);
    expect(workdirChanged).toHaveBeenCalledTimes(1);
  });

  it("ignores metadata lookalikes below objects and outside the chosen Git directory", async () => {
    const changed = jasmine.createSpy("changed");
    observer.onDidChange(changed);
    const notify = await observeMetadata();

    notify([
      { action: "modified", path: path.join(gitDirectory, "objects", "HEAD") },
      { action: "modified", path: path.join(`${gitDirectory}-other`, "HEAD") },
    ]);

    expect(changed).not.toHaveBeenCalled();
  });

  it("matches repository path boundaries rather than directory name substrings", () => {
    expect(observer.activeRepositoryContainsPath(path.join(workingDirectory, "file.txt"))).toBe(
      true,
    );
    expect(
      observer.activeRepositoryContainsPath(path.join(`${workingDirectory}-other`, "file.txt")),
    ).toBe(false);
    expect(observer.activeRepositoryContainsPath(null)).toBe(false);
  });

  it("does not invalidate a repository for saves in a sibling with a shared name prefix", () => {
    const changed = jasmine.createSpy("changed");
    observer.onDidChange(changed);
    const buffer = observeBuffer(path.join(`${workingDirectory}-other`, "file.txt"));

    buffer.save();
    buffer.reload();
    buffer.destroy();

    expect(changed).not.toHaveBeenCalled();
  });

  it("reports a rename out of the repository once and ignores later saves outside it", () => {
    const oldPath = path.join(workingDirectory, "file.txt");
    const newPath = path.join(os.tmpdir(), "another-repository", "file.txt");
    const changed = jasmine.createSpy("changed");
    observer.onDidChange(changed);
    const buffer = observeBuffer(oldPath);

    buffer.save(newPath);
    buffer.save();

    expect(changed).toHaveBeenCalledOnceWith([{ action: "renamed", path: newPath, oldPath }]);
  });

  it("reports a rename into the repository from its prior buffer path", () => {
    const oldPath = path.join(`${workingDirectory}-other`, "file.txt");
    const newPath = path.join(workingDirectory, "file.txt");
    const changed = jasmine.createSpy("changed");
    observer.onDidChange(changed);
    const buffer = observeBuffer(oldPath);

    buffer.save(newPath);

    expect(changed).toHaveBeenCalledOnceWith([{ action: "renamed", path: newPath, oldPath }]);
  });

  it("reports the prior repository path when a buffer loses its path", () => {
    const oldPath = path.join(workingDirectory, "file.txt");
    const changed = jasmine.createSpy("changed");
    observer.onDidChange(changed);
    const buffer = observeBuffer(oldPath);

    buffer.save(null);
    buffer.save();
    buffer.destroy();

    expect(changed).toHaveBeenCalledOnceWith([{ action: "renamed", path: null, oldPath }]);
  });
});
