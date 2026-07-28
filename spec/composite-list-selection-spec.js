/** @babel */
import CompositeListSelection from "../lib/models/composite-list-selection";

describe("CompositeListSelection", () => {
  function buildSelection() {
    return new CompositeListSelection({
      listsByKey: [
        ["unstaged", [{ filePath: "a.txt" }, { filePath: "b.txt" }]],
        ["staged", []],
      ],
      idForItem: (item) => item.filePath,
    });
  }

  it("resolves the update promise through copies made before the promise existed", async () => {
    const original = buildSelection();

    // The staging view routinely replaces its selection with copies — a
    // selection change, a coalesce, a workspace sync. A copy created before
    // getNextUpdatePromise() was called must still resolve that promise when
    // it processes the next list update; losing it left the staging guard
    // stuck and every further click swallowed.
    const copyMadeEarlier = original.selectNextItem();

    let resolved = false;
    const updatePromise = original.getNextUpdatePromise().then(() => {
      resolved = true;
    });

    copyMadeEarlier.updateLists([
      ["unstaged", [{ filePath: "b.txt" }]],
      ["staged", [{ filePath: "a.txt" }]],
    ]);

    await updatePromise;
    expect(resolved).toBe(true);
  });

  it("resolves the update promise when a later copy processes the update", async () => {
    const original = buildSelection();

    let resolved = false;
    const updatePromise = original.getNextUpdatePromise().then(() => {
      resolved = true;
    });
    const laterCopy = original.selectNextItem();

    laterCopy.updateLists([
      ["unstaged", [{ filePath: "a.txt" }]],
      ["staged", [{ filePath: "b.txt" }]],
    ]);

    await updatePromise;
    expect(resolved).toBe(true);
  });
});
