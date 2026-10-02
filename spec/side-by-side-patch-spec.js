/** @babel */

import { buildMultiFilePatch } from "../lib/models/patch";
import buildSideBySidePatch from "../lib/models/patch/side-by-side";
import { COLLAPSED } from "../lib/models/patch/patch";

function diff(path, hunks, overrides = {}) {
  return {
    oldPath: path,
    newPath: path,
    oldMode: "100644",
    newMode: "100644",
    status: "modified",
    hunks,
    ...overrides,
  };
}

function hunk(lines, oldStartLine = 1, newStartLine = 1) {
  return {
    oldStartLine,
    oldLineCount: lines.filter((line) => line.kind === "context" || line.kind === "deleted").length,
    newStartLine,
    newLineCount: lines.filter((line) => line.kind === "context" || line.kind === "added").length,
    heading: "",
    lines,
  };
}

const context = (text) => ({ kind: "context", text });
const deleted = (text) => ({ kind: "deleted", text });
const added = (text) => ({ kind: "added", text });
const noNewline = () => ({ kind: "nonewline", text: "" });

describe("side-by-side patch projection", () => {
  const patches = [];

  function build(diffs, options) {
    const patch = buildMultiFilePatch(diffs, options);
    patches.push(patch);
    return patch;
  }

  afterEach(() => {
    while (patches.length > 0) patches.pop().dispose();
  });

  it("pairs a replacement while retaining canonical rows and source line numbers", () => {
    const patch = build([
      diff("a.txt", [
        hunk([context("before"), deleted("old"), added("new"), context("after")], 8, 9),
      ]),
    ]);
    const [filePatch] = patch.getFilePatches();
    const [patchHunk] = filePatch.getHunks();
    const projection = buildSideBySidePatch(patch);

    expect(projection.oldText).toBe("before\nold\nafter");
    expect(projection.newText).toBe("before\nnew\nafter");
    expect(projection.rows).toEqual([
      {
        oldRow: 0,
        newRow: 0,
        oldLineNumber: 8,
        newLineNumber: 9,
        oldType: "unchanged",
        newType: "unchanged",
        filePatch,
        hunk: patchHunk,
      },
      {
        oldRow: 1,
        newRow: 2,
        oldLineNumber: 9,
        newLineNumber: 10,
        oldType: "deleted",
        newType: "added",
        filePatch,
        hunk: patchHunk,
      },
      {
        oldRow: 3,
        newRow: 3,
        oldLineNumber: 10,
        newLineNumber: 11,
        oldType: "unchanged",
        newType: "unchanged",
        filePatch,
        hunk: patchHunk,
      },
    ]);
    expect(projection.fileRanges.get(filePatch)).toEqual([0, 2]);
    expect(projection.hunkRanges.get(patchHunk)).toEqual([0, 2]);
    expect(Array.from(projection.patchRowToDisplayRow)).toEqual([
      [0, 0],
      [1, 1],
      [2, 1],
      [3, 2],
    ]);
  });

  it("pads the shorter side of replacements without consuming source line numbers", () => {
    const patch = build([
      diff("a.txt", [
        hunk([
          deleted("old one"),
          deleted("old two"),
          added("new"),
          context("same"),
          deleted("old"),
          added("new one"),
          added("new two"),
        ]),
      ]),
    ]);
    const projection = buildSideBySidePatch(patch);

    expect(projection.oldText).toBe("old one\nold two\nsame\nold\n");
    expect(projection.newText).toBe("new\n\nsame\nnew one\nnew two");
    expect(projection.rows.map((row) => [row.oldRow, row.newRow])).toEqual([
      [0, 2],
      [1, null],
      [3, 3],
      [4, 5],
      [null, 6],
    ]);
    expect(projection.rows.map((row) => [row.oldLineNumber, row.newLineNumber])).toEqual([
      [1, 1],
      [2, null],
      [3, 2],
      [4, 3],
      [null, 4],
    ]);
    expect(projection.rows[1].newType).toBeNull();
    expect(projection.rows[4].oldType).toBeNull();
  });

  it("keeps additions and deletions separate across unchanged context", () => {
    const patch = build([
      diff("a.txt", [hunk([added("inserted"), context("middle"), deleted("removed")], 5, 6)]),
    ]);
    const projection = buildSideBySidePatch(patch);

    expect(projection.oldText).toBe("\nmiddle\nremoved");
    expect(projection.newText).toBe("inserted\nmiddle\n");
    expect(projection.rows.map((row) => [row.oldRow, row.newRow])).toEqual([
      [null, 0],
      [1, 1],
      [2, null],
    ]);
    expect(projection.rows.map((row) => [row.oldLineNumber, row.newLineNumber])).toEqual([
      [null, 6],
      [5, 7],
      [6, null],
    ]);
  });

  it("projects a newly added and a deleted file onto their present side", () => {
    const patch = build([
      diff("new.txt", [hunk([added("new")], 0, 1)], {
        oldPath: null,
        oldMode: null,
        status: "added",
      }),
      diff("old.txt", [hunk([deleted("old")], 1, 0)], {
        newPath: null,
        newMode: null,
        status: "deleted",
      }),
    ]);
    const projection = buildSideBySidePatch(patch);

    expect(projection.oldText).toBe("\nold");
    expect(projection.newText).toBe("new\n");
    expect(projection.rows.map((row) => [row.oldLineNumber, row.newLineNumber])).toEqual([
      [null, 1],
      [1, null],
    ]);
  });

  it("aligns replacement content around no-newline markers on each side", () => {
    const patch = build([
      diff("a.txt", [hunk([deleted("old"), noNewline(), added("new"), noNewline()])]),
    ]);
    const projection = buildSideBySidePatch(patch);

    expect(projection.rows.map((row) => [row.oldRow, row.newRow])).toEqual([
      [0, 2],
      [1, 3],
    ]);
    expect(projection.rows.map((row) => [row.oldType, row.newType])).toEqual([
      ["deleted", "added"],
      ["nonewline", "nonewline"],
    ]);
    expect(projection.rows[1].oldLineNumber).toBeNull();
    expect(projection.rows[1].newLineNumber).toBeNull();
    expect(projection.oldText).toBe("old\n No newline at end of file");
    expect(projection.newText).toBe("new\n No newline at end of file");
    expect(projection.patchRowToDisplayRow.get(1)).toBe(1);
    expect(projection.patchRowToDisplayRow.get(3)).toBe(1);
  });

  it("attaches a single no-newline marker only to its preceding side", () => {
    const patch = build([
      diff("a.txt", [hunk([deleted("old"), noNewline(), added("new one"), added("new two")])]),
    ]);
    const projection = buildSideBySidePatch(patch);

    expect(projection.rows.map((row) => [row.oldRow, row.newRow])).toEqual([
      [0, 2],
      [1, null],
      [null, 3],
    ]);
    expect(projection.rows[1].oldType).toBe("nonewline");
    expect(projection.rows[1].newType).toBeNull();
    expect(projection.newText).toBe("new one\n\nnew two");
  });

  it("shows a no-newline marker after unchanged context on both sides", () => {
    const patch = build([diff("a.txt", [hunk([context("same"), noNewline()])])]);
    const projection = buildSideBySidePatch(patch);

    expect(projection.rows.map((row) => [row.oldRow, row.newRow])).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(projection.rows[1].oldType).toBe("nonewline");
    expect(projection.rows[1].newType).toBe("nonewline");
    expect(projection.oldText).toBe(projection.newText);
  });

  it("anchors collapsed and metadata-only files without exposing their hidden hunks", () => {
    const patch = build(
      [
        diff("hidden.txt", [hunk([deleted("hidden old"), added("hidden new")])]),
        diff("mode.txt", [], { newMode: "100755" }),
        diff("visible.txt", [hunk([added("visible")])]),
      ],
      { renderStatusOverrides: { "hidden.txt": COLLAPSED } },
    );
    const projection = buildSideBySidePatch(patch);
    const [hidden, mode, visible] = patch.getFilePatches();

    expect(projection.rows).toHaveSize(3);
    for (const row of projection.rows.slice(0, 2)) {
      expect(row.oldRow).toBeNull();
      expect(row.newRow).toBeNull();
      expect(row.hunk).toBeNull();
    }
    expect(projection.fileRanges.get(hidden)).toEqual([0, 0]);
    expect(projection.fileRanges.get(mode)).toEqual([1, 1]);
    expect(projection.fileRanges.get(visible)).toEqual([2, 2]);
    expect(projection.hunkRanges.size).toBe(1);
    expect(projection.oldText).toBe("\n\n");
    expect(projection.newText).toBe("\n\nvisible");
  });

  it("records distinct ranges for multiple files and hunks", () => {
    const patch = build([
      diff("first.txt", [
        hunk([deleted("first old"), added("first new")], 3, 3),
        hunk([added("later")], 20, 21),
      ]),
      diff("second.txt", [hunk([context("same"), deleted("last")], 100, 101)]),
    ]);
    const [first, second] = patch.getFilePatches();
    const [firstHunk, laterHunk] = first.getHunks();
    const [lastHunk] = second.getHunks();
    const projection = buildSideBySidePatch(patch);

    expect(projection.fileRanges.get(first)).toEqual([0, 1]);
    expect(projection.fileRanges.get(second)).toEqual([2, 3]);
    expect(projection.hunkRanges.get(firstHunk)).toEqual([0, 0]);
    expect(projection.hunkRanges.get(laterHunk)).toEqual([1, 1]);
    expect(projection.hunkRanges.get(lastHunk)).toEqual([2, 3]);
    expect(projection.rows.map((row) => [row.oldLineNumber, row.newLineNumber])).toEqual([
      [3, 3],
      [null, 21],
      [100, 101],
      [101, null],
    ]);
  });

  it("does not mutate patch text or the row set used by staging", () => {
    const patch = build([diff("a.txt", [hunk([deleted("old"), added("new")])])]);
    const originalText = patch.getBuffer().getText();
    const originalPatch = patch.toString();
    const projection = buildSideBySidePatch(patch);
    const stagePatch = patch.getStagePatchForLines(
      new Set([projection.rows[0].oldRow, projection.rows[0].newRow]),
    );
    try {
      expect(patch.getBuffer().getText()).toBe(originalText);
      expect(patch.toString()).toBe(originalPatch);
      expect(stagePatch.toString()).toContain("-old\n+new");
    } finally {
      stagePatch.dispose();
    }
  });

  it("projects a large replacement without variadic argument limits", () => {
    const count = 100000;
    const lines = [];
    for (let index = 0; index < count; index++) lines.push(deleted(`old ${index}`));
    for (let index = 0; index < count; index++) lines.push(added(`new ${index}`));
    const patch = build([diff("large.txt", [hunk(lines)])], {
      largeDiffThreshold: Infinity,
    });
    const projection = buildSideBySidePatch(patch);

    expect(projection.rows).toHaveSize(count);
    expect(projection.rows[0].oldRow).toBe(0);
    expect(projection.rows[0].newRow).toBe(count);
    expect(projection.rows[count - 1].oldRow).toBe(count - 1);
    expect(projection.rows[count - 1].newRow).toBe(2 * count - 1);
    expect(projection.patchRowToDisplayRow.size).toBe(2 * count);
    expect(projection.oldText.endsWith(`old ${count - 1}`)).toBe(true);
    expect(projection.newText.endsWith(`new ${count - 1}`)).toBe(true);
  });
});
