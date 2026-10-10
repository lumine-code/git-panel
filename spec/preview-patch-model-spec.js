/** @babel */
import { buildMultiFilePatch } from "../lib/models/patch";
import buildSideBySidePatch from "../lib/models/patch/side-by-side";
import * as wordDiff from "../lib/models/patch/word-diff";

function hunk(lines, oldStartLine = 10, newStartLine = 20) {
  return {
    oldStartLine,
    newStartLine,
    oldLineCount: lines.filter((line) => line[0] === " " || line[0] === "-").length,
    newLineCount: lines.filter((line) => line[0] === " " || line[0] === "+").length,
    heading: "section",
    lines,
  };
}

function diff(path, hunks, overrides = {}) {
  return {
    oldPath: path,
    newPath: path,
    oldMode: "100644",
    newMode: "100755",
    status: "modified",
    hunks,
    ...overrides,
  };
}

describe("owned preview patch models", () => {
  const owned = [];
  const own = (model) => {
    owned.push(model);
    return model;
  };
  const build = (raw, options) =>
    own(buildMultiFilePatch(raw, { largeDiffThreshold: Infinity, ...options }));
  const preview = (source, path, position, rows) =>
    own(source.createPreviewPatch(path, position, rows));
  const wordRanges = (layer) => layer.getMarkers().map((marker) => marker.getRange().serialize());

  afterEach(() => {
    while (owned.length) owned.pop().dispose();
  });

  it("clips only the requested file and hunk while retaining source line numbers and file metadata", () => {
    const source = build([
      diff("before.txt", [hunk(["-before", "+after"])]),
      diff("target.txt", [
        hunk([
          " before zero",
          " before one",
          "-old red",
          "+new green",
          " after zero",
          " after one",
        ]),
        hunk([" later", "-last old", "+last new"], 50, 80),
      ]),
      diff("after.txt", [hunk(["-before", "+after"])]),
    ]);
    const snippet = preview(source, "target.txt", 4, 3);
    expect(snippet.getBuffer().getText()).toBe("before one\nold red\nnew green");
    expect(snippet.getFilePatches().map((file) => file.getPath())).toEqual(["target.txt"]);
    expect(snippet.getPatchLayer().getMarkerCount()).toBe(1);
    expect(snippet.getHunkLayer().getMarkerCount()).toBe(1);
    const [file] = snippet.getFilePatches();
    const [clipped] = file.getHunks();
    expect(file.getOldMode()).toBe("100644");
    expect(file.getNewMode()).toBe("100755");
    expect(file.getOldFile()).not.toBe(source.getPatchForPath("target.txt").getOldFile());
    expect(file.getNewFile()).not.toBe(source.getPatchForPath("target.txt").getNewFile());
    expect(clipped.getSectionHeading()).toBe("section");
    expect([clipped.getOldStartRow(), clipped.getNewStartRow()]).toEqual([11, 21]);
    expect([clipped.getOldRowCount(), clipped.getNewRowCount()]).toEqual([2, 2]);
    expect(clipped.getOldRowAt(1)).toBe(12);
    expect(clipped.getNewRowAt(2)).toBe(22);
    const projection = buildSideBySidePatch(snippet);
    expect(projection.rows.map((row) => [row.oldLineNumber, row.newLineNumber])).toEqual([
      [11, 21],
      [12, 22],
    ]);
    const later = preview(source, "target.txt", 10, 2);
    expect(later.getBuffer().getText()).toBe("last old\nlast new");
    expect(later.getFilePatches()[0].getHunks()[0].getHeader()).toBe("@@ -51,1 +81,1 @@");
  });

  it("matches the existing preview window and never crosses its hunk start", () => {
    const source = build([diff("target.txt", [hunk([" before", "-old", "+new", " after"])])]);
    for (const [position, rowCount] of [
      [1, 1],
      [3, 2],
      [4, 100],
    ]) {
      const buffer = source.getPreviewPatchBuffer("target.txt", position, rowCount);
      try {
        const snippet = preview(source, "target.txt", position, rowCount);
        expect(snippet.getBuffer().getText()).toBe(buffer.getBuffer().getText());
        expect(snippet.getBuffer().getLineCount()).toBeLessThanOrEqual(rowCount);
      } finally {
        buffer.dispose();
      }
    }
  });

  it("counts no-newline annotations as preview rows without advancing either source line", () => {
    const source = build([
      diff("target.txt", [
        hunk([
          " before",
          "-old",
          "\\ No newline at end of file",
          "+new",
          "\\ No newline at end of file",
        ]),
      ]),
    ]);
    const snippet = preview(source, "target.txt", 5, 4);
    const clipped = snippet.getHunkAt(0);
    expect(snippet.getBuffer().getLineCount()).toBe(4);
    expect(snippet.getNoNewlineLayer().getMarkerCount()).toBe(2);
    expect([clipped.getOldStartRow(), clipped.getNewStartRow()]).toEqual([11, 21]);
    expect([clipped.getOldRowCount(), clipped.getNewRowCount()]).toEqual([1, 1]);
    expect(clipped.getOldRowAt(1)).toBeNull();
    expect(clipped.getNewRowAt(3)).toBeNull();
    expect(
      buildSideBySidePatch(snippet).rows.map((row) => [row.oldLineNumber, row.newLineNumber]),
    ).toEqual([
      [11, 21],
      [null, null],
    ]);
  });

  it("copies existing word markers without recomputing bounded highlighting", () => {
    const source = build([
      diff("other.txt", [hunk(["-old apple", "+new pear"])]),
      diff("target.txt", [hunk([" context", "-😀 old value", "+😀 new value"])]),
    ]);
    const sourceWords = wordRanges(source.getWordAdditionLayer());
    const population = spyOn(wordDiff, "populateWordDiffs").and.callThrough();
    const snippet = preview(source, "target.txt", 3, 2);
    expect(population).not.toHaveBeenCalled();
    expect(wordRanges(snippet.getWordDeletionLayer())).toEqual([
      [
        [0, 3],
        [0, 6],
      ],
    ]);
    expect(wordRanges(snippet.getWordAdditionLayer())).toEqual([
      [
        [1, 3],
        [1, 6],
      ],
    ]);
    expect(wordRanges(source.getWordAdditionLayer())).toEqual(sourceWords);
    expect(snippet.getWordDiffStats().detailedPairs).toBe(1);
  });

  it("keeps descriptors for a preview containing only an empty added final line", () => {
    const source = build([diff("target.txt", [hunk(["-old", "+new", "+"])])]);
    const snippet = preview(source, "target.txt", 3, 1);
    expect(snippet.getBuffer().getText()).toBe("");
    expect(snippet.getFilePatches().length).toBe(1);
    expect(snippet.getPatchLayer().getMarkerCount()).toBe(1);
    expect(snippet.getHunkLayer().getMarkerCount()).toBe(1);
    expect(snippet.getAdditionLayer().getMarkerCount()).toBe(1);
    const clipped = snippet.getHunkAt(0);
    expect([clipped.getOldRowCount(), clipped.getNewRowCount()]).toEqual([0, 1]);
    expect(clipped.getNewRowAt(0)).toBe(21);
    expect(buildSideBySidePatch(snippet).rows[0].newLineNumber).toBe(21);
  });

  it("retains the source hunk's omission decisions instead of restarting its population budget", () => {
    const source = build([
      diff("target.txt", [hunk(["-old first", "-old second", "+new first", "+new second"])]),
    ]);
    const stats = wordDiff.populateBoundedWordDiffs(
      source.getPatchBuffer(),
      source.getPatchForPath("target.txt").getHunks(),
      { populationBudgetMs: 0, clock: () => 0 },
    );
    const snippet = preview(source, "target.txt", 4, 2);
    expect(snippet.getWordAdditionLayer().getMarkerCount()).toBe(0);
    expect(snippet.getWordDeletionLayer().getMarkerCount()).toBe(0);
    expect(snippet.getWordDiffStats()).toEqual(stats);
    expect(snippet.getWordDiffStats().reasons.populationBudget).toBe(2);
    expect(snippet.getHunkAt(0).wordDiffStats).not.toBe(source.getHunkAt(0).wordDiffStats);
    expect(snippet.getHunkAt(0).wordDiffStats.reasons).not.toBe(
      source.getHunkAt(0).wordDiffStats.reasons,
    );
  });

  it("owns only copied markers and remains usable after the source is disposed", () => {
    const source = build([
      diff("target.txt", [hunk([" context", "-old red", "+new green", " trailing"])]),
      diff("other.txt", [hunk(["-other old", "+other new"])]),
    ]);
    const sourceBuffer = source.getBuffer();
    const sourceMarkers = source.getPatchBuffer().findAllMarkers({});
    const snippet = preview(source, "target.txt", 3, 2);
    const snippetBuffer = snippet.getBuffer();
    const snippetMarkers = snippet.getPatchBuffer().findAllMarkers({});
    expect(snippetBuffer).not.toBe(sourceBuffer);
    expect(sourceBuffer.refcount).toBe(1);
    expect(snippetBuffer.refcount).toBe(1);
    expect(snippetMarkers.every((marker) => !sourceMarkers.includes(marker))).toBe(true);
    const [file] = snippet.getFilePatches();
    expect(snippetMarkers).toContain(file.getMarker());
    for (const clipped of file.getHunks()) {
      expect(snippetMarkers).toContain(clipped.getMarker());
      for (const region of clipped.getRegions())
        expect(snippetMarkers).toContain(region.getMarker());
    }
    source.dispose();
    expect(sourceBuffer.isDestroyed()).toBe(true);
    expect(snippetBuffer.isDestroyed()).toBe(false);
    expect(snippet.toString()).toContain("@@ -11,1 +21,1 @@");
    expect(buildSideBySidePatch(snippet).newText).toBe("new green");
    snippet.dispose();
    expect(snippetBuffer.isDestroyed()).toBe(true);
    expect(snippetMarkers.every((marker) => marker.isDestroyed())).toBe(true);
  });

  it("can release a preview without destroying or altering source markers", () => {
    const source = build([diff("target.txt", [hunk([" context", "-old", "+new", " trailing"])])]);
    const original = source.toString();
    const markers = source.getPatchBuffer().findAllMarkers({});
    preview(source, "target.txt", 3, 1).dispose();
    expect(source.toString()).toBe(original);
    expect(markers.every((marker) => !marker.isDestroyed())).toBe(true);
  });

  it("returns independently disposable empty models for unavailable positions", () => {
    const source = build([diff("target.txt", [hunk(["-old", "+new"])])]);
    spyOn(console, "error");
    for (const [path, position, count] of [
      ["missing.txt", 1, 4],
      ["target.txt", 999, 4],
      ["target.txt", 0, 4],
      ["target.txt", -1, 4],
      ["target.txt", 1, 0],
    ]) {
      const snippet = preview(source, path, position, count);
      expect(snippet.getFilePatches()).toEqual([]);
      expect(snippet.getBuffer().isEmpty()).toBe(true);
      const buffer = snippet.getBuffer();
      snippet.dispose();
      expect(buffer.isDestroyed()).toBe(true);
    }
    const hidden = build([diff("target.txt", [hunk(["-old", "+new"])])], { largeDiffThreshold: 0 });
    expect(preview(hidden, "target.txt", 1, 4).getFilePatches()).toEqual([]);
  });
});
