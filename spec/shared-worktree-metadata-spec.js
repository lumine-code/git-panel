/** @babel */
import fs from "fs";
import externalGit from "./helpers/external-git";
import os from "os";
import path from "path";
import { Disposable } from "lumine";
import Repository from "../lib/models/repository";
import FileSystemChangeObserver from "../lib/models/file-system-change-observer";
import WorkspaceChangeObserver, { FOCUS } from "../lib/models/workspace-change-observer";
import GitShellOutStrategy from "../lib/git-shell-out-strategy";
import { metadataDirectories, relativeMetadataPath } from "../lib/models/repository-metadata";

describe("Shared worktree metadata", () => {
  let fixture;
  let repository;
  let observer;
  let core;

  beforeEach(() => {
    jasmine.useRealClock?.();
    repository = null;
    observer = null;
    core = null;
    fixture = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-shared-metadata-")),
    );
  });

  afterEach(async () => {
    await observer?.destroy();
    repository?.destroy();
    if (core) lumine.repositories.forget(core);
    await fs.promises.rm(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  const git = (directory, ...args) =>
    externalGit([
      "-C",
      directory,
      "-c",
      "user.name=Shared Metadata Specs",
      "-c",
      "user.email=specs@lumine.invalid",
      ...args,
    ]);

  async function worktree() {
    const main = path.join(fixture, "main");
    const linked = path.join(fixture, "linked");
    fs.mkdirSync(main);
    await git(main, "init", "--initial-branch=main");
    await git(main, "commit", "--allow-empty", "-m", "Initial");
    const initial = (await git(main, "rev-parse", "HEAD")).stdout.trim();
    await git(main, "remote", "add", "origin", "https://example.invalid/old.git");
    await git(main, "update-ref", "refs/remotes/origin/main", initial);
    await git(main, "update-ref", "refs/remotes/origin/next", initial);
    await git(main, "worktree", "add", "-b", "linked-branch", linked);
    await git(main, "config", "branch.linked-branch.remote", "origin");
    await git(main, "config", "branch.linked-branch.merge", "refs/heads/main");
    repository = new Repository(linked);
    await repository.getLoadPromise();
    core = await repository.git.getCoreRepository();
    return { main, linked, initial, common: path.join(main, ".git") };
  }

  it("publishes private and common paths before the repository becomes present", async () => {
    const { common } = await worktree();
    expect(core.getCommonDirectory()).toBe(common);
    expect(repository.getCommonDirectoryPath()).toBe(common);
    expect(repository.getGitDirectoryPath()).toBe(path.join(common, "worktrees", "linked"));
  });

  it("classifies private metadata before its containing shared directory", () => {
    const common = path.join(fixture, "metadata");
    const privateDirectory = path.join(common, "worktrees", "linked");
    const directories = metadataDirectories({
      getGitDirectoryPath: () => privateDirectory,
      getCommonDirectoryPath: () => common,
    });
    expect(relativeMetadataPath(directories, path.join(privateDirectory, "HEAD"))).toBe("HEAD");
    expect(relativeMetadataPath(directories, path.join(common, "config"))).toBe("config");
    expect(relativeMetadataPath(directories, path.join(`${common}-other`, "config"))).toBeNull();
    const nested = path.join(privateDirectory, "shared");
    expect(relativeMetadataPath([privateDirectory, nested], path.join(nested, "config"))).toBe(
      "config",
    );
  });

  it("observes external shared refs and config through one common metadata stream", async () => {
    const { main, linked, initial, common } = await worktree();
    observer = new FileSystemChangeObserver(repository);
    const changes = [];
    observer.onDidChange((events) => {
      changes.push(...events);
      repository.observeFilesystemChange(events);
    });
    await observer.start();
    expect(observer.currentFileWatcher.path).toBe(linked);
    expect(observer.currentMetadataWatchers.map(({ path }) => path)).toEqual([common]);
    expect((await repository.getLastCommit()).getSha()).toBe(initial);
    expect((await repository.getCurrentBranch()).getUpstream().getName()).toBe(
      "refs/remotes/origin/main",
    );
    expect((await repository.getRemotes()).withName("origin").fetchUrl).toBe(
      "https://example.invalid/old.git",
    );
    expect(await repository.getConfig("remote.origin.url")).toBe("https://example.invalid/old.git");

    const external = (
      await git(main, "commit-tree", "HEAD^{tree}", "-p", initial, "-m", "External common commit")
    ).stdout.trim();
    await git(main, "update-ref", "refs/heads/linked-branch", external);
    await git(main, "config", "remote.origin.url", "https://example.invalid/new.git");
    await git(main, "config", "branch.linked-branch.merge", "refs/heads/next");
    await globalThis.conditionPromise(
      () =>
        changes.some(
          ({ path: target }) => target === path.join(common, "refs", "heads", "linked-branch"),
        ) && changes.some(({ path: target }) => target === path.join(common, "config")),
    );

    expect((await repository.getLastCommit()).getSha()).toBe(external);
    expect((await repository.getCurrentBranch()).getUpstream().getName()).toBe(
      "refs/remotes/origin/next",
    );
    expect((await repository.getRemotes()).withName("origin").fetchUrl).toBe(
      "https://example.invalid/new.git",
    );
    expect(await repository.getConfig("remote.origin.url")).toBe("https://example.invalid/new.git");
  }, 15000);

  it("ignores other worktrees' private files while accepting common refs and packed refs", async () => {
    const { common } = await worktree();
    observer = new WorkspaceChangeObserver(null, null, repository);
    let notify;
    const handle = {
      ready: Promise.resolve(),
      closed: Promise.resolve(),
      onDidChange: (callback) => {
        notify = callback;
        return new Disposable();
      },
      onDidInvalidate: () => new Disposable(),
      onDidError: () => new Disposable(),
      dispose() {},
    };
    const watch = spyOn(lumine.fileWatchClient, "watchDirectory").and.returnValue(handle);
    const changed = jasmine.createSpy("changed");
    observer.onDidChange(changed);
    await observer.watchActiveRepositoryGitDirectory();
    expect(watch).toHaveBeenCalledOnceWith(common, { recursive: true });
    notify([{ action: "updated", path: path.join(common, "worktrees", "other", "HEAD") }]);
    notify([{ action: "created", path: path.join(common, "refs", "heads", "linked-branch.lock") }]);
    notify([
      { action: "updated", path: path.join(common, "reftable", "tables.list.tmp") },
      { action: "created", path: path.join(common, "reftable", "0001.ref") },
    ]);
    expect(changed).not.toHaveBeenCalled();
    for (const relative of [
      "config",
      "packed-refs",
      path.join("refs", "heads", "linked-branch"),
      "reftable",
      path.join("reftable", "tables.list"),
    ]) {
      const event = { action: "updated", path: path.join(common, relative) };
      notify([event]);
      expect(changed.calls.mostRecent().args).toEqual([[event]]);
    }
  });

  it("makes full refresh and focus clear mutable ref/config caches", async () => {
    await worktree();
    await repository.getCurrentBranch();
    const dirty = spyOn(repository.git, "observeRefsChange").and.callThrough();
    repository.refresh();
    expect(dirty).toHaveBeenCalledTimes(1);
    repository.observeFilesystemChange([{ special: FOCUS }]);
    expect(dirty).toHaveBeenCalledTimes(2);
  });

  for (const relative of ["reftable", path.join("reftable", "tables.list")]) {
    it(`rebuilds mutable HEAD and branch caches on publication at ${relative}`, async () => {
      const { main, initial, common } = await worktree();
      expect((await repository.getLastCommit()).getSha()).toBe(initial);
      expect((await repository.getBranches()).getNames()).not.toContain("external-branch");
      const external = (
        await git(main, "commit-tree", "HEAD^{tree}", "-p", initial, "-m", "New backend head")
      ).stdout.trim();
      await git(main, "update-ref", "refs/heads/linked-branch", external);
      await git(main, "branch", "external-branch");
      repository.observeFilesystemChange([
        { action: "updated", path: path.join(common, relative) },
      ]);
      expect((await repository.getLastCommit()).getSha()).toBe(external);
      expect((await repository.getBranches()).getNames()).toContain("external-branch");
    });
  }

  it("delegates resumed ref freshness to core's snapshot refresh", async () => {
    const strategy = new GitShellOutStrategy(fixture);
    const snapshot = { initialized: true };
    const repository = {
      ensureRefsSnapshot: jasmine.createSpy("ensure refs").and.resolveTo(snapshot),
      refreshRefsSnapshot: jasmine.createSpy("refresh refs").and.resolveTo(snapshot),
    };
    spyOn(strategy, "getCoreRepository").and.resolveTo(repository);
    try {
      expect(await strategy.getRefsSnapshot()).toBe(snapshot);
      strategy.observeRefsChange();
      expect(await strategy.getRefsSnapshot()).toBe(snapshot);
      expect(repository.refreshRefsSnapshot).toHaveBeenCalledTimes(1);
    } finally {
      strategy.destroy();
    }
  });

  it("disposes and awaits independent private and common metadata streams", async () => {
    const privateDirectory = `${fixture}-private`;
    const common = `${fixture}-common`;
    const handles = new Map();
    let finishCommon;
    const commonClosed = new Promise((resolve) => {
      finishCommon = resolve;
    });
    spyOn(lumine.fileWatchClient, "watchDirectory").and.callFake((directory) => {
      const handle = {
        path: directory,
        ready: Promise.resolve(),
        closed: directory === common ? commonClosed : Promise.resolve(),
        onDidChange: () => new Disposable(),
        onDidInvalidate: () => new Disposable(),
        onDidError: () => new Disposable(),
        dispose: jasmine.createSpy("dispose"),
      };
      handles.set(directory, handle);
      return handle;
    });
    observer = new FileSystemChangeObserver({
      getWorkingDirectoryPath: () => fixture,
      getGitDirectoryPath: () => privateDirectory,
      getCommonDirectoryPath: () => common,
    });
    await observer.start();
    expect(handles.size).toBe(3);
    let closed = false;
    const closing = observer.destroy().then(() => {
      closed = true;
    });
    await Promise.resolve();
    for (const handle of handles.values()) expect(handle.dispose).toHaveBeenCalledTimes(1);
    expect(closed).toBe(false);
    finishCommon();
    await closing;
    expect(observer.currentMetadataWatchers).toEqual([]);
  });

  it("releases both workspace metadata streams if the common stream fails to arm", async () => {
    const privateDirectory = `${fixture}-private`;
    const common = `${fixture}-common`;
    const failure = new Error("Common metadata could not be watched");
    const handles = [];
    spyOn(lumine.fileWatchClient, "watchDirectory").and.callFake((directory) => {
      const handle = {
        ready: directory === common ? Promise.reject(failure) : Promise.resolve(),
        closed: Promise.resolve(),
        onDidChange: () => new Disposable(),
        onDidInvalidate: () => new Disposable(),
        onDidError: () => new Disposable(),
        dispose: jasmine.createSpy("dispose"),
      };
      handles.push(handle);
      return handle;
    });
    observer = new WorkspaceChangeObserver(null, null, {
      getWorkingDirectoryPath: () => fixture,
      getGitDirectoryPath: () => privateDirectory,
      getCommonDirectoryPath: () => common,
    });
    await expectAsync(observer.watchActiveRepositoryGitDirectory()).toBeRejectedWith(failure);
    for (const handle of handles) expect(handle.dispose).toHaveBeenCalledTimes(1);
    expect(observer.currentFileWatchers).toEqual([]);
    expect(observer.currentFileWatcher).toBeNull();
  });
});
