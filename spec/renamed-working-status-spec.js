const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

describe("Staged rename working-tree status", () => {
  let directory, coreRepository, panelRepository;

  beforeEach(async () => {
    jasmine.useRealClock();
    for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"])
      spyOn(lumine.shell, method).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    directory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-rename-status-")),
    );
    fs.mkdirSync(path.join(directory, "empty-hooks"));
    coreRepository = await lumine.repositories.initialize(directory, { initialBranch: "main" });
    const loaded = require("../lib/models/repository");
    const Repository = loaded.default || loaded;
    panelRepository = new Repository(directory);
    await panelRepository.getLoadPromise();
    for (const [key, value] of [
      ["user.name", "Lumine Specs"],
      ["user.email", "spec@example.invalid"],
      ["core.hooksPath", path.join(directory, "empty-hooks")],
      ["core.attributesfile", path.join(directory, "empty-attributes")],
      ["core.fsmonitor", "false"],
      ["core.autocrlf", "false"],
      ["commit.gpgsign", "false"],
    ])
      await panelRepository.setConfig(key, value);
    fs.writeFileSync(path.join(directory, "old.txt"), "first\nsecond\nthird\n");
    await panelRepository.stageFiles(["old.txt"]);
    await panelRepository.commit("Initial owned fixture");
    fs.renameSync(path.join(directory, "old.txt"), path.join(directory, "renamed.txt"));
    await panelRepository.stageFiles(["old.txt", "renamed.txt"]);
  }, 30000);

  afterEach(async () => {
    panelRepository?.destroy();
    if (coreRepository) await lumine.repositories.forget(coreRepository);
    await lumine.fileWatchClient.settlePendingTeardown();
    // The suite owns TEMP. Windows Git workers can retain these directories
    // until the editor process exits, so teardown releases models and leases.
    directory = coreRepository = panelRepository = null;
  }, 15000);

  async function statuses() {
    await coreRepository.refreshStatusSnapshot();
    const result = await panelRepository.getStatusesForChangedFiles();
    expect(result.stagedFiles["old.txt"]).toBe("deleted");
    expect(result.stagedFiles["renamed.txt"]).toBe("added");
    return result;
  }

  it("retains a modification after staging a rename", async () => {
    fs.appendFileSync(path.join(directory, "renamed.txt"), "later edit\n");
    expect((await statuses()).unstagedFiles["renamed.txt"]).toBe("modified");
  }, 30000);

  it("retains a deletion after staging a rename", async () => {
    fs.unlinkSync(path.join(directory, "renamed.txt"));
    expect((await statuses()).unstagedFiles["renamed.txt"]).toBe("deleted");
  }, 30000);

  it("keeps a pure staged rename free of unstaged changes", async () => {
    expect((await statuses()).unstagedFiles).toEqual({});
  }, 30000);
});
