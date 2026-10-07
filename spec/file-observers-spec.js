/** @babel */
import fs from "fs";
import externalGit from "./helpers/external-git";
import os from "os";
import path from "path";
import { Disposable } from "lumine";
import FileSystemChangeObserver from "../lib/models/file-system-change-observer";
import WorkspaceChangeObserver from "../lib/models/workspace-change-observer";
import Repository from "../lib/models/repository";

describe("file observation for repository state", () => {
  let directory, observer;
  beforeEach(() => {
    jasmine.useRealClock();
    directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "git-observer-")));
    observer = new FileSystemChangeObserver({ getWorkingDirectoryPath: () => directory });
  });
  afterEach(async () => {
    await observer.destroy();
    await fs.promises.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50,
    });
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

  function fakeWatcher(
    directoryPath,
    { ready = Promise.resolve(), closed = Promise.resolve() } = {},
  ) {
    const callbacks = {};
    const handle = {
      path: directoryPath,
      ready,
      closed,
      onDidChange: (callback) => {
        callbacks.change = callback;
        return new Disposable();
      },
      onDidInvalidate: (callback) => {
        callbacks.invalidate = callback;
        return new Disposable();
      },
      onDidError: () => new Disposable(),
      dispose: jasmine.createSpy("dispose"),
    };
    return { handle, callbacks };
  }

  it("uses one recursive watcher when the Git directory is inside the working directory", async () => {
    const { handle } = fakeWatcher(directory);
    const watch = spyOn(lumine.fileWatchClient, "watchDirectory").and.returnValue(handle);
    observer.repository.getGitDirectoryPath = () => path.join(directory, ".git");

    await observer.start();

    expect(watch).toHaveBeenCalledOnceWith(directory, { recursive: true });
    expect(observer.currentFileWatcher).toBe(handle);
  });

  it("filters metadata relative to an arbitrarily named Git directory inside the root", async () => {
    const gitDirectory = path.join(directory, "metadata");
    observer.repository.getGitDirectoryPath = () => gitDirectory;
    const { handle, callbacks } = fakeWatcher(directory);
    const watch = spyOn(lumine.fileWatchClient, "watchDirectory").and.returnValue(handle);
    const changed = jasmine.createSpy("changed");
    const workdirChanged = jasmine.createSpy("workdirChanged");
    observer.onDidChange(changed);
    observer.onDidChangeWorkdirOrHead(workdirChanged);
    await observer.start();

    callbacks.change([{ action: "modified", path: path.join(gitDirectory, "objects", "HEAD") }]);
    expect(changed).not.toHaveBeenCalled();

    const refEvent = {
      action: "modified",
      path: path.join(gitDirectory, "refs", "heads", "main"),
    };
    callbacks.change([refEvent]);
    expect(changed).toHaveBeenCalledOnceWith([refEvent]);
    expect(workdirChanged).toHaveBeenCalledTimes(1);
    expect(watch).toHaveBeenCalledTimes(1);
  });

  it("disposes and awaits both streams when the Git directory is outside the working directory", async () => {
    const gitDirectory = `${directory}-metadata`;
    observer.repository.getGitDirectoryPath = () => gitDirectory;
    let finishMetadataClose;
    const metadataClosed = new Promise((resolve) => (finishMetadataClose = resolve));
    const root = fakeWatcher(directory);
    const metadata = fakeWatcher(gitDirectory, { closed: metadataClosed });
    const watch = spyOn(lumine.fileWatchClient, "watchDirectory").and.callFake((directoryPath) =>
      directoryPath === directory ? root.handle : metadata.handle,
    );
    const invalidated = jasmine.createSpy("invalidated");
    observer.onDidInvalidate(invalidated);
    await observer.start();
    expect(watch.calls.allArgs()).toEqual([
      [directory, { recursive: true }],
      [gitDirectory, { recursive: true }],
    ]);
    expect(observer.currentFileWatcher).toBe(root.handle);

    metadata.callbacks.invalidate({ reason: "worker-restart" });
    expect(invalidated).toHaveBeenCalledTimes(1);

    let completed = false;
    const teardown = observer.destroy().then(() => (completed = true));
    await Promise.resolve();
    expect(root.handle.dispose).toHaveBeenCalledTimes(1);
    expect(metadata.handle.dispose).toHaveBeenCalledTimes(1);
    expect(completed).toBe(false);
    finishMetadataClose();
    await teardown;
    expect(observer.currentFileWatcher).toBeNull();
  });

  it("disposes both streams while metadata arming is pending and never starts after destroy", async () => {
    const gitDirectory = `${directory}-metadata`;
    observer.repository.getGitDirectoryPath = () => gitDirectory;
    let finishMetadataReady;
    const metadataReady = new Promise((resolve) => (finishMetadataReady = resolve));
    const root = fakeWatcher(directory);
    const metadata = fakeWatcher(gitDirectory, { ready: metadataReady });
    spyOn(lumine.fileWatchClient, "watchDirectory").and.callFake((directoryPath) =>
      directoryPath === directory ? root.handle : metadata.handle,
    );

    const starting = observer.start();
    await observer.destroy();
    expect(root.handle.dispose).toHaveBeenCalledTimes(1);
    expect(metadata.handle.dispose).toHaveBeenCalledTimes(1);
    expect(observer.isStarted()).toBe(false);

    finishMetadataReady();
    await starting;
    expect(observer.isStarted()).toBe(false);
    expect(observer.currentFileWatcher).toBeNull();
    expect(observer.currentGitDirectoryWatcher).toBeNull();
  });

  it("releases both streams when the metadata watcher fails to arm", async () => {
    const gitDirectory = `${directory}-metadata`;
    observer.repository.getGitDirectoryPath = () => gitDirectory;
    const failure = new Error("Metadata watch failed");
    const root = fakeWatcher(directory);
    const metadata = fakeWatcher(gitDirectory, { ready: Promise.reject(failure) });
    spyOn(lumine.fileWatchClient, "watchDirectory").and.callFake((directoryPath) =>
      directoryPath === directory ? root.handle : metadata.handle,
    );

    await expectAsync(observer.start()).toBeRejectedWith(failure);

    expect(root.handle.dispose).toHaveBeenCalledTimes(1);
    expect(metadata.handle.dispose).toHaveBeenCalledTimes(1);
    expect(observer.currentFileWatcher).toBeNull();
    expect(observer.currentGitDirectoryWatcher).toBeNull();
    expect(observer.isStarted()).toBe(false);
  });

  it("releases the root stream when creating the metadata watcher throws", async () => {
    const gitDirectory = `${directory}-metadata`;
    observer.repository.getGitDirectoryPath = () => gitDirectory;
    const failure = new Error("Metadata watch failed");
    const root = fakeWatcher(directory);
    spyOn(lumine.fileWatchClient, "watchDirectory").and.callFake((directoryPath) => {
      if (directoryPath === directory) return root.handle;
      throw failure;
    });

    await expectAsync(observer.start()).toBeRejectedWith(failure);

    expect(root.handle.dispose).toHaveBeenCalledTimes(1);
    expect(observer.currentFileWatcher).toBeNull();
    expect(observer.isStarted()).toBe(false);
  });

  it("receives external commits from a real separate Git directory", async () => {
    const workingDirectory = path.join(directory, "worktree");
    const gitDirectory = path.join(directory, "metadata");
    fs.mkdirSync(workingDirectory);
    const git = (...args) =>
      externalGit([
        "-C",
        workingDirectory,
        "-c",
        "user.name=Git Observer Specs",
        "-c",
        "user.email=specs@lumine.invalid",
        ...args,
      ]);
    await git("init", "--initial-branch=main", "--separate-git-dir", gitDirectory);
    const filePath = path.join(workingDirectory, "a.txt");
    fs.writeFileSync(filePath, "first\n");
    await git("add", "a.txt");
    await git("commit", "-m", "First commit");
    await observer.destroy();
    observer = new FileSystemChangeObserver({
      getWorkingDirectoryPath: () => workingDirectory,
      getGitDirectoryPath: () => gitDirectory,
    });
    const panelRepository = new Repository(workingDirectory);
    const events = [];
    observer.onDidChange((batch) => {
      events.push(...batch);
      panelRepository.observeFilesystemChange(batch);
    });
    let coreRepository;
    try {
      await panelRepository.getLoadPromise();
      coreRepository = lumine.repositories.getForPath(workingDirectory);
      expect((await panelRepository.getLastCommit()).getMessageSubject()).toBe("First commit");
      await observer.start();

      fs.writeFileSync(filePath, "second\n");
      await git("add", "a.txt");
      await git("commit", "-m", "Second commit");

      const refPath = path.join(gitDirectory, "refs", "heads", "main");
      await globalThis.conditionPromise(() => events.some((event) => event.path === refPath));
      expect(events.some((event) => event.path === path.join(gitDirectory, "index"))).toBe(true);
      expect((await panelRepository.getLastCommit()).getMessageSubject()).toBe("Second commit");
    } finally {
      await observer.destroy();
      panelRepository.destroy();
      if (coreRepository) lumine.repositories.forget(coreRepository);
    }
  }, 15000);
  it("receives HEAD changes from a linked worktree's private Git directory", async () => {
    const mainDirectory = path.join(directory, "main");
    const linkedDirectory = path.join(directory, "linked");
    fs.mkdirSync(mainDirectory);
    const git = (cwd, ...args) =>
      externalGit([
        "-C",
        cwd,
        "-c",
        "user.name=Git Observer Specs",
        "-c",
        "user.email=specs@lumine.invalid",
        ...args,
      ]);
    await git(mainDirectory, "init", "--initial-branch=main");
    fs.writeFileSync(path.join(mainDirectory, "a.txt"), "first\n");
    await git(mainDirectory, "add", "a.txt");
    await git(mainDirectory, "commit", "-m", "First commit");
    await git(mainDirectory, "worktree", "add", "-b", "feature", linkedDirectory);
    const result = await git(linkedDirectory, "rev-parse", "--absolute-git-dir");
    const gitDirectory = path.normalize(result.stdout.trim());
    await observer.destroy();
    observer = new FileSystemChangeObserver({
      getWorkingDirectoryPath: () => linkedDirectory,
      getGitDirectoryPath: () => gitDirectory,
    });
    const events = [];
    observer.onDidChange((batch) => events.push(...batch));
    await observer.start();

    await git(linkedDirectory, "switch", "-c", "changed");

    const headPath = path.join(gitDirectory, "HEAD");
    await globalThis.conditionPromise(() => events.some((event) => event.path === headPath));
  }, 15000);
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
