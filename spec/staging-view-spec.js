/** @babel */
import StagingView from "../lib/views/staging-view";
import FilePatchListItemView from "../lib/views/file-patch-list-item-view";
import { flushViews } from "./helpers/etch";

describe("native staging list updates", () => {
  let view;
  afterEach(async () => {
    await view?.destroy();
    view = null;
  });

  async function createView(count = 50) {
    const changes = Array.from({ length: count }, (_, index) => ({
      filePath: `file-${index}.txt`,
      status: "modified",
    }));
    view = new StagingView({
      workspace: lumine.workspace,
      commands: lumine.commands,
      workingDirectoryPath: "C:\\native-staging-spec",
      unstagedChanges: changes,
      stagedChanges: [],
      mergeConflicts: [],
      hasUndoHistory: false,
    });
    jasmine.attachToDOM(view.element);
    await flushViews(async () => {});
    return changes;
  }

  it("keeps every row's DOM identity and renders only changed selections", async () => {
    await createView();
    const before = Array.from(view.element.querySelectorAll(".git-panel-FilePatchListView-item"));
    const render = spyOn(FilePatchListItemView.prototype, "render").and.callThrough();
    const renderList = spyOn(view, "render").and.callThrough();
    await flushViews(() => view.selectNext());
    expect(render.calls.count()).toBeLessThanOrEqual(2);
    expect(Array.from(view.element.querySelectorAll(".git-panel-FilePatchListView-item"))).toEqual(
      before,
    );
    expect(
      view.element.querySelectorAll(".git-panel-FilePatchListView-item.is-selected").length,
    ).toBe(1);
    expect(renderList).not.toHaveBeenCalled();
    render.calls.reset();
    await flushViews(() => view.selectNext());
    expect(render.calls.count()).toBe(2);
  });

  it("tracks refreshed row objects without replacing their keyed DOM", async () => {
    const changes = await createView(2);
    const oldRows = Array.from(view.element.querySelectorAll(".git-panel-FilePatchListView-item"));
    const refreshed = changes.map((change) => ({ ...change }));
    await flushViews(() => view.update({ ...view.props, unstagedChanges: refreshed }));
    expect(Array.from(view.element.querySelectorAll(".git-panel-FilePatchListView-item"))).toEqual(
      oldRows,
    );
    expect(view.listElementsByItem.get(refreshed[0])).toBe(oldRows[0]);
    expect(view.listElementsByItem.get(refreshed[1])).toBe(oldRows[1]);
  });

  it("settles a selection update when its view is destroyed before the frame", async () => {
    await createView(2);
    const pending = view.selectNext();
    await view.destroy();
    await flushViews(() => pending);
    expect(view.destroyed).toBe(true);
    expect(view.element.isConnected).toBe(false);
  });

  it("selects a native context-menu event without a synthetic event API", async () => {
    const changes = await createView(2);
    const row = view.listElementsByItem.get(changes[1]);
    const event = {
      target: row,
      type: "contextmenu",
      shiftKey: false,
      stopPropagation: jasmine.createSpy("stop native context menu"),
    };
    await flushViews(() => view.contextMenuOnItem(event, changes[1]));
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(view.state.selection.getHeadItem()).toBe(changes[1]);
    await view.destroy();
  });
});
