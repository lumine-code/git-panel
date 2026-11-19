/** @babel */
import path from "path";
import { Disposable, GitRepository } from "lumine";

import GitPackage from "../lib/git-package.js";
import GitShellOutStrategy from "../lib/git-shell-out-strategy.js";
import Repository from "../lib/models/repository.js";
import { createRepoSym } from "../lib/models/workdir-context.js";

async function flush() {
  for (let pass = 0; pass < 30; pass++) await Promise.resolve();
}

describe("status refresh frequency", () => {
  let core, panel, context, observation, watchChanges, watchInvalidations, snapshots, revision;
  const directory = path.resolve("status-refresh-frequency-repository");
  const gitDirectory = path.resolve("status-refresh-frequency-metadata");

  beforeEach(() => {
    snapshots = [];
    revision = 0;
    watchChanges = new Map();
    watchInvalidations = new Map();
    core = new GitRepository(
      {
        getPath: () => gitDirectory,
        getWorkingDirectory: () => directory,
      },
      {
        gitHostClient: {
          async getSnapshot(_descriptor, request) {
            snapshots.push(request);
            const statusFingerprint = `status-${revision}`;
            const refsFingerprint = `refs-${revision}`;
            return {
              status: !request.status
                ? undefined
                : request.knownFingerprints.status === statusFingerprint
                  ? { fingerprint: statusFingerprint, unchanged: true }
                  : {
                      fingerprint: statusFingerprint,
                      unchanged: false,
                      value: {
                        schemaVersion: 1,
                        generation: request.generations.status,
                        initialized: true,
                        includesIgnored: true,
                        head: {
                          oid: revision.toString(16).padStart(40, "0"),
                          name: "main",
                          unborn: false,
                          detached: false,
                        },
                        upstream: null,
                        files: [],
                        counts: {
                          total: 0,
                          staged: 0,
                          unstaged: 0,
                          conflicted: 0,
                          untracked: 0,
                          ignored: 0,
                        },
                      },
                    },
              refs: !request.refs
                ? undefined
                : request.knownFingerprints.refs === refsFingerprint
                  ? { fingerprint: refsFingerprint, unchanged: true }
                  : {
                      fingerprint: refsFingerprint,
                      value: {
                        schemaVersion: 1,
                        generation: request.generations.refs,
                        initialized: true,
                        head: { oid: revision.toString(16).padStart(40, "0"), name: "main" },
                        branches: [],
                        remoteBranches: [],
                        tags: [],
                        remotes: [],
                        worktrees: [],
                      },
                    },
            };
          },
        },
      },
    );
    spyOn(lumine.repositories, "getForPath").withArgs(directory).and.returnValue(core);
    spyOn(lumine.repositories, "add").and.resolveTo({ repository: core, dispose() {} });
    spyOn(lumine.fileWatchClient, "watchDirectory").and.callFake((root) => ({
      ready: Promise.resolve(),
      closed: Promise.resolve(),
      onDidChange: (callback) => {
        watchChanges.set(root, callback);
        return new Disposable();
      },
      onDidInvalidate: (callback) => {
        watchInvalidations.set(root, callback);
        return new Disposable();
      },
      onDidError: () => new Disposable(),
      dispose() {},
    }));
  });

  afterEach(async () => {
    observation?.dispose();
    await context?.destroy();
    await panel?.deactivate();
    core?.destroy();
    await flush();
    observation = context = panel = null;
  });

  async function observe({ workspace } = {}) {
    panel = new GitPackage({
      workspace: lumine.workspace,
      project: lumine.project,
      config: lumine.config,
      repositories: lumine.repositories,
      getInitialPaths: () => [],
    });
    const strategy = new GitShellOutStrategy(directory);
    spyOn(strategy, "getCoreRepository").and.resolveTo(core);
    spyOn(strategy, "resolveDotGitDir").and.resolveTo(gitDirectory);
    spyOn(strategy, "resolveCommonGitDir").and.resolveTo(gitDirectory);
    spyOn(strategy, "getConfig").and.resolveTo(null);
    context = panel.contextPool.add(directory, {
      [createRepoSym]: () => new Repository(directory, strategy),
      workspace,
    });
    spyOn(context, "useWorkspaceChangeObserver").and.returnValue(Boolean(workspace));
    observation = panel.contextPool.retain(directory);
    await observation.ready;
    await flush();
    snapshots.length = 0;
  }

  function change(name = "changed.txt") {
    watchChanges.get(directory)([{ action: "modified", path: path.join(directory, name) }]);
  }

  it("does not poll an idle repository", async () => {
    await observe();
    globalThis.advanceClock(60000);
    await flush();

    expect(snapshots.length).toBe(0);
  });

  it("combines separate native event batches into one current status read", async () => {
    await observe();
    for (let batch = 0; batch < 6; batch++) {
      revision++;
      change(`changed-${batch}.txt`);
      await flush();
      globalThis.advanceClock(20);
    }

    expect(snapshots.length).toBe(0);
    globalThis.advanceClock(30);
    await flush();
    expect(snapshots.length).toBe(1);
    expect(snapshots[0]).toEqual(jasmine.objectContaining({ status: true, refs: false }));
    expect(core.getStatusSnapshot().head.oid).toBe("6".padStart(40, "0"));
  });

  it("shares a later core watcher notification for the same file event", async () => {
    await observe();
    revision++;
    change();
    await flush();
    core.scheduleStatusSnapshotRefresh();
    globalThis.advanceClock(150);
    await flush();

    expect(snapshots.length).toBe(1);
    expect(core.getStatusSnapshot().head.oid).toBe("1".padStart(40, "0"));
  });

  it("shares an earlier core watcher notification for the same file event", async () => {
    await observe();
    revision++;
    core.scheduleStatusSnapshotRefresh();
    change();
    await flush();
    globalThis.advanceClock(150);
    await flush();

    expect(snapshots.length).toBe(1);
    expect(core.getStatusSnapshot().head.oid).toBe("1".padStart(40, "0"));
  });

  it("refreshes only status for a save reported by the workspace observer", async () => {
    let save;
    const buffer = {
      getPath: () => path.join(directory, "changed.txt"),
      onDidSave: (callback) => {
        save = callback;
        return new Disposable();
      },
      onDidReload: () => new Disposable(),
      onDidDestroy: () => new Disposable(),
    };
    await observe({
      workspace: {
        observeTextEditors(callback) {
          callback({ getBuffer: () => buffer });
          return new Disposable();
        },
      },
    });
    revision++;
    save();
    await flush();
    expect(snapshots).toEqual([]);
    globalThis.advanceClock(150);
    await flush();

    expect(snapshots.length).toBe(1);
    expect(snapshots[0]).toEqual(jasmine.objectContaining({ status: true, refs: false }));
  });

  it("refreshes status and refs once for a branch changed in external Git metadata", async () => {
    await observe();
    revision++;
    watchChanges.get(gitDirectory)([
      { action: "modified", path: path.join(gitDirectory, "refs", "heads", "main") },
    ]);
    await flush();
    expect(snapshots).toEqual([]);
    globalThis.advanceClock(150);
    await flush();

    expect(snapshots.length).toBe(1);
    expect(snapshots[0]).toEqual(jasmine.objectContaining({ status: true, refs: true }));
    expect(core.getStatusSnapshot().head.oid).toBe("1".padStart(40, "0"));
    expect(core.getRefsSnapshot().head.oid).toBe("1".padStart(40, "0"));
  });

  it("refreshes only status when external MERGE_HEAD changes", async () => {
    await observe();
    watchChanges.get(gitDirectory)([
      { action: "deleted", path: path.join(gitDirectory, "MERGE_HEAD") },
    ]);
    await flush();
    expect(snapshots).toEqual([]);
    globalThis.advanceClock(150);
    await flush();

    expect(snapshots.length).toBe(1);
    expect(snapshots[0]).toEqual(jasmine.objectContaining({ status: true, refs: false }));
  });

  it("refreshes both snapshots after the watcher loses continuity", async () => {
    await observe();
    watchInvalidations.get(directory)({ reason: "worker-restart" });
    await flush();
    expect(snapshots).toEqual([]);
    globalThis.advanceClock(150);
    await flush();

    expect(snapshots.length).toBe(1);
    expect(snapshots[0]).toEqual(jasmine.objectContaining({ status: true, refs: true }));
  });
});
