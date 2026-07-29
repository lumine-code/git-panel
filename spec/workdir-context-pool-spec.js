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
});
