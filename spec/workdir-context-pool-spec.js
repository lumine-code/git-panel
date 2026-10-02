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

  it("materializes only the unique remote match and releases every cold probe", async () => {
    const otherWorkdir = "C:\\other-workdir";
    const probes = [];
    const pool = new WorkdirContextPool({
      getRepositoryDirectories: () => [workdir, otherWorkdir],
      createGitStrategy: (directory) => {
        const probe = {
          getRemotes: jasmine.createSpy("fresh remotes").and.resolveTo([
            {
              name: "origin",
              url: `https://github.com/owner/${directory === workdir ? "repo" : "other"}.git`,
            },
          ]),
          destroy: jasmine.createSpy("destroy probe"),
        };
        probes.push(probe);
        return probe;
      },
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
    expect(pool.add.calls.allArgs()).toEqual([[workdir]]);
    for (const probe of probes) {
      expect(probe.getRemotes).toHaveBeenCalledOnceWith({ fresh: true });
      expect(probe.destroy).toHaveBeenCalledTimes(1);
    }
  });

  it("does not materialize ambiguous cold matches", async () => {
    const destroy = jasmine.createSpy("destroy probe");
    const pool = new WorkdirContextPool({
      getRepositoryDirectories: () => [workdir, "C:/other"],
      createGitStrategy: () => ({
        getRemotes: async () => [{ name: "origin", url: "https://github.com/owner/repo.git" }],
        destroy,
      }),
    });
    spyOn(pool, "add");
    expect((await pool.getMatchingContext("github.com", "owner", "repo")).isPresent()).toBe(false);
    expect(pool.add).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(2);
  });

  it("does not add a late match back into a cleared pool", async () => {
    let finish;
    const destroy = jasmine.createSpy("destroy probe");
    const pool = new WorkdirContextPool({
      getRepositoryDirectories: () => [workdir],
      createGitStrategy: () => ({
        getRemotes: () => new Promise((resolve) => (finish = resolve)),
        destroy,
      }),
    });
    const matching = pool.getMatchingContext("github.com", "owner", "repo");
    pool.clear();
    finish([{ name: "origin", url: "https://github.com/owner/repo.git" }]);
    expect((await matching).isPresent()).toBe(false);
    expect(pool.size()).toBe(0);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("preserves a resident model and probes its remotes fresh without retaining observation", async () => {
    const match = jasmine.createSpy("fresh match").and.resolveTo(true);
    const context = { getRepository: () => ({ hasGitHubRemote: match }) };
    const pool = new WorkdirContextPool({ getRepositoryDirectories: () => [workdir] });
    pool.contexts.set(workdir, context);
    spyOn(pool, "retain");
    expect(await pool.getMatchingContext("github.com", "owner", "repo")).toBe(context);
    expect(match).toHaveBeenCalledOnceWith("github.com", "owner", "repo", { fresh: true });
    expect(pool.retain).not.toHaveBeenCalled();
  });

  it("skips a disappeared repository but propagates an unexpected probe failure", async () => {
    let failure = Object.assign(new Error("repository moved"), {
      code: "ERR_GIT_REPOSITORY_UNAVAILABLE",
    });
    const destroy = jasmine.createSpy("destroy failed probe");
    const pool = new WorkdirContextPool({
      getRepositoryDirectories: () => [workdir],
      createGitStrategy: () => ({
        getRemotes: async () => {
          throw failure;
        },
        destroy,
      }),
    });
    expect((await pool.getMatchingContext("github.com", "owner", "repo")).isPresent()).toBe(false);
    failure = new Error("permission denied");
    await expectAsync(pool.getMatchingContext("github.com", "owner", "repo")).toBeRejectedWith(
      failure,
    );
    expect(destroy).toHaveBeenCalledTimes(2);
    expect(pool.size()).toBe(0);
  });
});
