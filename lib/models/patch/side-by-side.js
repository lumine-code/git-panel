/** @babel */

// Display rows are a projection of the selectable patch rows. The patch itself
// remains the source of truth for staging, discarding and source positions.
export default function buildSideBySidePatch(multiFilePatch) {
  const rows = [];
  const fileRanges = new Map();
  const hunkRanges = new Map();
  const patchRowToDisplayRow = new Map();
  const oldLines = [];
  const newLines = [];
  const buffer = multiFilePatch.getBuffer();

  const append = (filePatch, hunk, oldEntry = null, newEntry = null) => {
    const displayRow = rows.length;
    const oldRow = oldEntry?.row ?? null;
    const newRow = newEntry?.row ?? null;
    rows.push({
      oldRow,
      newRow,
      oldLineNumber: oldEntry?.lineNumber ?? null,
      newLineNumber: newEntry?.lineNumber ?? null,
      oldType: oldEntry?.type ?? null,
      newType: newEntry?.type ?? null,
      filePatch,
      hunk,
    });
    oldLines.push(oldRow === null ? "" : buffer.lineForRow(oldRow));
    newLines.push(newRow === null ? "" : buffer.lineForRow(newRow));
    if (oldRow !== null) patchRowToDisplayRow.set(oldRow, displayRow);
    if (newRow !== null) patchRowToDisplayRow.set(newRow, displayRow);
  };

  for (const filePatch of multiFilePatch.getFilePatches()) {
    const fileStart = rows.length;
    const hunks = filePatch.getRenderStatus().isVisible() ? filePatch.getHunks() : [];

    for (const hunk of hunks) {
      const hunkStart = rows.length;
      let oldLineNumber = hunk.getOldStartRow();
      let newLineNumber = hunk.getNewStartRow();
      let deletions = [];
      let additions = [];
      let precedingEntry = null;
      let precedingType = null;

      const flushChanges = () => {
        const count = Math.max(deletions.length, additions.length);
        for (let index = 0; index < count; index++) {
          const oldEntry = deletions[index] ?? null;
          const newEntry = additions[index] ?? null;
          append(filePatch, hunk, oldEntry, newEntry);
          // A marker between deleted and added runs must not prevent their
          // actual content rows from lining up with one another.
          const oldMarkers = oldEntry?.noNewlineRows ?? [];
          const newMarkers = newEntry?.noNewlineRows ?? [];
          const markerCount = Math.max(oldMarkers.length, newMarkers.length);
          for (let markerIndex = 0; markerIndex < markerCount; markerIndex++) {
            const oldRow = oldMarkers[markerIndex];
            const newRow = newMarkers[markerIndex];
            append(
              filePatch,
              hunk,
              oldRow === undefined ? null : { row: oldRow, type: "nonewline" },
              newRow === undefined ? null : { row: newRow, type: "nonewline" },
            );
          }
        }
        deletions = [];
        additions = [];
      };

      for (const region of hunk.getRegions()) {
        const range = region.getRange();
        for (let row = range.start.row; row <= range.end.row; row++) {
          if (region.isDeletion()) {
            if (additions.length > 0) flushChanges();
            precedingEntry = { row, lineNumber: oldLineNumber++, type: "deleted" };
            deletions.push(precedingEntry);
            precedingType = "deleted";
          } else if (region.isAddition()) {
            precedingEntry = { row, lineNumber: newLineNumber++, type: "added" };
            additions.push(precedingEntry);
            precedingType = "added";
          } else if (region.isNoNewline()) {
            if (precedingType === "deleted" || precedingType === "added") {
              if (!precedingEntry.noNewlineRows) precedingEntry.noNewlineRows = [];
              precedingEntry.noNewlineRows.push(row);
            } else {
              const marker = { row, type: "nonewline" };
              append(filePatch, hunk, marker, marker);
            }
          } else if (region.isUnchanged()) {
            flushChanges();
            append(
              filePatch,
              hunk,
              { row, lineNumber: oldLineNumber++, type: "unchanged" },
              { row, lineNumber: newLineNumber++, type: "unchanged" },
            );
            precedingEntry = null;
            precedingType = "unchanged";
          }
        }
      }

      flushChanges();
      if (rows.length > hunkStart) hunkRanges.set(hunk, [hunkStart, rows.length - 1]);
    }

    // Metadata-only and collapsed files still need a display row for the
    // file header and any load-diff gate to attach to.
    if (rows.length === fileStart) append(filePatch, null);
    fileRanges.set(filePatch, [fileStart, rows.length - 1]);
  }

  return {
    rows,
    fileRanges,
    hunkRanges,
    oldText: oldLines.join("\n"),
    newText: newLines.join("\n"),
    patchRowToDisplayRow,
  };
}
