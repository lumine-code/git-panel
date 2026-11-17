/** @babel */
import StagingView from "../lib/views/staging-view.js";
import { flushViews } from "./helpers/etch.js";

describe("staging list scrollbar navigation", () => {
  let view;

  beforeEach(() => {
    spyOn(lumine.workspace, "getActivePaneItem").and.returnValue(null);
  });

  afterEach(async () => {
    await view?.destroy();
    view = null;
  });

  async function createView(empty = false) {
    view = new StagingView({
      workspace: lumine.workspace,
      commands: lumine.commands,
      workingDirectoryPath: "C:\\staging-scrollbar-spec",
      unstagedChanges: empty ? [] : [{ filePath: "working.txt", status: "modified" }],
      stagedChanges: empty ? [] : [{ filePath: "staged.txt", status: "modified" }],
      mergeConflicts: [],
      hasUndoHistory: false,
    });
    jasmine.attachToDOM(view.element);
    await flushViews(async () => {});
  }

  function dispatch(command) {
    return lumine.commands.dispatch(view.refRoot.getOr(null), command);
  }

  it("signals the new active scrollport once per list command, including either boundary", async () => {
    await createView();
    const reveal = spyOn(lumine.scrollbars, "reveal");
    const steps = [
      ["git-panel:activate-next-list", "staged"],
      ["git-panel:activate-next-list", "staged"],
      ["git-panel:activate-previous-list", "unstaged"],
      ["git-panel:activate-previous-list", "unstaged"],
    ];

    for (const [command, key] of steps) {
      reveal.calls.reset();
      dispatch(command);
      expect(view.state.selection.getActiveListKey()).toBe(key);
      expect(reveal).toHaveBeenCalledOnceWith(view.listRefs.get(key).getOr(null));
      await flushViews(async () => {});
      expect(reveal).toHaveBeenCalledTimes(1);
    }
  });

  it("signals the new list immediately when a previous render is still pending", async () => {
    await createView();
    const reveal = spyOn(lumine.scrollbars, "reveal");
    view.invalidate();

    dispatch("git-panel:activate-next-list");

    expect(view.state.selection.getActiveListKey()).toBe("staged");
    expect(reveal).toHaveBeenCalledOnceWith(view.listRefs.get("staged").getOr(null));
    await flushViews(async () => {});
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it("keeps refreshes, programmatic selection and scroll notifications quiet", async () => {
    await createView();
    const reveal = spyOn(lumine.scrollbars, "reveal");
    await flushViews(() =>
      view.update({
        ...view.props,
        stagedChanges: view.props.stagedChanges.map((change) => ({ ...change })),
      }),
    );
    await flushViews(() =>
      view.updateState({ selection: view.state.selection.activateListKey("staged").coalesce() }),
    );
    const port = view.listRefs.get("staged").getOr(null);
    port.scrollTop = 10;
    port.dispatchEvent(new Event("scroll"));
    port.dispatchEvent(new WheelEvent("wheel", { deltaY: 10, bubbles: true }));
    await flushViews(async () => {});

    expect(reveal).not.toHaveBeenCalled();
  });

  it("does not signal an empty or destroyed view", async () => {
    await createView(true);
    const reveal = spyOn(lumine.scrollbars, "reveal");
    dispatch("git-panel:activate-next-list");
    dispatch("git-panel:activate-previous-list");
    expect(reveal).not.toHaveBeenCalled();

    await view.destroy();
    view.activateNextList();
    view.activatePreviousList();
    expect(reveal).not.toHaveBeenCalled();
    view = null;
  });
});
