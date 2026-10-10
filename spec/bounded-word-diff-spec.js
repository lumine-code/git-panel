/** @babel */
import { buildMultiFilePatch } from "../lib/models/patch";
import { populateBoundedWordDiffs, WORD_DIFF_LIMITS } from "../lib/models/patch/word-diff";

function replacement(oldLines, newLines) {
  return {
    oldPath: "example.txt",
    newPath: "example.txt",
    status: "modified",
    oldMode: "100644",
    newMode: "100644",
    hunks: [
      {
        oldStartLine: 1,
        newStartLine: 1,
        oldLineCount: oldLines.length,
        newLineCount: newLines.length,
        heading: "",
        lines: [...oldLines.map((line) => "-" + line), ...newLines.map((line) => "+" + line)],
      },
    ],
  };
}

describe("bounded detailed word highlighting", () => {
  const owned = [];
  afterEach(() => {
    while (owned.length) owned.pop().dispose();
  });
  const build = (raw, options) => {
    const model = buildMultiFilePatch([raw], { largeDiffThreshold: Infinity, ...options });
    owned.push(model);
    return model;
  };

  it("skips lines exceeding the UTF-16 code-unit ceiling without changing raw patch or staging coordinates", () => {
    const long = "a".repeat(WORD_DIFF_LIMITS.maxLineCodeUnits + 1);
    const raw = replacement([long], ["b" + long]);
    const model = build(raw, { preserveOriginal: true });
    const stats = model.getWordDiffStats();
    expect(stats.omittedPairs).toBe(1);
    expect(stats.reasons.lineLength).toBe(1);
    expect(model.getWordAdditionLayer().getMarkerCount()).toBe(0);
    expect(model.getAdditionLayer().getMarkerCount()).toBe(1);
    expect(model.getDeletionLayer().getMarkerCount()).toBe(1);
    expect(model.getFilePatches()[0].getRawContentPatch()).toBe(raw);
    const staged = model.getStagePatchForLines(new Set([0, 1]));
    owned.push(staged);
    expect(staged.toString().trimEnd()).toBe(model.toString().trimEnd());
    expect(model.getHunkAt(1).getNewRowAt(1)).toBe(1);
  });

  it("aborts structurally expensive edits even when Date timers are frozen", () => {
    const oldText = Array.from({ length: 512 }, (_, index) => `old${index}`).join(" ");
    const newText = Array.from({ length: 512 }, (_, index) => `new${index}`).join(" ");
    const model = build(replacement([oldText], [newText]));
    const raw = model.toString();
    const hunk = model.getFilePatches()[0].getHunks()[0];
    const stats = populateBoundedWordDiffs(model.getPatchBuffer(), [hunk], { clock: () => 0 });
    expect(stats.omittedPairs).toBe(1);
    expect(stats.reasons.editOrTimeLimit).toBe(1);
    expect(model.getWordAdditionLayer().getMarkerCount()).toBe(0);
    expect(model.toString()).toBe(raw);
  });

  it("uses a monotonic total budget and reports all remaining uncomputed pairs", () => {
    const model = build(replacement(Array(30).fill("before"), Array(30).fill("after")));
    const hunks = model.getFilePatches()[0].getHunks();
    let ticks = 0;
    const stats = populateBoundedWordDiffs(model.getPatchBuffer(), hunks, {
      clock: () => ticks++,
      lineTimeoutMs: 8,
      populationBudgetMs: 10,
    });
    expect(stats.pairedLines).toBe(30);
    expect(stats.detailedPairs).toBeGreaterThan(0);
    expect(stats.omittedPairs).toBeGreaterThan(0);
    expect(stats.reasons.populationBudget).toBe(stats.omittedPairs);
    expect(stats.detailedPairs + stats.omittedPairs + stats.unchangedPairs).toBe(30);
    expect(model.getAdditionLayer().getMarkerCount()).toBe(1);
  });

  it("keeps exact UTF-16 columns for normal emoji replacements", () => {
    const model = build(replacement(["😀 old value"], ["😀 new value"]));
    expect(model.getWordDiffStats().omittedPairs).toBe(0);
    const oldRange = model.getWordDeletionLayer().getMarkers()[0].getRange();
    const newRange = model.getWordAdditionLayer().getMarkers()[0].getRange();
    expect([oldRange.start.row, oldRange.start.column, oldRange.end.column]).toEqual([0, 3, 6]);
    expect([newRange.start.row, newRange.start.column, newRange.end.column]).toEqual([1, 3, 6]);
  });

  it("updates omission metadata after deferred expansion and removes it again after collapse", () => {
    const text = "a".repeat(WORD_DIFF_LIMITS.maxLineCodeUnits + 1);
    const model = build(replacement([text], ["b" + text]), { largeDiffThreshold: 0 });
    const file = model.getFilePatches()[0];
    expect(model.getWordDiffStats().omittedPairs).toBe(0);
    model.expandFilePatch(file);
    expect(model.getWordDiffStats().omittedPairs).toBe(1);
    model.collapseFilePatch(file);
    expect(model.getWordDiffStats().omittedPairs).toBe(0);
  });
});
