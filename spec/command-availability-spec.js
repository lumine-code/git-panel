const availability = require("../lib/command-availability");
const registerGlobalCommands = require("../lib/bootstrap-commands");

describe("Git Panel command availability", () => {
  let repository, status, entry, items, context, commands, loadRuntime;
  beforeEach(() => {
    repository = null;
    status = { initialized: true, head: null, counts: { staged: 0 } };
    items = [];
    context = { repository: null, editor: null, path: null };
    spyOn(lumine.repositories, "getActiveRepository").and.callFake(() => repository);
    spyOn(lumine.repositories, "getCommandContext").and.callFake(() => context);
    spyOn(lumine.workspace, "getPaneItems").and.callFake(() => items);
    loadRuntime = jasmine.createSpy("load cold Git runtime");
    registerGlobalCommands(
      {
        add(_selector, entries) {
          commands = entries;
        },
      },
      loadRuntime,
    );
  });
  afterEach(() => {
    lumine.repositories.getActiveRepository.and.callThrough();
    lumine.repositories.getCommandContext.and.callThrough();
    lumine.workspace.getPaneItems.and.callThrough();
  });

  function registerRepository() {
    repository = {
      isDestroyed: () => false,
      getWorkingDirectory: () => "/project",
      getStatusSnapshot: () => status,
      getStatusEntry: () => entry,
    };
  }

  it("omits repository setup commands and disables operations without a repository", () => {
    expect(commands["git-panel:initialize"]).toBeUndefined();
    expect(commands["git-panel:clone"]).toBeUndefined();
    expect(commands["git-panel:open-commit"].isAvailable({})).toBe(false);
    expect(commands["git-panel:toggle-commit-preview"].isAvailable({})).toBe(false);
    expect(commands["git-panel:close-all-diff-views"].isAvailable({})).toBe(false);
    expect(loadRuntime).not.toHaveBeenCalled();
  });

  it("checks committed history and staged changes without loading the panel", () => {
    registerRepository();
    expect(availability.hasHistory()).toBe(false);
    status.head = { oid: "commit" };
    expect(availability.hasHistory()).toBe(true);
    expect(availability.canPreviewCommit()).toBe(false);
    status.counts.staged = 1;
    expect(availability.canPreviewCommit()).toBe(true);
    expect(loadRuntime).not.toHaveBeenCalled();
  });

  it("allows closing existing patch views independently of active repository state", () => {
    items = [
      {
        getURI: () => "lumine-git://patch/staged-all?workdir=%2Fproject",
        isPatchItem: () => true,
        isEmpty: () => true,
      },
    ];
    expect(availability.hasPatchItems()).toBe(true);
    expect(availability.hasPatchItems({ empty: true })).toBe(true);
    expect(availability.canPreviewCommit()).toBe(false);
    registerRepository();
    expect(availability.canPreviewCommit()).toBe(true);
    repository.getWorkingDirectory = () => "/another-project";
    expect(availability.canPreviewCommit()).toBe(false);
    items = [
      { getURI: () => "lumine-git://patch/file?workdir=%2Fproject", getHydratedView: () => null },
    ];
    expect(availability.hasPatchItems()).toBe(false);
  });

  it("requires the requested staged or unstaged state of the saved file", () => {
    registerRepository();
    context = { repository, editor: { isDestroyed: () => false }, path: "/project/file" };
    entry = { staged: false, unstaged: true };
    expect(availability.fileChanges("unstaged", {})).toBe(true);
    expect(availability.fileChanges("staged", {})).toBe(false);
    context.path = null;
    expect(availability.fileChanges("unstaged", {})).toBe(false);
  });
});
