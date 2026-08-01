/** @babel */
import WorkdirContextPool from "../lib/models/workdir-context-pool";

describe("WorkdirContextPool", () => {
  const workdir = "C:\\workdir";

  function contextWithRepositoryState({ empty = false, destroyed = false } = {}) {
    const repository = {
      isEmpty: () => empty,
      isDestroyed: () => destroyed,
    };
    return {
      getRepository: () => repository,
    };
  }

  it("keeps a resident context when repository registration races with loading", () => {
    const pool = new WorkdirContextPool();
    const context = contextWithRepositoryState();
    pool.contexts.set(workdir, context);
    spyOn(pool, "replace");

    expect(pool.reconcileRepositoryAdded(workdir)).toBe(context);
    expect(pool.replace).not.toHaveBeenCalled();
  });

  it("replaces a context that had definitively resolved as empty", () => {
    const pool = new WorkdirContextPool();
    pool.contexts.set(workdir, contextWithRepositoryState({ empty: true }));
    const replacement = contextWithRepositoryState();
    spyOn(pool, "replace").and.returnValue(replacement);

    expect(pool.reconcileRepositoryAdded(workdir)).toBe(replacement);
    expect(pool.replace).toHaveBeenCalledWith(workdir, {}, false);
  });

  it("replaces a destroyed context", () => {
    const pool = new WorkdirContextPool();
    pool.contexts.set(workdir, contextWithRepositoryState({ destroyed: true }));
    const replacement = contextWithRepositoryState();
    spyOn(pool, "replace").and.returnValue(replacement);

    expect(pool.reconcileRepositoryAdded(workdir)).toBe(replacement);
    expect(pool.replace).toHaveBeenCalledWith(workdir, {}, false);
  });

  it("materializes discovered repositories only when matching a remote on demand", async () => {
    const otherWorkdir = "C:\\other-workdir";
    const pool = new WorkdirContextPool({
      getRepositoryDirectories: () => [workdir, otherWorkdir],
    });
    const matchingContext = {
      getRepository: () => ({ hasGitHubRemote: () => Promise.resolve(true) }),
    };
    const otherContext = {
      getRepository: () => ({ hasGitHubRemote: () => Promise.resolve(false) }),
    };
    spyOn(pool, "add").and.callFake((directory) => {
      const context = directory === workdir ? matchingContext : otherContext;
      pool.contexts.set(directory, context);
      return context;
    });

    expect(pool.size()).toBe(0);
    expect(await pool.getMatchingContext("github.com", "owner", "repo")).toBe(matchingContext);
    expect(pool.add.calls.allArgs()).toEqual([[workdir], [otherWorkdir]]);
  });
});
