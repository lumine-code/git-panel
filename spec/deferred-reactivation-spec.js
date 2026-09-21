/** @babel */
const path = require("path");

const PACKAGE_NAME = "git-panel";
const PACKAGE_PATH = path.join(__dirname, "..");
const COMMAND_NAME = "git-panel:clone";

describe("git-panel reactivation", () => {
  let invokeGitController;

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    if (lumine.packages.isPackageLoaded(PACKAGE_NAME)) {
      await lumine.packages.unloadPackage(PACKAGE_NAME);
    }
    await lumine.packages.startPackage(PACKAGE_PATH);
    const gitPackageModule = require("../lib/git-package");
    const GitPackage = gitPackageModule.default || gitPackageModule;
    invokeGitController = spyOn(GitPackage.prototype, "invokeGitController").and.resolveTo();
  });

  afterEach(async () => {
    if (lumine.packages.isPackageLoaded(PACKAGE_NAME)) {
      await lumine.packages.unloadPackage(PACKAGE_NAME);
    }
  });

  const hasWorkspaceCommand = () =>
    lumine.commands
      .findCommands({ target: lumine.views.getView(lumine.workspace) })
      .some(({ name }) => name === COMMAND_NAME);

  it("re-registers the exact cold-command handler after deactivate and start", async () => {
    const workspaceElement = lumine.views.getView(lumine.workspace);

    await lumine.commands.dispatch(workspaceElement, COMMAND_NAME);
    expect(lumine.packages.getPackageLifecycleState(PACKAGE_NAME)).toBe("active");
    expect(hasWorkspaceCommand()).toBe(true);
    expect(invokeGitController).toHaveBeenCalledOnceWith("openCloneDialog");

    await lumine.packages.deactivatePackage(PACKAGE_NAME);
    expect(lumine.packages.getPackageLifecycleState(PACKAGE_NAME)).toBe("loaded");
    expect(hasWorkspaceCommand()).toBe(false);

    await lumine.packages.startPackage(PACKAGE_NAME);
    expect(lumine.packages.getPackageLifecycleState(PACKAGE_NAME)).toBe("active");

    await lumine.commands.dispatch(workspaceElement, COMMAND_NAME);
    expect(lumine.packages.getPackageLifecycleState(PACKAGE_NAME)).toBe("active");
    expect(hasWorkspaceCommand()).toBe(true);
    expect(invokeGitController).toHaveBeenCalledTimes(2);
  });

  it("opens the Git dock item on the first cold focus command", async () => {
    const workspaceElement = lumine.views.getView(lumine.workspace);
    const uri = "lumine-github://dock-item/git";

    await lumine.commands.dispatch(workspaceElement, "git-panel:toggle-focus");

    const pane = lumine.workspace.paneForURI(uri);
    expect(pane).not.toBeNull();
    expect(pane.getContainer().getLocation()).toBe("right");

    const item = pane.itemForURI(uri);
    expect(item.getHydrationState).toEqual(jasmine.any(Function));
    expect(item.getURI()).toBe(uri);
    expect(item.serialize()).toEqual(jasmine.objectContaining({ deserializer: "GitDockItem" }));

    pane.moveItemToPane(item, lumine.workspace.getCenter().getActivePane());
    expect(lumine.workspace.paneForURI(uri).getContainer().getLocation()).toBe("center");

    await lumine.commands.dispatch(workspaceElement, "git-panel:toggle-focus");
    expect(lumine.workspace.paneForURI(uri).getContainer().getLocation()).toBe("right");
    expect(lumine.workspace.paneForURI(uri).itemForURI(uri)).toBe(item);
  });
});
