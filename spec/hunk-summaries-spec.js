/** @babel */
import { buildMultiFilePatch, buildFilePatch } from "../lib/models/patch";
import { COLLAPSED } from "../lib/models/patch/patch";

function hunk(oldStartLine, newStartLine, lines, heading = "") {
  return {
    oldStartLine,
    newStartLine,
    oldLineCount: lines.filter((line) => line[0] === "-" || line[0] === " ").length,
    newLineCount: lines.filter((line) => line[0] === "+" || line[0] === " ").length,
    heading,
    lines,
  };
}

function diff(filePath = "example.txt") {
  return {
    oldPath: filePath,
    newPath: filePath,
    oldMode: "100644",
    newMode: "100644",
    status: "modified",
    hunks: [
      hunk(10, 10, ["-before", "+first", "+second"], "first section"),
      hunk(20, 21, ["-later", "+latest"], "last section"),
    ],
  };
}

function summaries() {
  return [
    {
      oldStartRow: 10,
      newStartRow: 10,
      oldRowCount: 1,
      newRowCount: 2,
      sectionHeading: "first section",
    },
    {
      oldStartRow: 20,
      newStartRow: 21,
      oldRowCount: 1,
      newRowCount: 1,
      sectionHeading: "last section",
    },
  ];
}

describe("file patch hunk summaries", () => {
  const models = [];
  const own = (model) => {
    models.push(model);
    return model;
  };
  const build = (files = [diff()], options = {}) => own(buildMultiFilePatch(files, options));
  afterEach(() => {
    while (models.length) models.pop().dispose();
  });

  it("lists complete headers in model order without exposing content or markers", () => {
    const model = build();
    const file = model.getFilePatches()[0];
    expect(file.getHunkSummaries()).toEqual(summaries());
    const result = file.getHunkSummaries();
    result[0].sectionHeading = "changed outside the model";
    result.pop();
    expect(file.getHunkSummaries()).toEqual(summaries());
  });

  it("lists deferred hunks without loading their lines or preserving raw content", () => {
    const model = build([diff()], { largeDiffThreshold: 0 });
    const file = model.getFilePatches()[0];
    spyOn(file.getPatch(), "show").and.callThrough();
    expect(file.getHunkSummaries()).toEqual(summaries());
    expect(file.getPatch().show).not.toHaveBeenCalled();
    expect(file.getHunks()).toEqual([]);
    expect(file.getRenderStatus().isVisible()).toBe(false);
    expect(model.getBuffer().getText()).toBe("");
    expect(file.rawPatches).toBeNull();
    const result = file.getHunkSummaries();
    result[0].newStartRow = 999;
    expect(file.getHunkSummaries()).toEqual(summaries());
  });

  it("normalizes initially collapsed structured headers, including zero source counts", () => {
    const raw = diff();
    raw.hunks = [
      {
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 1,
        heading: null,
        lines: [{ kind: "added", text: "new file contents" }],
      },
    ];
    const model = build([raw], { renderStatusOverrides: { "example.txt": COLLAPSED } });
    const file = model.getFilePatches()[0];
    const expected = [
      { oldStartRow: 0, newStartRow: 1, oldRowCount: 0, newRowCount: 1, sectionHeading: "" },
    ];
    expect(file.getHunkSummaries()).toEqual(expected);
    model.expandFilePatch(file);
    expect(file.getHunkSummaries()).toEqual(expected);
  });

  it("preserves deferred summaries in an independently owned clone", () => {
    const original = build([diff()], { largeDiffThreshold: 0 });
    const clone = own(original.clone());
    const originalFile = original.getFilePatches()[0];
    const clonedFile = clone.getFilePatches()[0];
    expect(clonedFile.getHunkSummaries()).toEqual(summaries());
    clone.expandFilePatch(clonedFile);
    expect(originalFile.getHunks()).toEqual([]);
    original.dispose();
    clone.collapseFilePatch(clonedFile);
    expect(clonedFile.getHunkSummaries()).toEqual(summaries());
    clone.expandFilePatch(clonedFile);
    expect(clonedFile.getHunkSummaries()).toEqual(summaries());
  });

  it("retains summaries through repeated collapse and expansion beside another file", () => {
    const model = build([diff("first.txt"), diff()]);
    const [first, file] = model.getFilePatches();
    for (let index = 0; index < 2; index++) {
      model.collapseFilePatch(file);
      model.collapseFilePatch(first);
      expect(file.getHunks()).toEqual([]);
      expect(file.getHunkSummaries()).toEqual(summaries());
      model.expandFilePatch(file);
      model.expandFilePatch(first);
      expect(file.getHunkSummaries()).toEqual(summaries());
    }
  });

  it("uses a refreshed snapshot's headers after adopting the live buffer", () => {
    const previous = build();
    const raw = diff();
    raw.hunks = [hunk(40, 42, ["-older", "+current"], "replacement section")];
    const refreshed = build([raw], { largeDiffThreshold: 0 });
    refreshed.adoptBuffer(previous.getPatchBuffer());
    previous.dispose();
    expect(refreshed.getFilePatches()[0].getHunkSummaries()).toEqual([
      {
        oldStartRow: 40,
        newStartRow: 42,
        oldRowCount: 1,
        newRowCount: 1,
        sectionHeading: "replacement section",
      },
    ]);
  });

  it("derives staged and unstaged summaries from transformed hunks and retains them when hidden", () => {
    const model = build();
    const [first, last] = model.getFilePatches()[0].getHunks();
    const staged = own(
      model.getStagePatchForLines(
        new Set([
          first.getChanges()[0].getStartBufferRow(),
          last.getChanges()[1].getStartBufferRow(),
        ]),
      ),
    );
    const unstaged = own(
      model.getUnstagePatchForLines(
        new Set([
          first.getChanges()[1].getStartBufferRow(),
          last.getChanges()[0].getStartBufferRow(),
        ]),
      ),
    );
    const stagedExpected = [
      { ...summaries()[0], newRowCount: 0 },
      { ...summaries()[1], newStartRow: 19, newRowCount: 2 },
    ];
    const unstagedExpected = [
      { ...summaries()[0], oldRowCount: 2, newRowCount: 1 },
      { ...summaries()[1], oldStartRow: 21, newStartRow: 20, newRowCount: 2 },
    ];
    for (const [transformed, expected] of [
      [staged, stagedExpected],
      [unstaged, unstagedExpected],
    ]) {
      const file = transformed.getFilePatches()[0];
      expect(file.getHunkSummaries()).toEqual(expected);
      transformed.collapseFilePatch(file);
      expect(file.getHunkSummaries()).toEqual(expected);
      transformed.expandFilePatch(file);
      expect(file.getHunkSummaries()).toEqual(expected);
    }
    expect(model.getFilePatches()[0].getHunkSummaries()).toEqual(summaries());
  });

  it("omits contentless, null and unavailable hunks while preserving present files", () => {
    const metadata = { ...diff("mode.txt"), newMode: "100755", hunks: [] };
    const model = build([metadata], { removed: new Set(["unavailable.txt"]) });
    for (const file of model.getFilePatches()) {
      expect(file.isPresent()).toBe(true);
      expect(file.getHunkSummaries()).toEqual([]);
    }
    const empty = own(buildFilePatch([])).getFilePatches()[0];
    expect(empty.isPresent()).toBe(false);
    expect(empty.getHunkSummaries()).toEqual([]);
  });

  it("lists only the content hunks of a deferred symlink type change", () => {
    const mode = {
      ...diff(),
      newPath: null,
      oldMode: "120000",
      newMode: null,
      status: "deleted",
      hunks: [hunk(1, 0, ["-target.txt"])],
    };
    const content = {
      ...diff(),
      oldPath: null,
      oldMode: null,
      status: "added",
      hunks: [hunk(0, 1, ["+first", "+second"], "new content")],
    };
    const expected = [
      {
        oldStartRow: 0,
        newStartRow: 1,
        oldRowCount: 0,
        newRowCount: 2,
        sectionHeading: "new content",
      },
    ];
    const model = build([mode, content], { largeDiffThreshold: 0 });
    const file = model.getFilePatches()[0];
    expect(model.getFilePatches()).toHaveSize(1);
    expect(file.getHunkSummaries()).toEqual(expected);
    expect(file.getHunks()).toEqual([]);
    model.expandFilePatch(file);
    expect(file.getHunkSummaries()).toEqual(expected);
  });
});
