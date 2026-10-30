/* global conditionPromise */
const requireCurrent = require("node:module").createRequire(__filename);
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

describe("Git Panel repository setup service integration", () => {
  let main, directory;
  beforeEach(async () => {
    jasmine.useRealClock();
    spyOn(lumine.window, "whenLoaded").and.resolveTo(0);
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "git-panel-setup-")));
    const filePath = path.join(directory, "example.txt");
    await fs.writeFile(filePath, "Repository setup integration.\n");
    lumine.project.setPaths([directory]);
    lumine.repositories.setActiveRepository(null);
    await lumine.workspace.open(filePath);
    main = (await lumine.packages.startPackage("git-panel")).mainModule;
    await lumine.packages.startPackage("git-center");
    await main.provideGitPanel().openGitTab();
    await conditionPromise(() => document.querySelectorAll(".no-repository button").length === 2);
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("git-panel");
    await lumine.packages.deactivatePackage("git-center");
    lumine.project.setPaths([]);
    await lumine.fileWatchClient.settlePendingTeardown();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("updates the mounted panel when the provider withdraws and returns", async () => {
    const buttons = Array.from(document.querySelectorAll(".no-repository button"));
    expect(buttons.every((button) => !button.disabled)).toBe(true);
    await lumine.packages.deactivatePackage("git-center");
    await conditionPromise(() => buttons.every((button) => button.disabled));
    await lumine.packages.startPackage("git-center");
    await conditionPromise(() => buttons.every((button) => !button.disabled));
  });

  it("recognizes initialization through Git Center and invalidates cached non-Git paths", async () => {
    const { getRepositorySetup } = requireCurrent("../lib/repository-setup");
    const setup = getRepositorySetup();
    const initialize = spyOn(setup, "openInitializeDialog").and.callThrough();
    main.workdirCache.known.set(directory, null);
    const invalidate = spyOn(main.workdirCache, "invalidate").and.callThrough();
    document.querySelector(".no-repository button").click();
    await conditionPromise(() => document.querySelector(".git-center-repository-dialog"));
    const form = document.querySelector(".git-center-repository-dialog");
    expect(form.querySelector('[name="destinationPath"]').value).toBe(directory);
    await lumine.commands.dispatch(form, "core:confirm");
    const repository = await initialize.calls.mostRecent().returnValue;
    expect(path.normalize(repository.getWorkingDirectory())).toBe(path.normalize(directory));
    expect(invalidate).toHaveBeenCalled();
    expect(main.workdirCache.known.get(directory)).not.toBeNull();
    await conditionPromise(() => main.getActiveRepository().isPresent());
    expect(path.normalize(main.getActiveRepository().getWorkingDirectoryPath())).toBe(
      path.normalize(directory),
    );
    await conditionPromise(() => !document.querySelector(".no-repository"));
  });
});
