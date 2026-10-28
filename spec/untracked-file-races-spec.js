/** @babel */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import GitShellOutStrategy from "../lib/git-shell-out-strategy.js";

describe("untracked-file diff races", () => {
  let temporaryRoot, scratch, repository, strategy;

  beforeEach(async () => {
    temporaryRoot = await fs.realpath(os.tmpdir());
    scratch = await fs.realpath(await fs.mkdtemp(path.join(temporaryRoot, "git-untracked-race-")));
    repository = await lumine.repositories.initialize(scratch, { initialBranch: "main" });
    strategy = new GitShellOutStrategy(scratch);
  });

  afterEach(async () => {
    strategy?.destroy();
    if (repository) await lumine.repositories.forget(repository);
    if (scratch) {
      const resolved = await fs.realpath(scratch);
      const relative = path.relative(temporaryRoot, resolved);
      if (
        !relative ||
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      )
        throw new Error("Fixture cleanup escaped its owned temporary root.");
      await fs.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
    scratch = repository = strategy = null;
  });

  async function cacheUntrackedFile({ symlink = false } = {}) {
    const absolutePath = path.join(scratch, "new.txt");
    if (symlink) {
      await fs.symlink("missing-target", absolutePath, "file");
    } else {
      await fs.writeFile(absolutePath, "original\n");
    }
    await repository.refreshStatusSnapshot();
    const files = await strategy.getUntrackedFiles();
    expect(files).toContain("new.txt");
    // Keep the status entry stable while the real file disappears below.
    spyOn(strategy, "getUntrackedFiles").and.resolveTo(files);
    return absolutePath;
  }

  it("omits a deleted cached path and reads its replacement on the next refresh", async () => {
    const absolutePath = await cacheUntrackedFile();
    await fs.unlink(absolutePath);

    expect(await strategy.getDiffsForFilePath("new.txt")).toEqual([]);

    await fs.writeFile(absolutePath, "replacement\n");
    const diffs = await strategy.getDiffsForFilePath("new.txt");
    expect(diffs).toHaveSize(1);
    expect(diffs[0].hunks[0].lines).toEqual(["+replacement"]);
  });

  for (const [method, label, symlink] of [
    ["open", "opening its contents", false],
    ["stat", "reading its executable mode", false],
    ["readlink", "reading its link text", true],
  ]) {
    it(`omits a path deleted before ${label}`, async () => {
      const absolutePath = await cacheUntrackedFile({ symlink });
      const original = fs[method];
      let deleted = false;
      spyOn(fs, method).and.callFake(async (filePath, ...args) => {
        if (filePath === absolutePath && !deleted) {
          deleted = true;
          await fs.unlink(absolutePath);
        }
        return original(filePath, ...args);
      });

      expect(await strategy.getDiffsForFilePath("new.txt")).toEqual([]);
      expect(deleted).toBe(true);
    });
  }

  it("reports filesystem failures other than a missing untracked file", async () => {
    const absolutePath = await cacheUntrackedFile();
    const error = Object.assign(new Error("Access denied"), { code: "EACCES" });
    const lstat = fs.lstat;
    spyOn(fs, "lstat").and.callFake((filePath, ...args) =>
      filePath === absolutePath ? Promise.reject(error) : lstat(filePath, ...args),
    );

    await expectAsync(strategy.getDiffsForFilePath("new.txt")).toBeRejectedWith(error);
  });

  it("reports a missing path from the Git API instead of treating it as an untracked-file race", async () => {
    await cacheUntrackedFile();
    const error = Object.assign(new Error("Git metadata missing"), { code: "ENOENT" });
    spyOn(repository, "getDiff").and.rejectWith(error);

    await expectAsync(strategy.getDiffsForFilePath("new.txt")).toBeRejectedWith(error);
  });
});
