/** @babel */

import fs from "fs";
import os from "os";
import path from "path";
import GitShellOutStrategy from "../lib/git-shell-out-strategy.js";

describe("Git configuration scope", () => {
  let scratch;
  let configPath;
  let strategy;
  let discover;
  let executeGit;

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-global-config-"));
    configPath = path.join(scratch, "global.gitconfig");
    strategy = new GitShellOutStrategy(path.parse(scratch).root);
    discover = spyOn(lumine.repositories, "add").and.resolveTo(null);
    const originalExecuteGit = lumine.repositories.executeGit.bind(lumine.repositories);
    executeGit = spyOn(lumine.repositories, "executeGit").and.callFake(
      (args, workingDirectory, options) =>
        originalExecuteGit(args, workingDirectory, {
          ...options,
          // Give each real Git invocation its own global config. Changing the
          // renderer environment would not isolate the existing Git worker.
          env: {
            ...options?.env,
            GIT_CONFIG_GLOBAL: configPath,
            GIT_CONFIG_NOSYSTEM: "1",
          },
        }),
    );
  });

  afterEach(() => {
    strategy.destroy();
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it("writes a global identity outside a repository", async () => {
    await strategy.setConfig("user.name", "Global Author", { global: true });
    await strategy.setConfig("user.email", "author@example.invalid", { global: true });

    expect(discover).not.toHaveBeenCalled();
    expect(await strategy.getConfig("user.name")).toBe("Global Author");
    expect(await strategy.getConfig("user.email")).toBe("author@example.invalid");
    expect(fs.readFileSync(configPath, "utf8")).toContain("Global Author");
  });

  it("replaces all global values when requested", async () => {
    fs.writeFileSync(configPath, "[user]\n\tname = First Author\n\tname = Second Author\n");

    await strategy.setConfig("user.name", "Replacement Author", {
      global: true,
      replaceAll: true,
    });

    expect(await strategy.getConfig("user.name")).toBe("Replacement Author");
    const config = fs.readFileSync(configPath, "utf8");
    expect(config).not.toContain("First Author");
    expect(config).not.toContain("Second Author");
  });

  it("still requires a repository for local configuration", async () => {
    await expectAsync(strategy.setConfig("user.name", "Local Author")).toBeRejectedWithError(
      /the directory does not belong to a Git repository/,
    );

    expect(executeGit).not.toHaveBeenCalled();
    expect(fs.existsSync(configPath)).toBe(false);
  });
});
