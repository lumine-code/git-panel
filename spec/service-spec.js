const { provideDiff } = require("../lib/index");

describe("native patch rendering service", () => {
  it("builds structured snapshots without parsing or reading a repository", () => {
    const service = provideDiff();
    const parse = spyOn(service, "parseDiff").and.callThrough();
    const execute = spyOn(lumine.repositories, "executeGit");
    const patch = service.buildPatch({
      files: [
        {
          status: "modified",
          oldPath: "example.txt",
          newPath: "example.txt",
          oldMode: "100644",
          newMode: "100644",
          hunks: [
            {
              oldStartLine: 1,
              oldLineCount: 1,
              newStartLine: 1,
              newLineCount: 1,
              heading: "",
              lines: [
                { kind: "deleted", text: "before" },
                { kind: "added", text: "after" },
              ],
            },
          ],
        },
      ],
      rawPatch: "This raw representation must never be parsed.",
    });
    try {
      expect(patch.toString()).toContain("-before\n+after");
      expect(parse).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    } finally {
      patch.dispose();
    }
  });
  it("builds raw external snapshots without opening the Git panel", () => {
    const service = provideDiff();
    const rawPatch =
      "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-before\n+after\n";
    const patch = service.buildPatch({ rawPatch });
    try {
      expect(patch.getFilePatches()[0].getPath()).toBe("a.txt");
      expect(patch.toString()).toContain("-before\n+after");
    } finally {
      patch.dispose();
    }
  });
});
