/** @babel */
import { Range } from "lumine";
import { populateBoundedWordDiffs } from "../lib/models/patch/word-diff";
import MultiFilePatch from "../lib/models/patch/multi-file-patch";
import PatchBuffer from "../lib/models/patch/patch-buffer";
import MultiFilePatchView from "../lib/views/multi-file-patch-view";

const ROW_COUNT = 200000;
const largeRows = () => Array.from({ length: ROW_COUNT }, (_, index) => index);

describe("large patch regions without variadic argument limits", () => {
  it("reports the entire deletion/addition pair when the detail budget is already exhausted", () => {
    const rows = largeRows();
    const lineForRow = jasmine.createSpy("unneeded line read");
    const clear = jasmine.createSpy("clear word markers");
    const buffer = { batchMarkerLayerUpdates: (callback) => callback(), lineForRow };
    const patchBuffer = { getBuffer: () => buffer, getLayer: () => ({ clear }) };
    const hunk = {
      getRegions: () => [
        { isDeletion: () => true, getBufferRows: () => rows },
        { isDeletion: () => false, isAddition: () => true, getBufferRows: () => rows },
      ],
    };
    const stats = populateBoundedWordDiffs(patchBuffer, [hunk], {
      clock: () => 0,
      populationBudgetMs: 0,
    });
    expect(stats.pairedLines).toBe(ROW_COUNT);
    expect(stats.omittedPairs).toBe(ROW_COUNT);
    expect(stats.reasons.populationBudget).toBe(ROW_COUNT);
    expect(stats.detailedPairs).toBe(0);
    expect(lineForRow).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledTimes(2);
  });

  it("collects a large marker layer in its original order", () => {
    const markers = largeRows();
    const patchBuffer = Object.create(PatchBuffer.prototype);
    const query = { endPosition: [0, 0] };
    patchBuffer.findMarkers = jasmine
      .createSpy("find layer markers")
      .and.callFake((layer) => (layer === "word-addition" ? markers : []));
    const collected = patchBuffer.findAllMarkers(query);
    expect(collected.length).toBe(ROW_COUNT);
    expect(collected[0]).toBe(0);
    expect(collected[ROW_COUNT - 1]).toBe(ROW_COUNT - 1);
    expect(patchBuffer.findMarkers).toHaveBeenCalledWith("word-addition", query);
  });

  it("finds the maximum of a large unsorted selection before preserving its logical position", () => {
    const selection = new Set(
      Array.from({ length: ROW_COUNT }, (_, index) => ROW_COUNT + 2 - index),
    );
    const intersectsRow = jasmine
      .createSpy("selection tail")
      .and.callFake((row) => row === ROW_COUNT + 2);
    const intersections = [
      {
        gap: true,
        intersection: Range.fromObject([
          [0, 0],
          [2, Infinity],
        ]),
      },
      { gap: false, intersection: { intersectsRow, start: { row: 3 } } },
    ];
    const model = Object.create(MultiFilePatch.prototype);
    model.getFilePatches = () => [
      { getHunks: () => [{ getChanges: () => [{ intersectRows: () => intersections }] }] },
    ];
    expect(model.getMaxSelectionIndex(selection)).toBe(3);
    expect(intersectsRow).toHaveBeenCalledOnceWith(ROW_COUNT + 2);
  });

  it("passes every changed row of a large hunk to staging", async () => {
    const rows = largeRows();
    const toggleRows = jasmine.createSpy("stage hunk").and.resolveTo();
    const view = Object.create(MultiFilePatchView.prototype);
    view.props = { toggleRows };
    await view.toggleHunkSelection({ getChanges: () => [{ getBufferRows: () => rows }] }, false);
    const [selection, mode, options] = toggleRows.calls.mostRecent().args;
    expect(selection.size).toBe(ROW_COUNT);
    expect(selection.has(0)).toBe(true);
    expect(selection.has(ROW_COUNT - 1)).toBe(true);
    expect(mode).toBe("hunk");
    expect(options).toEqual({ eventSource: "button" });
  });

  it("passes every changed row of a large hunk to discard", async () => {
    const rows = largeRows();
    const discardRows = jasmine.createSpy("discard hunk").and.resolveTo();
    const view = Object.create(MultiFilePatchView.prototype);
    view.props = { discardRows };
    await view.discardHunkSelection({ getChanges: () => [{ getBufferRows: () => rows }] }, false);
    const [selection, mode, options] = discardRows.calls.mostRecent().args;
    expect(selection.size).toBe(ROW_COUNT);
    expect(selection.has(0)).toBe(true);
    expect(selection.has(ROW_COUNT - 1)).toBe(true);
    expect(mode).toBe("hunk");
    expect(options).toEqual({ eventSource: "button" });
  });
});
