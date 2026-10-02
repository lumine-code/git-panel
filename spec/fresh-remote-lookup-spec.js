/** @babel */
import fs from "fs";
import os from "os";
import path from "path";
import GitShellOutStrategy from "../lib/git-shell-out-strategy";
import Repository from "../lib/models/repository";

describe("fresh remote-only repository matching", () => {
  it("acknowledges only changes captured before a resume refresh", () => {
    const strategy = new GitShellOutStrategy("/repository");
    try {
      strategy.observeStatusChange();
      const captured = strategy.captureStatusChangeWatermark();
      strategy.observeStatusChange();
      strategy.acknowledgeStatusChangeWatermark(captured);
      expect(strategy.coveredStatusChangeCount).toBe(1);
      expect(strategy.captureStatusChangeWatermark()).toBe(2);
      strategy.acknowledgeStatusChangeWatermark(0);
      expect(strategy.coveredStatusChangeCount).toBe(1);
    } finally {
      strategy.destroy();
    }
  });
  it("reads effective fetch URLs with one command and no refs snapshot", async () => {
    const strategy = new GitShellOutStrategy("/repository");
    const exec = spyOn(strategy, "exec").and.resolveTo(
      [
        "origin\tgit@github.com:old/repo.git (fetch)",
        "origin\tgit@github.com:push/repo.git (push)",
        "push-only\thttps://github.com/push/repo.git (push)",
        "origin\thttps://github.com/current/repo.git (fetch)",
        "local\tC:/directory with spaces/repo (fetch)",
      ].join("\r\n"),
    );
    const refs = spyOn(strategy, "getRefsSnapshot");
    try {
      expect(await strategy.getRemotes({ fresh: true })).toEqual([
        { name: "origin", url: "https://github.com/current/repo.git" },
        { name: "local", url: "C:/directory with spaces/repo" },
      ]);
      expect(exec).toHaveBeenCalledOnceWith(["remote", "-v"]);
      expect(refs).not.toHaveBeenCalled();
    } finally {
      strategy.destroy();
    }
  });

  it("matches external URL rewrites without reading stale cached refs or changing cached remotes", async () => {
    jasmine.useRealClock();
    const directory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-fresh-remotes-")),
    );
    const core = await lumine.repositories.initialize(directory, { initialBranch: "main" });
    const model = new Repository(directory);
    try {
      await model.getLoadPromise();
      await model.addRemote("origin", "https://github.com/previous/repository.git");
      expect(await model.hasGitHubRemote("github.com", "previous", "repository")).toBe(true);
      await lumine.repositories.executeGit([
        "-C",
        directory,
        "config",
        "url.https://github.com/.insteadOf",
        "lumine-spec:",
      ]);
      await lumine.repositories.executeGit([
        "-C",
        directory,
        "remote",
        "set-url",
        "origin",
        "lumine-spec:current/repository.git",
      ]);
      expect(await model.hasGitHubRemote("github.com", "previous", "repository")).toBe(true);
      const refs = spyOn(core, "refreshRefsSnapshot").and.callThrough();
      const status = spyOn(core, "refreshStatusSnapshot").and.callThrough();
      const exec = spyOn(lumine.repositories, "executeGit").and.callThrough();

      expect(
        await model.hasGitHubRemote("github.com", "current", "repository", { fresh: true }),
      ).toBe(true);
      expect(
        await model.hasGitHubRemote("another-host.example", "current", "repository", {
          fresh: true,
        }),
      ).toBe(false);
      expect(
        await model.hasGitHubRemote("GITHUB.COM", "current", "repository", { fresh: true }),
      ).toBe(true);
      expect(exec.calls.count()).toBe(3);
      expect(exec.calls.allArgs().every(([args]) => args.slice(-2).join(" ") === "remote -v")).toBe(
        true,
      );
      expect(refs).not.toHaveBeenCalled();
      expect(status).not.toHaveBeenCalled();
      expect(await model.hasGitHubRemote("github.com", "previous", "repository")).toBe(true);
    } finally {
      model.destroy();
      lumine.repositories.forget(core);
      await fs.promises.rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 50,
      });
    }
  }, 15000);

  it("does not execute Git for absent or destroyed repositories", async () => {
    const model = Repository.absent();
    const exec = spyOn(lumine.repositories, "executeGit");
    expect(await model.hasGitHubRemote("github.com", "owner", "repo", { fresh: true })).toBe(false);
    model.destroy();
    expect(await model.hasGitHubRemote("github.com", "owner", "repo", { fresh: true })).toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });
});
