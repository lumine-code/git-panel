/** @babel */

import { buildFilePatch } from "../lib/models/patch";

describe("structured repository diffs", () => {
  it("builds and serializes selectable patches from structured lines", () => {
    const multiFilePatch = buildFilePatch([
      {
        oldPath: "a.txt",
        newPath: "a.txt",
        oldMode: "100644",
        newMode: "100644",
        status: "modified",
        hunks: [
          {
            oldStart: 1,
            oldLines: 2,
            newStart: 1,
            newLines: 2,
            heading: null,
            lines: [
              { kind: "context", text: "same" },
              { kind: "deleted", text: "before" },
              { kind: "added", text: "after" },
              { kind: "nonewline", text: "" },
            ],
          },
        ],
      },
    ]);

    const serialized = multiFilePatch.toString();
    expect(serialized).toContain("-before\n+after\n\\ No newline at end of file");
    const hunk = multiFilePatch.getFilePatches()[0].getHunks()[0];
    expect(multiFilePatch.getStagePatchForHunk(hunk).toString()).toContain("+after");
  });
});
