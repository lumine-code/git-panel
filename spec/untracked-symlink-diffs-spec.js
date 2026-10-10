/** @babel */
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

describe("untracked symbolic-link diffs through Core", () => {
  let scratch, scratchParent, coreRepository, strategy;

  beforeEach(async () => {
    for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"])
      spyOn(lumine.shell, method).and.returnValue(Promise.resolve());
    spyOn(lumine.application, "openWindow").and.returnValue(Promise.resolve());
    await lumine.packages.activatePackage("git-panel");
    const pack = lumine.packages.getActivePackage("git-panel");
    const loaded = require(path.join(pack.path, "lib/git-shell-out-strategy"));
    const Strategy = loaded.default || loaded;
    scratchParent = await fs.realpath(os.tmpdir());
    scratch = await fs.realpath(await fs.mkdtemp(path.join(scratchParent, "git-symlink-diffs-")));
    coreRepository = await lumine.repositories.initialize(scratch, { initialBranch: "main" });
    strategy = new Strategy(scratch);
  });

  afterEach(async () => {
    strategy?.destroy();
    if (coreRepository) lumine.repositories.forget(coreRepository);
    await lumine.packages.deactivatePackage("git-panel");
    if (scratch) {
      const resolved = await fs.realpath(scratch);
      const relative = path.relative(scratchParent, resolved);
      if (
        !relative ||
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      )
        throw new Error("Fixture cleanup escaped its owned temporary root.");
      await fs.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
    scratch = coreRepository = strategy = null;
  });

  async function diff(filePath) {
    await coreRepository.refreshStatusSnapshot();
    const changes = await strategy.getDiffsForFilePath(filePath);
    expect(changes.length).toBe(1);
    return changes[0];
  }

  it("shows the exact relative link text even when its target is empty or executable", async () => {
    await fs.writeFile(path.join(scratch, "empty-target"), "");
    await fs.chmod(path.join(scratch, "empty-target"), 0o755);
    await fs.symlink("empty-target", path.join(scratch, "relative-link"), "file");
    const change = await diff("relative-link");
    expect(change.newMode).toBe("120000");
    expect(change.hunks.length).toBe(1);
    expect(change.hunks[0].newLineCount).toBe(1);
    expect(change.hunks[0].lines).toEqual(["+empty-target", "\\ No newline at end of file"]);
    await strategy.stageFiles(["relative-link"]);
    expect(await coreRepository.getIndexFile("relative-link")).toBe("empty-target");
  });

  it("shows a dangling link without opening its nonexistent target", async () => {
    await fs.symlink("missing-target", path.join(scratch, "dangling-link"), "file");
    const change = await diff("dangling-link");
    expect(change.newMode).toBe("120000");
    expect(change.hunks[0].newLineCount).toBe(1);
    expect(change.hunks[0].lines).toEqual(["+missing-target", "\\ No newline at end of file"]);
    expect(await fs.readlink(path.join(scratch, "dangling-link"))).toBe("missing-target");
  });

  it("keeps ordinary empty and text-file diff contents", async () => {
    await fs.writeFile(path.join(scratch, "empty.txt"), "");
    await fs.writeFile(path.join(scratch, "text.txt"), "first\nsecond");
    const empty = await diff("empty.txt");
    expect(empty.hunks).toEqual([]);
    expect(empty.newMode).not.toBe("120000");
    const text = await diff("text.txt");
    expect(text.hunks[0].newLineCount).toBe(2);
    expect(text.hunks[0].lines).toEqual(["+first", "+second", "\\ No newline at end of file"]);
  });
});
