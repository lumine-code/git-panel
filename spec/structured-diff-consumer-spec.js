/** @babel */

import { buildFilePatch } from "../lib/models/patch";

describe("structured repository diffs", () => {
  function typechange(oldMode, newMode, lines) {
    return {
      oldPath: "a.txt",
      newPath: "a.txt",
      oldMode,
      newMode,
      status: "modified",
      hunks: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          heading: null,
          lines,
        },
      ],
    };
  }

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

  it("takes a new symlink target from the added structured line", () => {
    const patch = buildFilePatch([
      typechange("100644", "120000", [
        { kind: "deleted", text: "regular contents" },
        { kind: "added", text: "new-target" },
      ]),
    ]).getFilePatches()[0];

    expect(patch.getOldSymlink()).toBeNull();
    expect(patch.getNewSymlink()).toBe("new-target");
  });

  it("takes an old symlink target from the deleted structured line", () => {
    const patch = buildFilePatch([
      typechange("120000", "100644", [
        { kind: "deleted", text: "old-target" },
        { kind: "added", text: "regular contents" },
      ]),
    ]).getFilePatches()[0];

    expect(patch.getOldSymlink()).toBe("old-target");
    expect(patch.getNewSymlink()).toBeNull();
  });
});
