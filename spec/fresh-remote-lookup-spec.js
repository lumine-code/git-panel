/** @babel */
import GitShellOutStrategy from "../lib/git-shell-out-strategy";

describe("authoritative core remotes", () => {
  it("returns plain remote records from the shared refs snapshot", async () => {
    const strategy = new GitShellOutStrategy("/repository");
    const remotes = [
      {
        name: "origin",
        fetchUrl: "ssh://git@example.invalid/team/repo.git",
        pushUrl: "https://example.invalid/team/repo.git",
      },
    ];
    const repository = {
      ensureRefsSnapshot: jasmine.createSpy("ensure refs").and.resolveTo({ remotes }),
    };
    spyOn(strategy, "getCoreRepository").and.resolveTo(repository);
    const execute = spyOn(strategy, "exec");
    try {
      expect(await strategy.getRemotes()).toBe(remotes);
      expect(repository.ensureRefsSnapshot).toHaveBeenCalledTimes(1);
      expect(execute).not.toHaveBeenCalled();
    } finally {
      strategy.destroy();
    }
  });
  it("awaits the core refresh triggered by a filesystem refs change", async () => {
    const strategy = new GitShellOutStrategy("/repository");
    let finish;
    const snapshot = {
      remotes: [{ name: "origin", fetchUrl: "https://example.invalid/fresh.git" }],
    };
    const repository = {
      ensureRefsSnapshot: jasmine.createSpy("ensure refs"),
      refreshRefsSnapshot: jasmine
        .createSpy("refresh refs")
        .and.returnValue(new Promise((resolve) => (finish = resolve))),
    };
    spyOn(strategy, "getCoreRepository").and.resolveTo(repository);
    try {
      strategy.observeRefsChange();
      const reading = strategy.getRemotes();
      await Promise.resolve();
      expect(repository.refreshRefsSnapshot).toHaveBeenCalledTimes(1);
      expect(repository.ensureRefsSnapshot).not.toHaveBeenCalled();
      finish(snapshot);
      expect(await reading).toBe(snapshot.remotes);
    } finally {
      strategy.destroy();
    }
  });
});
