/** @babel */
import path from "path";
import { Disposable, GitRepository } from "lumine";

import GitShellOutStrategy from "../lib/git-shell-out-strategy.js";
import FileSystemChangeObserver from "../lib/models/file-system-change-observer.js";

async function flush() {
  for (let pass = 0; pass < 30; pass++) await Promise.resolve();
}

describe("status refresh frequency", () => {
  let core, strategy, observer, notify, snapshots, revision;
  const directory = path.resolve("status-refresh-frequency-repository");

  beforeEach(async () => {
    snapshots = [];
    revision = 0;
    core = new GitRepository(
      {
        getPath: () => path.join(directory, ".git"),
        getWorkingDirectory: () => directory,
      },
      {
        gitHostClient: {
          async getSnapshot(_descriptor, request) {
            snapshots.push(request);
            const fingerprint = `status-${revision}`;
            return {
              status:
                request.knownFingerprints.status === fingerprint
                  ? { fingerprint, unchanged: true }
                  : {
                      fingerprint,
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
            };
          },
        },
      },
    );
    core.onDidChangeStatusSnapshot(() => {});
    await core.refreshStatusSnapshot();
    await flush();
    snapshots.length = 0;

    strategy = new GitShellOutStrategy(directory);
    spyOn(strategy, "getCoreRepository").and.resolveTo(core);
    const watcher = {
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
    spyOn(lumine.fileWatchClient, "watchDirectory").and.returnValue(watcher);
    observer = new FileSystemChangeObserver({
      getWorkingDirectoryPath: () => directory,
      getGitDirectoryPath: () => path.join(directory, ".git"),
    });
    observer.onDidChange(() => strategy.observeStatusChange());
    await observer.start();
  });

  afterEach(async () => {
    await observer?.destroy();
    strategy?.destroy();
    core?.destroy();
    await flush();
  });

  function change(name = "changed.txt") {
    notify([{ action: "modified", path: path.join(directory, name) }]);
  }

  it("does not poll an idle repository", async () => {
    globalThis.advanceClock(60000);
    await flush();

    expect(snapshots.length).toBe(0);
  });

  it("combines separate native event batches into one current status read", async () => {
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
    expect(core.getStatusSnapshot().head.oid).toBe("6".padStart(40, "0"));
  });

  it("shares a later core watcher notification for the same file event", async () => {
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
    revision++;
    core.scheduleStatusSnapshotRefresh();
    change();
    await flush();
    globalThis.advanceClock(150);
    await flush();

    expect(snapshots.length).toBe(1);
    expect(core.getStatusSnapshot().head.oid).toBe("1".padStart(40, "0"));
  });
});
