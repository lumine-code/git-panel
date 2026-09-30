/** @babel */
import { buildMultiFilePatch } from "../lib/models/patch";
import { COLLAPSED } from "../lib/models/patch/patch";

function replacement() {
  return {
    status: "modified",
    oldPath: "example.js",
    newPath: "example.js",
    oldMode: "100644",
    newMode: "100644",
    hunks: [
      {
        oldStartLine: 1,
        oldLineCount: 1,
        newStartLine: 1,
        newLineCount: 1,
        heading: "",
        lines: ["-old", "+new"],
      },
    ],
  };
}

describe("preserved original file patches", () => {
  let multiFilePatch;

  afterEach(() => multiFilePatch?.getBuffer().destroy());

  it("retains a deferred PR patch's original rows through expansion and collapse", () => {
    const raw = replacement();
    multiFilePatch = buildMultiFilePatch([raw], {
      preserveOriginal: true,
      largeDiffThreshold: 0,
    });
    const filePatch = multiFilePatch.getPatchForPath("example.js");
    expect(filePatch.getRenderStatus().isVisible()).toBe(false);

    multiFilePatch.expandFilePatch(filePatch);
    expect(filePatch.getRawContentPatch()).toBe(raw);
    expect(filePatch.getRawContentPatch().hunks[0].lines).toEqual(["-old", "+new"]);

    multiFilePatch.collapseFilePatch(filePatch);
    multiFilePatch.expandFilePatch(filePatch);
    expect(filePatch.getRawContentPatch()).toBe(raw);
  });

  it("retains a paired symlink and content change when its deferred patch is expanded", () => {
    const mode = {
      status: "deleted",
      oldPath: "example.js",
      newPath: null,
      oldMode: "120000",
      newMode: null,
      hunks: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 0,
          newLines: 0,
          lines: [{ kind: "deleted", text: "target.js" }],
        },
      ],
    };
    const content = {
      status: "added",
      oldPath: null,
      newPath: "example.js",
      oldMode: null,
      newMode: "100644",
      hunks: [
        {
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: 1,
          lines: [{ kind: "added", text: "new content" }],
        },
      ],
    };
    multiFilePatch = buildMultiFilePatch([mode, content], {
      preserveOriginal: true,
      largeDiffThreshold: 0,
    });
    const filePatch = multiFilePatch.getPatchForPath("example.js");

    multiFilePatch.expandFilePatch(filePatch);
    expect(filePatch.getRawContentPatch()).toBe(content);
    expect(filePatch.rawPatches.mode).toBe(mode);
  });

  it("retains original rows when the initial render status explicitly collapses a file", () => {
    const raw = replacement();
    multiFilePatch = buildMultiFilePatch([raw], {
      preserveOriginal: true,
      renderStatusOverrides: { "example.js": COLLAPSED },
    });
    const filePatch = multiFilePatch.getPatchForPath("example.js");

    multiFilePatch.expandFilePatch(filePatch);
    expect(filePatch.getRawContentPatch()).toBe(raw);
  });
});
