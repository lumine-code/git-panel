/** @babel */

import path from "node:path";
import GitShellOutStrategy from "../lib/git-shell-out-strategy.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

describe("Git configuration operation ordering", () => {
  let strategy, core, operations, gates, work;

  beforeEach(() => {
    strategy = new GitShellOutStrategy(path.resolve("controlled-config-repository"), {
      parallelism: 2,
    });
    core = { getConfigValueAsync: jasmine.createSpy("read configuration") };
    operations = { setConfig: jasmine.createSpy("write configuration") };
    spyOn(strategy, "getCoreRepository").and.resolveTo(core);
    spyOn(strategy, "getRepositoryOperations").and.resolveTo(operations);
    gates = [];
    work = [];
  });

  afterEach(async () => {
    for (const gate of gates) gate.resolve();
    await Promise.allSettled(work);
    strategy.destroy();
  });

  it("reads configuration only after an accepted configuration write has finished", async () => {
    const entered = deferred(),
      release = deferred();
    gates.push(release);
    let value = "previous author";
    operations.setConfig.and.callFake(async (_key, next) => {
      entered.resolve();
      await release.promise;
      value = next;
    });
    core.getConfigValueAsync.and.callFake(async () => value);
    const writing = strategy.setConfig("user.name", "accepted author");
    work.push(writing);
    await entered.promise;

    const reading = strategy.getConfig("user.name");
    work.push(reading);
    await nextTurn();
    expect(core.getConfigValueAsync).not.toHaveBeenCalled();
    release.resolve();

    await writing;
    expect(await reading).toBe("accepted author");
  });

  it("keeps configuration reads parallel and waits for both before rewriting their file", async () => {
    const entered = deferred(),
      release = deferred();
    gates.push(release);
    let reads = 0;
    core.getConfigValueAsync.and.callFake(async (key) => {
      if (++reads === 2) entered.resolve();
      await release.promise;
      return key;
    });
    operations.setConfig.and.resolveTo();
    const reading = Promise.all([
      strategy.getConfig("user.name"),
      strategy.getConfig("user.email"),
    ]);
    work.push(reading);
    await entered.promise;

    const writing = strategy.setConfig("user.name", "next author");
    work.push(writing);
    await nextTurn();
    expect(operations.setConfig).not.toHaveBeenCalled();
    release.resolve();

    expect(await reading).toEqual(["user.name", "user.email"]);
    await writing;
    expect(operations.setConfig).toHaveBeenCalledOnceWith("user.name", "next author", {
      replaceAll: undefined,
      global: undefined,
    });
  });

  it("cancels a queued configuration read on disposal without calling the retired repository", async () => {
    const entered = deferred(),
      release = deferred();
    gates.push(release);
    operations.setConfig.and.callFake(async () => {
      entered.resolve();
      await release.promise;
    });
    const writing = strategy.setConfig("user.name", "accepted author");
    work.push(writing);
    await entered.promise;
    const reading = strategy.getConfig("user.name").then(
      () => "unexpected read",
      (error) => error.code,
    );
    work.push(reading);
    await nextTurn();

    strategy.destroy();
    expect(await reading).toBe("ABORT_ERR");
    expect(core.getConfigValueAsync).not.toHaveBeenCalled();
    release.resolve();
    await writing;
  });

  it("finishes compound commit configuration reads before entering the exclusive commit turn", async () => {
    strategy.commandQueue.parallelism = 1;
    core.getConfigValueAsync.and.callFake(
      async (key) =>
        ({
          "commit.template": __filename,
          "core.commentChar": "#",
          "commit.cleanup": "strip",
        })[key],
    );
    operations.commit = jasmine.createSpy("commit").and.resolveTo("committed");
    const committing = strategy.commit("accepted message\n# ignored template comment");
    work.push(committing);

    expect(await committing).toBe("committed");
    expect(core.getConfigValueAsync.calls.allArgs()).toEqual([
      ["commit.template"],
      ["core.commentChar"],
      ["commit.cleanup"],
    ]);
    expect(operations.commit).toHaveBeenCalledOnceWith("accepted message\n", {
      amend: undefined,
      allowEmpty: undefined,
      verbatim: undefined,
      cleanup: "strip",
    });
  });
});
