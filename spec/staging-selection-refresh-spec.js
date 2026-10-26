/** @babel */
import StagingView from "../lib/views/staging-view.js";
import { flushViews } from "./helpers/etch.js";

describe("staging selection across asynchronous refreshes", () => {
  const workingDirectoryPath = "C:\\staging-selection-refresh-spec";
  let view;
  let activeItem;

  beforeEach(() => {
    // didMount() must finish before a test introduces a pending workspace sync.
    activeItem = spyOn(lumine.workspace, "getActivePaneItem").and.returnValue(null);
  });

  afterEach(async () => {
    await view?.destroy();
    view = null;
  });

  function changesFor(...filePaths) {
    return filePaths.map((filePath) => ({ filePath, status: "modified" }));
  }

  async function createView(stagedChanges = []) {
    const unstagedChanges = changesFor("a.txt", "b.txt", "c.txt", "d.txt", "e.txt");
    view = new StagingView({
      workspace: lumine.workspace,
      commands: lumine.commands,
      workingDirectoryPath,
      unstagedChanges,
      stagedChanges,
      mergeConflicts: [],
      hasUndoHistory: false,
    });
    jasmine.attachToDOM(view.element);
    await flushViews(async () => {});
    spyOn(view, "didSelectSingleItem");
    return unstagedChanges;
  }

  async function click(item, modifiers = {}) {
    const row = view.listElementsByItem.get(item);
    await flushViews(() => {
      row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, ...modifiers }));
      window.dispatchEvent(new MouseEvent("mouseup", { button: 0, ...modifiers }));
    });
  }

  function selectedPaths(listKey = "unstaged") {
    return Array.from(
      view.element.querySelectorAll(
        `.git-panel-StagingView-${listKey} .is-selected .git-panel-FilePatchListView-path`,
      ),
      (element) => element.textContent,
    );
  }

  async function refreshLists(lists = {}) {
    const unstagedChanges = lists.unstagedChanges ?? view.props.unstagedChanges;
    const stagedChanges = lists.stagedChanges ?? view.props.stagedChanges;
    const refreshed = {
      unstagedChanges: unstagedChanges.map((change) => ({ ...change })),
      stagedChanges: stagedChanges.map((change) => ({ ...change })),
    };
    await flushViews(() => view.update({ ...view.props, ...refreshed }));
    return refreshed;
  }

  function patchItem(filePath, stagingStatus = "unstaged") {
    return {
      isFilePatchItem: () => true,
      getWorkingDirectory: () => workingDirectoryPath,
      getFilePath: () => filePath,
      getStagingStatus: () => stagingStatus,
    };
  }

  function pendingWorkspaceItem() {
    let resolve;
    const hydrated = new Promise((resolveHydrated) => {
      resolve = resolveHydrated;
    });
    const item = { whenHydrated: jasmine.createSpy("whenHydrated").and.returnValue(hydrated) };
    activeItem.and.returnValue(item);
    return { item, resolve };
  }

  it("keeps a shift-click range selected when status returns fresh row objects", async () => {
    const changes = await createView();
    await click(changes[1]);
    await click(changes[3], { shiftKey: true });
    expect(selectedPaths()).toEqual(["b.txt", "c.txt", "d.txt"]);

    const refreshed = await refreshLists();

    expect(selectedPaths()).toEqual(["b.txt", "c.txt", "d.txt"]);
    expect(view.state.selection.getHeadItem()).toBe(refreshed.unstagedChanges[3]);
    expect(view.state.selection.getSelectedCount()).toBe(3);
  });

  it("retains the range anchor and head through repeated refreshes", async () => {
    const changes = await createView();
    await click(changes[1]);
    await click(changes[3], { shiftKey: true });
    await refreshLists();
    const refreshed = await refreshLists();
    expect(view.state.selection.getHeadItem()).toBe(refreshed.unstagedChanges[3]);

    await click(refreshed.unstagedChanges[4], { shiftKey: true });

    expect(selectedPaths()).toEqual(["b.txt", "c.txt", "d.txt", "e.txt"]);
    expect(view.state.selection.getHeadItem()).toBe(refreshed.unstagedChanges[4]);
  });

  it("preserves disconnected primary-modifier selections and subsequent removal", async () => {
    const changes = await createView();
    const primaryModifier = process.platform === "darwin" ? { metaKey: true } : { ctrlKey: true };
    await click(changes[1]);
    await click(changes[4], primaryModifier);
    expect(selectedPaths()).toEqual(["b.txt", "e.txt"]);

    const refreshed = await refreshLists();
    expect(selectedPaths()).toEqual(["b.txt", "e.txt"]);
    expect(view.state.selection.getHeadItem()).toBe(refreshed.unstagedChanges[4]);

    await click(refreshed.unstagedChanges[4], primaryModifier);
    await refreshLists();
    expect(selectedPaths()).toEqual(["b.txt"]);
  });

  it("keeps surviving selected files without selecting inserted replacement rows", async () => {
    const changes = await createView();
    await click(changes[1]);
    await click(changes[3], { shiftKey: true });

    await refreshLists({
      unstagedChanges: changesFor("a.txt", "b.txt", "inserted.txt", "d.txt", "e.txt"),
    });
    expect(selectedPaths()).toEqual(["b.txt", "d.txt"]);

    await refreshLists({
      unstagedChanges: changesFor("a.txt", "b.txt", "inserted.txt", "replacement.txt", "e.txt"),
    });
    expect(selectedPaths()).toEqual(["b.txt"]);
  });

  it("preserves each list independently when staged and unstaged paths overlap", async () => {
    const staged = changesFor("a.txt", "b.txt", "c.txt", "d.txt");
    const unstaged = await createView(staged);
    await click(unstaged[1]);
    await click(unstaged[3], { shiftKey: true });
    await click(staged[0]);
    await click(staged[1], { shiftKey: true });

    await refreshLists();
    expect(view.state.selection.getActiveListKey()).toBe("staged");
    expect(selectedPaths("staged")).toEqual(["a.txt", "b.txt"]);
    expect(selectedPaths("unstaged")).toEqual([]);

    await flushViews(() => view.activateList("unstaged"));
    expect(selectedPaths("unstaged")).toEqual(["b.txt", "c.txt", "d.txt"]);
    expect(selectedPaths("staged")).toEqual([]);

    await flushViews(() => view.activateList("staged"));
    expect(selectedPaths("staged")).toEqual(["a.txt", "b.txt"]);
  });

  it("ignores workspace hydration that completes after a newer shift-click selection", async () => {
    const changes = await createView();
    const pending = pendingWorkspaceItem();
    const sync = view.syncWithWorkspace();
    expect(pending.item.whenHydrated).toHaveBeenCalled();

    await click(changes[1]);
    await click(changes[3], { shiftKey: true });
    await flushViews(() => {
      pending.resolve(patchItem("a.txt"));
      return sync;
    });

    expect(selectedPaths()).toEqual(["b.txt", "c.txt", "d.txt"]);
    expect(view.state.selection.getHeadItem()).toBe(changes[3]);
  });

  it("ignores hydration from a pane item that is no longer active", async () => {
    await createView();
    const pending = pendingWorkspaceItem();
    const staleSync = view.syncWithWorkspace();
    const current = {
      whenHydrated: () => Promise.resolve(patchItem("a.txt")),
    };
    activeItem.and.returnValue(current);
    await flushViews(() => view.syncWithWorkspace());
    expect(selectedPaths()).toEqual(["a.txt"]);

    await flushViews(() => {
      pending.resolve(patchItem("b.txt"));
      return staleSync;
    });

    expect(selectedPaths()).toEqual(["a.txt"]);
  });

  it("keeps the range when a pending diff activates after the user extends its selection", async () => {
    const changes = await createView();
    await click(changes[1]);
    await click(changes[3], { shiftKey: true });
    activeItem.and.returnValue({ whenHydrated: () => Promise.resolve(patchItem("b.txt")) });

    await flushViews(() => view.syncWithWorkspace());

    expect(selectedPaths()).toEqual(["b.txt", "c.txt", "d.txt"]);
    expect(view.state.selection.getHeadItem()).toBe(changes[3]);
  });

  it("ignores hydration after switching the staging view to another working directory", async () => {
    await createView();
    const pending = pendingWorkspaceItem();
    const sync = view.syncWithWorkspace();
    await flushViews(() =>
      view.update({
        ...view.props,
        workingDirectoryPath: `${workingDirectoryPath}-other`,
      }),
    );
    await flushViews(() => {
      pending.resolve(patchItem("b.txt"));
      return sync;
    });

    expect(selectedPaths()).toEqual(["a.txt"]);
  });

  it("does not select a hydrated workspace item after the staging view is destroyed", async () => {
    await createView();
    const pending = pendingWorkspaceItem();
    const sync = view.syncWithWorkspace();
    const quietlySelectItem = spyOn(view, "quietlySelectItem").and.callThrough();
    const destroyedView = view;
    await view.destroy();
    view = null;

    await flushViews(() => {
      pending.resolve(patchItem("b.txt"));
      return sync;
    });

    expect(quietlySelectItem).not.toHaveBeenCalled();
    expect(destroyedView.destroyed).toBe(true);
    expect(destroyedView.element.isConnected).toBe(false);
  });
});
