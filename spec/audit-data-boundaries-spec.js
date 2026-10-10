/** @babel */
require("../lib/index");
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Repository from "../lib/models/repository";
import GitShellOutStrategy from "../lib/git-shell-out-strategy";
import AsyncQueue from "../lib/async-queue";
import yardstick from "../lib/yardstick";

const ticks = async () => {
  for (let index = 0; index < 30; index++) await Promise.resolve();
};

describe("Git panel audit data boundaries", () => {
  let scratch, temporaryRoot, coreRepository, repository, strategy;
  beforeEach(async () => {
    for (const name of ["openPath", "openExternal", "openApplication", "showItemInFolder"])
      spyOn(lumine.shell, name).and.resolveTo();
    temporaryRoot = await fs.realpath(os.tmpdir());
    scratch = await fs.realpath(await fs.mkdtemp(path.join(temporaryRoot, "git-audit-data-")));
    coreRepository = await lumine.repositories.initialize(scratch, { initialBranch: "main" });
    repository = new Repository(scratch);
    await repository.getLoadPromise();
    strategy = new GitShellOutStrategy(scratch);
  });
  afterEach(async () => {
    strategy?.destroy();
    repository?.destroy();
    if (coreRepository) await lumine.repositories.forget(coreRepository);
    const relative = path.relative(temporaryRoot, scratch);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw new Error("Unsafe scratch cleanup target");
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  for (const [label, contents, expected] of [
    ["indentation and trailing blanks", "  first  \n\n", ["+  first  ", "+"]],
    ["blank-only file", "\n\n", ["+", "+"]],
    ["unterminated whitespace", "  value  ", ["+  value  ", "\\ No newline at end of file"]],
    ["ordinary line", "value\n", ["+value"]],
    ["CRLF indentation", "  value  \r\n\r\n", ["+  value  ", "+"]],
  ]) {
    it(`preserves ${label} in an actual untracked-file diff`, async () => {
      await fs.writeFile(path.join(scratch, "new.txt"), contents);
      await coreRepository.refreshStatusSnapshot();
      const diffs = await strategy.getDiffsForFilePath("new.txt");
      expect(diffs.length).toBe(1);
      expect(diffs[0].hunks[0].lines).toEqual(expected);
      expect(diffs[0].hunks[0].newLineCount).toBe(
        contents.endsWith("\n") ? expected.length : expected.length - 1,
      );
    });
  }

  it("keeps a real __proto__ file visible in working-tree status", async () => {
    await fs.writeFile(path.join(scratch, "__proto__"), "owned content\n");
    await fs.writeFile(path.join(scratch, "ordinary.txt"), "ordinary content\n");
    await coreRepository.refreshStatusSnapshot();
    repository.refresh();
    const statuses = await repository.getStatusesForChangedFiles();
    expect(statuses.unstagedFiles["ordinary.txt"]).toBe("added");
    expect(Object.keys(statuses.unstagedFiles)).toContain("__proto__");
    expect(Object.hasOwn(statuses.unstagedFiles, "__proto__")).toBe(true);
    expect(statuses.unstagedFiles.__proto__).toBe("added");
  });

  it("retains undo history after actually discarding a __proto__ file", async () => {
    await fs.writeFile(path.join(scratch, "__proto__"), "owned content\n");
    await repository.storeBeforeAndAfterBlobs(
      ["__proto__"],
      () => true,
      () => repository.discardWorkDirChangesForPaths(["__proto__"]),
    );
    await expectAsync(fs.access(path.join(scratch, "__proto__"))).toBeRejected();
    const snapshots = repository.getLastHistorySnapshots();
    expect(snapshots.length).toBe(1);
    expect(snapshots[0]?.filePath).toBe("__proto__");
    expect(typeof snapshots[0]?.beforeSha).toBe("string");
  });

  for (const name of ["__proto__", "constructor", "toString"]) {
    it(`stores real partial-file history for ${name}`, async () => {
      const file = path.join(scratch, name);
      await fs.writeFile(file, "before\n");
      await repository.storeBeforeAndAfterBlobs(
        [name],
        () => true,
        () => fs.writeFile(file, "after\n"),
        name,
      );
      const snapshot = repository.getLastHistorySnapshots(name);
      expect(snapshot?.filePath).toBe(name);
      expect(typeof snapshot?.beforeSha).toBe("string");
      expect(typeof snapshot?.afterSha).toBe("string");
      expect(snapshot?.beforeSha).not.toBe(snapshot?.afterSha);
      expect(await fs.readFile(file, "utf8")).toBe("after\n");
    });
  }

  it("keeps an actual empty untracked file free of invented content lines", async () => {
    await fs.writeFile(path.join(scratch, "empty.txt"), "");
    await coreRepository.refreshStatusSnapshot();
    const diffs = await strategy.getDiffsForFilePath("empty.txt");
    expect(diffs.length).toBe(1);
    expect(diffs[0].hunks).toEqual([]);
  });

  it("settles queued and later operations on disposal while allowing the running job to finish", async () => {
    const queue = new AsyncQueue();
    let release;
    const running = queue.push(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    let queuedOutcome = "pending",
      laterOutcome = "pending",
      queuedRuns = 0;
    const queued = queue
      .push(() => {
        queuedRuns++;
      })
      .then(
        () => {
          queuedOutcome = "resolved";
        },
        (error) => {
          queuedOutcome = error.code;
        },
      );
    queue.dispose();
    const later = queue
      .push(() => {
        queuedRuns++;
      })
      .then(
        () => {
          laterOutcome = "resolved";
        },
        (error) => {
          laterOutcome = error.code;
        },
      );
    await ticks();
    release("accepted job");
    expect(await running).toBe("accepted job");
    await ticks();
    expect(queuedOutcome).toBe("ABORT_ERR");
    expect(laterOutcome).toBe("ABORT_ERR");
    expect(queuedRuns).toBe(0);
    // Consume the cancellation promises without awaiting a broken original forever.
    queued.catch(() => {});
    later.catch(() => {});
  });

  it("does not overflow the stack when a performance series reaches 100 marks", async () => {
    lumine.config.set("git-panel.performanceToConsole", true);
    lumine.config.set("git-panel.performanceToDirectory", "");
    lumine.config.set("git-panel.performanceToProfile", false);
    spyOn(console, "log");
    try {
      yardstick.begin("audit-mark-limit");
      expect(() => {
        for (let index = 0; index < 120; index++)
          yardstick.mark("audit-mark-limit", `mark-${index}`);
        yardstick.finish("audit-mark-limit");
      }).not.toThrow();
    } finally {
      await yardstick.flush();
      lumine.config.set("git-panel.performanceToConsole", false);
    }
  });

  it("allows an accepted task to dispose its queue synchronously", async () => {
    const queue = new AsyncQueue();
    const accepted = queue.push(() => {
      queue.dispose();
      return "accepted result";
    });
    await expectAsync(accepted).toBeResolvedTo("accepted result");
  });

  it("does not execute a task twice when it synchronously queues another task", async () => {
    const queue = new AsyncQueue({ parallelism: 2 });
    let calls = 0,
      followup;
    const accepted = queue.push(() => {
      calls++;
      if (calls === 1) followup = queue.push(() => "followup");
      return "first";
    });
    expect(await accepted).toBe("first");
    expect(await followup).toBe("followup");
    expect(calls).toBe(1);
    queue.dispose();
  });
});
