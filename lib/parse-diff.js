/** @babel */
import { parsePatch } from "diff";

export function parseDiff(rawDiffStr) {
  if (!rawDiffStr.trim()) return [];
  const headingRegex = /^@@[^@]*@@[ \t]*(.*)/gm;
  const headings = [];
  let m;
  while ((m = headingRegex.exec(rawDiffStr)) !== null) {
    headings.push(m[1].trimEnd());
  }

  let headingIdx = 0;
  return parsePatch(rawDiffStr).map((patch) => {
    let status;
    if (patch.isCreate) status = "added";
    else if (patch.isDelete) status = "deleted";
    else if (patch.isRename) status = "renamed";
    else status = "modified";

    const normalizePath = (p) => (!p || p === "/dev/null" ? null : p.replace(/^[ab]\//, ""));

    return {
      status,
      oldPath: normalizePath(patch.oldFileName),
      newPath: normalizePath(patch.newFileName),
      oldMode: patch.oldMode || null,
      newMode: patch.newMode || null,
      hunks: (patch.hunks || []).map((hunk) => ({
        oldStartLine: hunk.oldStart,
        oldLineCount: hunk.oldLines,
        newStartLine: hunk.newStart,
        newLineCount: hunk.newLines,
        heading: headings[headingIdx++] || "",
        lines: hunk.lines,
      })),
    };
  });
}
