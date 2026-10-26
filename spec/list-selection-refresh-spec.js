/** @babel */
import ListSelection from "../lib/models/list-selection.js";
import CompositeListSelection from "../lib/models/composite-list-selection.js";

describe("changed-file selection across list refreshes", () => {
  const idForItem = (item) => item.filePath;
  const rows = (...names) => names.map((name) => ({ filePath: `${name}.txt` }));
  const selectedPaths = (selection) => Array.from(selection.getSelectedItems(), idForItem).sort();

  it("retains a reversed range and its Shift anchor when refreshed rows replace the originals", () => {
    const original = rows("a", "b", "c", "d", "e");
    const selection = new ListSelection({ items: original })
      .selectItem(original[4])
      .selectRangeToItem(original[1]);
    const refreshed = rows("a", "b", "c", "d", "e");
    const updated = selection.setItems(refreshed, idForItem);

    expect(selectedPaths(updated)).toEqual(["b.txt", "c.txt", "d.txt", "e.txt"]);
    expect(updated.getSelectedCount()).toBe(4);
    expect(updated.getHeadItem()).toBe(refreshed[1]);
    expect(updated.getItems()[updated.getTailIndex()]).toBe(refreshed[4]);
    expect(Array.from(updated.getSelectedItems()).every((item) => refreshed.includes(item))).toBe(
      true,
    );
    expect(selectedPaths(updated.selectRangeToItem(refreshed[0]))).toEqual([
      "a.txt",
      "b.txt",
      "c.txt",
      "d.txt",
      "e.txt",
    ]);
  });

  it("retains disconnected selections and an explicitly deselected row", () => {
    const original = rows("a", "b", "c", "d", "e");
    const selection = new ListSelection({ items: original })
      .addOrSubtractSelection(original[2])
      .coalesce()
      .addOrSubtractSelection(original[4])
      .coalesce()
      .addOrSubtractSelection(original[2])
      .coalesce();
    const refreshed = rows("a", "b", "c", "d", "e", "f");
    const updated = selection.setItems(refreshed, idForItem);

    expect(selectedPaths(updated)).toEqual(["a.txt", "e.txt"]);
    expect(updated.getSelectedCount()).toBe(2);
    expect(updated.getHeadItem()).toBe(refreshed[4]);
  });

  it("preserves selected identities through inserted rows and reordered files", () => {
    const original = rows("a", "b", "c", "d", "e");
    const selection = new ListSelection({ items: original })
      .selectItem(original[1])
      .selectRangeToItem(original[3]);
    const refreshed = rows("d", "inserted", "b", "a", "c", "e");
    const updated = selection.setItems(refreshed, idForItem);

    expect(selectedPaths(updated)).toEqual(["b.txt", "c.txt", "d.txt"]);
    expect(updated.getSelectedCount()).toBe(3);
    expect(updated.getHeadItem()).toBe(refreshed[0]);
    expect(selectedPaths(updated.coalesce())).toEqual(["b.txt", "c.txt", "d.txt"]);
  });

  it("retains the surviving selected rows when the selection head disappears", () => {
    const original = rows("a", "b", "c", "d", "e");
    const selection = new ListSelection({ items: original })
      .selectItem(original[1])
      .selectRangeToItem(original[3]);
    const refreshed = rows("a", "b", "c", "e");
    const updated = selection.setItems(refreshed, idForItem);

    expect(selectedPaths(updated)).toEqual(["b.txt", "c.txt"]);
    expect(updated.getSelectedCount()).toBe(2);
    expect(updated.getHeadItem()).toBe(refreshed[2]);
  });

  it("keeps an explicitly empty selection when rows are refreshed or inserted", () => {
    const original = rows("a", "b");
    const selection = new ListSelection({ items: original })
      .addOrSubtractSelection(original[0])
      .coalesce();
    const refreshed = selection.setItems(rows("a", "b"), idForItem);
    const extended = refreshed.setItems(rows("a", "b", "c"), idForItem);

    expect(selectedPaths(refreshed)).toEqual([]);
    expect(refreshed.getHeadItem()).toBeNull();
    expect(selectedPaths(extended)).toEqual([]);
    expect(extended.getSelectedCount()).toBe(0);
  });

  it("selects the first row when an initially empty list becomes populated", () => {
    const refreshed = rows("a", "b");
    const updated = new ListSelection().setItems(refreshed, idForItem);

    expect(Array.from(updated.getSelectedItems())).toEqual([refreshed[0]]);
    expect(updated.getHeadItem()).toBe(refreshed[0]);
  });

  it("falls back to the nearest remaining row when every selected file disappears", () => {
    const original = rows("a", "b", "c", "d", "e");
    const selection = new ListSelection({ items: original })
      .selectItem(original[2])
      .selectRangeToItem(original[3]);
    const refreshed = rows("x", "y");
    const updated = selection.setItems(refreshed, idForItem);

    expect(Array.from(updated.getSelectedItems())).toEqual([refreshed[1]]);
    expect(updated.getHeadItem()).toBe(refreshed[1]);
    expect(updated.getSelectedCount()).toBe(1);
  });

  it("switches away from an emptied active list after refreshing the composite selection", () => {
    const unstaged = rows("a", "b");
    const staged = rows("c");
    const selection = new CompositeListSelection({
      listsByKey: [
        ["unstaged", unstaged],
        ["staged", staged],
        ["conflicts", []],
      ],
      idForItem,
    }).selectAllItems();
    const refreshedStaged = rows("c", "d");
    const updated = selection.updateLists([
      ["unstaged", []],
      ["staged", refreshedStaged],
      ["conflicts", []],
    ]);

    expect(updated.getActiveListKey()).toBe("staged");
    expect(Array.from(updated.getSelectedItems())).toEqual([refreshedStaged[0]]);
    expect(updated.activateListKey("unstaged").getSelectedCount()).toBe(0);
  });

  it("keeps selections separate when the same file appears in staged and unstaged lists", () => {
    const unstaged = rows("a", "shared", "b");
    const staged = rows("shared", "c");
    const selection = new CompositeListSelection({
      listsByKey: [
        ["unstaged", unstaged],
        ["staged", staged],
      ],
      idForItem,
    })
      .selectItem(unstaged[1])
      .selectRangeToItem(unstaged[2])
      .selectItem(staged[0])
      .selectRangeToItem(staged[1]);
    const refreshedUnstaged = rows("a", "shared", "b");
    const refreshedStaged = rows("shared", "c");
    const updated = selection.updateLists([
      ["unstaged", refreshedUnstaged],
      ["staged", refreshedStaged],
    ]);

    expect(updated.getActiveListKey()).toBe("staged");
    expect(selectedPaths(updated)).toEqual(["c.txt", "shared.txt"]);
    expect(updated.getHeadItem()).toBe(refreshedStaged[1]);
    const updatedUnstaged = updated.activateListKey("unstaged");
    expect(selectedPaths(updatedUnstaged)).toEqual(["b.txt", "shared.txt"]);
    expect(updatedUnstaged.getHeadItem()).toBe(refreshedUnstaged[2]);
    expect(updatedUnstaged.getSelectedItems().has(refreshedStaged[0])).toBe(false);
  });
});
