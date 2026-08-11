/** @babel */

import ResolutionProgress, { keyForPath } from "../lib/models/conflicts/resolution-progress";

describe("ResolutionProgress", () => {
  it("requires persisted and open-buffer contents to be marker-free", () => {
    const progress = new ResolutionProgress();
    const filePath = "C:\\repo\\conflicted.txt";

    progress.reportDiskMarkerCount(filePath, 1);
    progress.reportBufferMarkerCount(filePath, 0, { modified: true });
    expect(progress.getStatus(filePath)).toEqual({
      ready: false,
      remaining: 1,
      reason: "conflicts",
    });

    progress.reportDiskMarkerCount(filePath, 0);
    expect(progress.getStatus(filePath)).toEqual({
      ready: false,
      remaining: 0,
      reason: "unsaved",
    });

    progress.reportBufferMarkerCount(filePath, 0, { modified: false });
    expect(progress.isStagingReady(filePath)).toBe(true);
  });

  it("falls back to persisted state when an editor closes", () => {
    const progress = new ResolutionProgress();
    const filePath = "C:\\repo\\conflicted.txt";
    progress.reportDiskMarkerCount(filePath, 0);
    progress.reportBufferMarkerCount(filePath, 2, { modified: true });

    progress.clearBuffer(filePath);

    expect(progress.getStatus(filePath)).toEqual({ ready: true, remaining: 0, reason: "ready" });
  });

  it("requires an explicit choice for marker-free conflicts", () => {
    const progress = new ResolutionProgress();
    const filePath = "binary.dat";
    progress.reportDiskMarkerCount(filePath, 0);

    expect(progress.getStatus(filePath)).toEqual({
      ready: false,
      remaining: 0,
      reason: "choice",
    });

    progress.markResolutionSelected(filePath);
    expect(progress.getStatus(filePath)).toEqual({ ready: true, remaining: 0, reason: "ready" });
  });

  it("prunes paths that are no longer unmerged", () => {
    const progress = new ResolutionProgress();
    progress.reportDiskMarkerCount("old.txt", 0);
    progress.reportDiskMarkerCount("current.txt", 1);

    progress.retainPaths(["current.txt"]);

    expect(progress.getStatus("old.txt").reason).toBe("calculating");
    expect(progress.getRemaining("current.txt")).toBe(1);
  });

  it("uses case-insensitive normalized path identity on Windows", () => {
    const mixed = keyForPath("C:\\Repo\\folder\\..\\FILE.txt");
    const canonical = keyForPath("C:\\Repo\\FILE.txt");
    expect(mixed).toBe(canonical);
    if (process.platform === "win32") {
      expect(keyForPath("C:\\REPO\\FILE.txt")).toBe(keyForPath("c:\\repo\\file.txt"));
    }
  });
});
