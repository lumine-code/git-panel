/** @babel */
import CompositeListSelection from "../lib/models/composite-list-selection";
import StagingView from "../lib/views/staging-view";

describe("primary-click list selection", () => {
  const items = ["a", "b", "c", "d", "e"].map((name) => ({ filePath: `${name}.txt` }));

  function buildView() {
    return {
      state: {
        selection: new CompositeListSelection({
          listsByKey: [["unstaged", items]],
          idForItem: (item) => item.filePath,
        }),
      },
      mouseSelectionInProgress: false,
      didChangeSelectedItems: jasmine.createSpy(),
      setState(update, callback) {
        this.state = { ...this.state, ...update(this.state) };
        callback();
      },
    };
  }

  function event({ shiftKey = false, primaryModifier = false } = {}) {
    return {
      button: 0,
      ctrlKey: primaryModifier && process.platform !== "darwin",
      metaKey: primaryModifier && process.platform === "darwin",
      shiftKey,
      persist: jasmine.createSpy(),
    };
  }

  async function click(view, item, modifiers) {
    await StagingView.prototype.mousedownOnItem.call(view, event(modifiers), item);
    await StagingView.prototype.mouseup.call(view);
  }

  function selectedItems(view) {
    return Array.from(view.state.selection.getSelectedItems());
  }

  it("selects only the clicked item", async () => {
    const view = buildView();

    await click(view, items[2]);

    expect(selectedItems(view)).toEqual([items[2]]);
  });

  it("selects a continuous range with shift-click", async () => {
    const view = buildView();

    await click(view, items[2], { primaryModifier: true });
    await click(view, items[4], { shiftKey: true });

    expect(selectedItems(view)).toEqual(items.slice(2));
  });

  it("adds or removes one item with ctrl-click or cmd-click", async () => {
    const view = buildView();

    await click(view, items[2], { primaryModifier: true });
    expect(selectedItems(view)).toEqual([items[0], items[2]]);

    await click(view, items[2], { primaryModifier: true });
    expect(selectedItems(view)).toEqual([items[0]]);
  });

  it("adds a continuous range with ctrl-shift-click or cmd-shift-click", async () => {
    const view = buildView();

    await click(view, items[2], { primaryModifier: true });
    await click(view, items[4], { shiftKey: true, primaryModifier: true });

    expect(selectedItems(view)).toEqual([items[0], ...items.slice(2)]);
  });
});
