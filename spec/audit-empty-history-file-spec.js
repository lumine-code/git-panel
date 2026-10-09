/** @babel */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import DiscardHistory from "../lib/models/discard-history";

async function removeOwnedScratch(temporaryRoot, scratch) {
  const relative = path.relative(temporaryRoot, scratch);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error("Unsafe scratch cleanup target");
  await fs.rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

describe("Discard history private empty merge base", () => {
  it("preserves an unrelated existing temporary file while supplying an empty merge base", async () => {
    for (const name of ["openPath", "openExternal", "openApplication", "showItemInFolder"])
      spyOn(lumine.shell, name).and.resolveTo();
    const temporaryRoot = await fs.realpath(os.tmpdir());
    const scratch = await fs.realpath(await fs.mkdtemp(path.join(temporaryRoot, "empty-history-")));
    const sentinel = path.join(temporaryRoot, "empty-file.txt");
    // The isolated runner seeds this owned TEMP file before loading production.
    // This spec never seeds it after the import, which would hide the overwrite.
    try {
      await fs.writeFile(path.join(scratch, "exists.txt"), "current bytes\n");
      const before = path.join(scratch, "before.txt");
      await fs.writeFile(before, "discarded bytes\n");
      let mergeBase;
      const history = new DiscardHistory(
        async () => "controlled-current-sha",
        async (file) => file,
        async (_file, base) => {
          mergeBase = base;
          expect(await fs.readFile(base, "utf8")).toBe("");
          return { conflict: false };
        },
        scratch,
      );
      await history.mergeFiles([
        {
          filePath: "exists.txt",
          theirsPath: before,
          commonBasePath: null,
          resultPath: path.join(scratch, "result.txt"),
        },
      ]);
      if (process.env.LUMINE_GIT_PANEL_TEST_SENTINEL === "1")
        expect(await fs.readFile(sentinel, "utf8")).toBe("Owned audit sentinel.\n");
      expect(mergeBase).not.toBe(sentinel);
      const baseRelative = path.relative(scratch, mergeBase);
      expect(
        baseRelative === ".." ||
          baseRelative.startsWith(`..${path.sep}`) ||
          path.isAbsolute(baseRelative),
      ).toBe(false);
    } finally {
      await removeOwnedScratch(temporaryRoot, scratch);
    }
  });
});
