/** @babel */
import { Range, Disposable } from "lumine";
import { RBTree } from "bintrees";

import PatchBuffer, { WORD_ADDITION_LAYER, WORD_DELETION_LAYER } from "./patch-buffer";
import { populateWordDiffs } from "./word-diff";

export default class MultiFilePatch {
  static createNull() {
    return new this({ patchBuffer: new PatchBuffer(), filePatches: [] });
  }

  constructor({ patchBuffer, filePatches, populateWords = true }) {
    this.patchBuffer = patchBuffer;
    this.filePatches = filePatches;
    this.references = 1;
    this.creationOwnerReleased = false;
    this.bufferLease = patchBuffer.acquire();
    this.filePatchLeases = [];

    this.filePatchesByMarker = new Map();
    this.filePatchesByPath = new Map();
    this.hunksByMarker = new Map();

    // Store a map of {diffRow, offset} for each FilePatch where offset is the number of Hunk headers within the current
    // FilePatch that occur before this row in the original diff output.
    this.diffRowOffsetIndices = new Map();

    try {
      for (const filePatch of this.filePatches) this.filePatchLeases.push(filePatch.acquire());
      if (populateWords)
        populateWordDiffs(
          this.patchBuffer,
          this.filePatches.flatMap((filePatch) => filePatch.getHunks()),
        );
      for (const filePatch of this.filePatches) {
        this.filePatchesByPath.set(filePatch.getPath(), filePatch);
        this.filePatchesByMarker.set(filePatch.getMarker(), filePatch);

        this.populateDiffRowOffsetIndices(filePatch);
      }
      this.refreshWordDiffStats();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  retain() {
    if (this.isDisposed()) throw new Error("Cannot retain a disposed multi-file patch");
    this.references++;
    return new Disposable(() => this.releaseReference());
  }

  dispose() {
    if (this.creationOwnerReleased) return;
    this.creationOwnerReleased = true;
    this.releaseReference();
  }

  isDisposed() {
    return this.references === 0;
  }

  releaseReference() {
    if (this.references === 0 || --this.references !== 0) return;
    for (const lease of this.filePatchLeases) lease.dispose();
    this.filePatchLeases = [];
    this.bufferLease.dispose();
    this.filePatches = [];
    this.filePatchesByMarker.clear();
    this.filePatchesByPath.clear();
    this.hunksByMarker.clear();
    this.diffRowOffsetIndices.clear();
  }

  clone(opts = {}) {
    if (this.isDisposed()) throw new Error("Cannot clone a disposed multi-file patch");
    if (opts.patchBuffer && opts.patchBuffer !== this.patchBuffer) {
      return new this.constructor({
        patchBuffer: opts.patchBuffer,
        filePatches:
          opts.filePatches ?? this.getFilePatches().map((filePatch) => filePatch.clone()),
      });
    }
    // View snapshots can collapse and adopt independently of the cache and other panes.
    const { patchBuffer, markerMap } = this.patchBuffer.createSubBuffer([
      [0, 0],
      this.getBuffer().getEndPosition(),
    ]);
    const filePatches = [];
    try {
      for (const original of opts.filePatches ?? this.getFilePatches()) {
        const filePatch = original.clone();
        filePatches.push(filePatch);
        filePatch.updateMarkers(markerMap);
      }
      return new this.constructor({
        patchBuffer,
        filePatches,
        populateWords: opts.filePatches !== undefined,
      });
    } finally {
      for (const filePatch of filePatches) filePatch.dispose();
      patchBuffer.dispose();
    }
  }

  getPatchBuffer() {
    return this.patchBuffer;
  }

  getBuffer() {
    return this.getPatchBuffer().getBuffer();
  }

  getWordDiffStats() {
    return this.patchBuffer.getWordDiffStats();
  }

  refreshWordDiffStats() {
    const summaries = this.filePatches.flatMap((file) =>
      file
        .getHunks()
        .map((hunk) => hunk.wordDiffStats)
        .filter(Boolean),
    );
    const stats = {
      pairedLines: 0,
      detailedPairs: 0,
      omittedPairs: 0,
      unchangedPairs: 0,
      reasons: { lineLength: 0, editOrTimeLimit: 0, populationBudget: 0 },
      elapsedMs: 0,
    };
    for (const summary of summaries) {
      for (const key of [
        "pairedLines",
        "detailedPairs",
        "omittedPairs",
        "unchangedPairs",
        "elapsedMs",
      ])
        stats[key] += summary[key];
      for (const key of Object.keys(stats.reasons)) stats.reasons[key] += summary.reasons[key];
    }
    this.patchBuffer.wordDiffStats = stats;
  }

  getPatchLayer() {
    return this.getPatchBuffer().getLayer("patch");
  }

  getHunkLayer() {
    return this.getPatchBuffer().getLayer("hunk");
  }

  getUnchangedLayer() {
    return this.getPatchBuffer().getLayer("unchanged");
  }

  getAdditionLayer() {
    return this.getPatchBuffer().getLayer("addition");
  }

  getDeletionLayer() {
    return this.getPatchBuffer().getLayer("deletion");
  }

  getWordAdditionLayer() {
    return this.getPatchBuffer().getLayer(WORD_ADDITION_LAYER);
  }

  getWordDeletionLayer() {
    return this.getPatchBuffer().getLayer(WORD_DELETION_LAYER);
  }

  getNoNewlineLayer() {
    return this.getPatchBuffer().getLayer("nonewline");
  }

  getFilePatches() {
    return this.filePatches;
  }

  getPatchForPath(path) {
    return this.filePatchesByPath.get(path);
  }

  getPathSet() {
    return this.getFilePatches().reduce((pathSet, filePatch) => {
      for (const file of [filePatch.getOldFile(), filePatch.getNewFile()]) {
        if (file.isPresent()) {
          pathSet.add(file.getPath());
        }
      }
      return pathSet;
    }, new Set());
  }

  getFilePatchAt(bufferRow) {
    if (bufferRow < 0 || bufferRow > this.patchBuffer.getBuffer().getLastRow()) {
      return undefined;
    }
    const [marker] = this.patchBuffer.findMarkers("patch", { intersectsRow: bufferRow });
    return this.filePatchesByMarker.get(marker);
  }

  getHunkAt(bufferRow) {
    if (bufferRow < 0) {
      return undefined;
    }
    const [marker] = this.patchBuffer.findMarkers("hunk", { intersectsRow: bufferRow });
    return this.hunksByMarker.get(marker);
  }

  getStagePatchForLines(selectedLineSet) {
    const nextPatchBuffer = new PatchBuffer();
    try {
      const nextFilePatches = this.getFilePatchesContaining(selectedLineSet).map((fp) => {
        return fp.buildStagePatchForLines(this.getBuffer(), nextPatchBuffer, selectedLineSet);
      });
      return this.clone({ patchBuffer: nextPatchBuffer, filePatches: nextFilePatches });
    } finally {
      nextPatchBuffer.dispose();
    }
  }

  getStagePatchForHunk(hunk) {
    return this.getStagePatchForLines(new Set(hunk.getBufferRows()));
  }

  getUnstagePatchForLines(selectedLineSet) {
    const nextPatchBuffer = new PatchBuffer();
    try {
      const nextFilePatches = this.getFilePatchesContaining(selectedLineSet).map((fp) => {
        return fp.buildUnstagePatchForLines(this.getBuffer(), nextPatchBuffer, selectedLineSet);
      });
      return this.clone({ patchBuffer: nextPatchBuffer, filePatches: nextFilePatches });
    } finally {
      nextPatchBuffer.dispose();
    }
  }

  getUnstagePatchForHunk(hunk) {
    return this.getUnstagePatchForLines(new Set(hunk.getBufferRows()));
  }

  getMaxSelectionIndex(selectedRows) {
    if (selectedRows.size === 0) {
      return 0;
    }

    let lastMax = -Infinity;
    for (const row of selectedRows) lastMax = Math.max(lastMax, row);

    let selectionIndex = 0;
    // counts unselected lines in changed regions from the old patch
    // until we get to the bottom-most selected line from the old patch (lastMax).
    patchLoop: for (const filePatch of this.getFilePatches()) {
      for (const hunk of filePatch.getHunks()) {
        for (const change of hunk.getChanges()) {
          for (const { intersection, gap } of change.intersectRows(selectedRows, true)) {
            // Only include a partial range if this intersection includes the last selected buffer row.
            const includesMax = intersection.intersectsRow(lastMax);
            const delta = includesMax
              ? lastMax - intersection.start.row + 1
              : intersection.getRowCount();

            if (gap) {
              // Range of unselected changes.
              selectionIndex += delta;
            }

            if (includesMax) {
              break patchLoop;
            }
          }
        }
      }
    }

    return selectionIndex;
  }

  getSelectionRangeForIndex(selectionIndex) {
    // Iterate over changed lines in this patch in order to find the
    // new row to be selected based on the last selection index.
    // As we walk through the changed lines, we whittle down the
    // remaining lines until we reach the row that corresponds to the
    // last selected index.

    let selectionRow = 0;
    let remainingChangedLines = selectionIndex;

    let foundRow = false;
    let lastChangedRow = 0;

    patchLoop: for (const filePatch of this.getFilePatches()) {
      for (const hunk of filePatch.getHunks()) {
        for (const change of hunk.getChanges()) {
          if (remainingChangedLines < change.bufferRowCount()) {
            selectionRow = change.getStartBufferRow() + remainingChangedLines;
            foundRow = true;
            break patchLoop;
          } else {
            remainingChangedLines -= change.bufferRowCount();
            lastChangedRow = change.getEndBufferRow();
          }
        }
      }
    }

    // If we never got to the last selected index, that means it is
    // no longer present in the new patch (ie. we staged the last line of the file).
    // In this case we want the next selected line to be the last changed row in the file
    if (!foundRow) {
      selectionRow = lastChangedRow;
    }

    return Range.fromObject([
      [selectionRow, 0],
      [selectionRow, Infinity],
    ]);
  }

  isDiffRowOffsetIndexEmpty(filePatchPath) {
    const diffRowOffsetIndex = this.diffRowOffsetIndices.get(filePatchPath);
    return diffRowOffsetIndex.index.size === 0;
  }

  populateDiffRowOffsetIndices(filePatch) {
    let diffRow = 1;
    const index = new RBTree((a, b) => a.diffRow - b.diffRow);
    this.diffRowOffsetIndices.set(filePatch.getPath(), {
      startBufferRow: filePatch.getStartRange().start.row,
      index,
    });

    for (let hunkIndex = 0; hunkIndex < filePatch.getHunks().length; hunkIndex++) {
      const hunk = filePatch.getHunks()[hunkIndex];
      this.hunksByMarker.set(hunk.getMarker(), hunk);

      // Advance past the hunk body
      diffRow += hunk.bufferRowCount();
      index.insert({ diffRow, offset: hunkIndex + 1 });

      // Advance past the next hunk header
      diffRow++;
    }
  }

  adoptBuffer(nextPatchBuffer) {
    if (this.isDisposed()) throw new Error("Cannot adopt into a disposed multi-file patch");
    if (nextPatchBuffer === this.patchBuffer) return;
    const nextLease = nextPatchBuffer.acquire();
    let markerMap;
    try {
      markerMap = nextPatchBuffer.adopt(this.patchBuffer);
    } catch (error) {
      nextLease.dispose();
      throw error;
    }

    this.filePatchesByMarker.clear();
    this.hunksByMarker.clear();

    for (const filePatch of this.getFilePatches()) {
      filePatch.updateMarkers(markerMap);
      this.filePatchesByMarker.set(filePatch.getMarker(), filePatch);

      for (const hunk of filePatch.getHunks()) {
        this.hunksByMarker.set(hunk.getMarker(), hunk);
      }
    }

    const previousLease = this.bufferLease;
    this.patchBuffer = nextPatchBuffer;
    this.bufferLease = nextLease;
    previousLease.dispose();
  }

  /*
   * Efficiently locate the FilePatch instances that contain at least one row from a Set.
   */
  getFilePatchesContaining(rowSet) {
    const sortedRowSet = Array.from(rowSet);
    sortedRowSet.sort((a, b) => a - b);

    const filePatches = [];
    let lastFilePatch = null;
    for (const row of sortedRowSet) {
      // Because the rows are sorted, consecutive rows will almost certainly belong to the same patch, so we can save
      // many avoidable marker index lookups by comparing with the last.
      if (lastFilePatch && lastFilePatch.containsRow(row)) {
        continue;
      }

      lastFilePatch = this.getFilePatchAt(row);
      filePatches.push(lastFilePatch);
    }

    return filePatches;
  }

  anyPresent() {
    return this.patchBuffer !== null && this.filePatches.some((fp) => fp.isPresent());
  }

  didAnyChangeExecutableMode() {
    for (const filePatch of this.getFilePatches()) {
      if (filePatch.didChangeExecutableMode()) {
        return true;
      }
    }
    return false;
  }

  anyHaveTypechange() {
    return this.getFilePatches().some((fp) => fp.hasTypechange());
  }

  getMaxLineNumberWidth() {
    return this.getFilePatches().reduce((maxWidth, filePatch) => {
      const width = filePatch.getMaxLineNumberWidth();
      return maxWidth >= width ? maxWidth : width;
    }, 0);
  }

  spansMultipleFiles(rows) {
    let lastFilePatch = null;
    for (const row of rows) {
      if (lastFilePatch) {
        if (lastFilePatch.containsRow(row)) {
          continue;
        }

        return true;
      } else {
        lastFilePatch = this.getFilePatchAt(row);
      }
    }
    return false;
  }

  collapseFilePatch(filePatch) {
    const index = this.filePatches.indexOf(filePatch);

    this.filePatchesByMarker.delete(filePatch.getMarker());
    for (const hunk of filePatch.getHunks()) {
      this.hunksByMarker.delete(hunk.getMarker());
    }

    const before = this.getMarkersBefore(index);
    const after = this.getMarkersAfter(index);

    filePatch.triggerCollapseIn(this.patchBuffer, { before, after });
    this.refreshWordDiffStats();

    this.filePatchesByMarker.set(filePatch.getMarker(), filePatch);

    // This hunk collection should be empty, but let's iterate anyway just in case filePatch was already collapsed
    /* istanbul ignore next */
    for (const hunk of filePatch.getHunks()) {
      this.hunksByMarker.set(hunk.getMarker(), hunk);
    }
  }

  expandFilePatch(filePatch) {
    const index = this.filePatches.indexOf(filePatch);

    this.filePatchesByMarker.delete(filePatch.getMarker());
    for (const hunk of filePatch.getHunks()) {
      this.hunksByMarker.delete(hunk.getMarker());
    }

    const before = this.getMarkersBefore(index);
    const after = this.getMarkersAfter(index);

    filePatch.triggerExpandIn(this.patchBuffer, { before, after });
    this.refreshWordDiffStats();

    this.filePatchesByMarker.set(filePatch.getMarker(), filePatch);
    for (const hunk of filePatch.getHunks()) {
      this.hunksByMarker.set(hunk.getMarker(), hunk);
    }

    // if the patch was initially collapsed, we need to calculate
    // the diffRowOffsetIndices to calculate comment position.
    if (this.isDiffRowOffsetIndexEmpty(filePatch.getPath())) {
      this.populateDiffRowOffsetIndices(filePatch);
    }
  }

  getMarkersBefore(filePatchIndex) {
    const before = [];
    let beforeIndex = filePatchIndex - 1;
    while (beforeIndex >= 0) {
      const beforeFilePatch = this.filePatches[beforeIndex];
      before.push(...beforeFilePatch.getEndingMarkers());

      if (!beforeFilePatch.getMarker().getRange().isEmpty()) {
        break;
      }
      beforeIndex--;
    }
    return before;
  }

  getMarkersAfter(filePatchIndex) {
    const after = [];
    let afterIndex = filePatchIndex + 1;
    while (afterIndex < this.filePatches.length) {
      const afterFilePatch = this.filePatches[afterIndex];
      after.push(...afterFilePatch.getStartingMarkers());

      if (!afterFilePatch.getMarker().getRange().isEmpty()) {
        break;
      }
      afterIndex++;
    }
    return after;
  }

  isPatchVisible = (filePatchPath) => {
    const patch = this.filePatchesByPath.get(filePatchPath);
    if (!patch) {
      return false;
    }
    return patch.getRenderStatus().isVisible();
  };

  getBufferRowForDiffPosition = (fileName, diffRow) => {
    const offsetIndex = this.diffRowOffsetIndices.get(fileName);
    if (!offsetIndex) {
      console.error("Attempt to compute buffer row for invalid diff position: file not included", {
        fileName,
        diffRow,
        validFileNames: Array.from(this.diffRowOffsetIndices.keys()),
      });
      return null;
    }
    const { startBufferRow, index } = offsetIndex;

    const result = index.lowerBound({ diffRow }).data();
    if (!result) {
      console.error(
        "Attempt to compute buffer row for invalid diff position: diff row out of range",
        {
          fileName,
          diffRow,
        },
      );
      return null;
    }
    const { offset } = result;

    return startBufferRow + diffRow - offset;
  };

  getPreviewPatchBuffer(fileName, diffRow, maxRowCount) {
    const bufferRow = this.getBufferRowForDiffPosition(fileName, diffRow);
    if (bufferRow === null) {
      return new PatchBuffer();
    }

    const filePatch = this.getFilePatchAt(bufferRow);
    const filePatchIndex = this.filePatches.indexOf(filePatch);
    const hunk = this.getHunkAt(bufferRow);

    const previewStartRow = Math.max(bufferRow - maxRowCount + 1, hunk.getRange().start.row);
    const previewEndRow = bufferRow;

    const before = this.getMarkersBefore(filePatchIndex);
    const after = this.getMarkersAfter(filePatchIndex);
    const exclude = new Set([...before, ...after]);

    return this.patchBuffer.createSubBuffer(
      [
        [previewStartRow, 0],
        [previewEndRow, Infinity],
      ],
      { exclude },
    ).patchBuffer;
  }

  /*
   * Construct an apply-able patch String.
   */
  toString() {
    return this.filePatches.map((fp) => fp.toStringIn(this.getBuffer())).join("") + "\n";
  }

  /*
   * Construct a string of diagnostic information useful for debugging.
   */
  /* istanbul ignore next */
  inspect() {
    let inspectString = "(MultiFilePatch";
    inspectString += ` filePatchesByMarker=(${Array.from(this.filePatchesByMarker.keys(), (m) => m.id).join(", ")})`;
    inspectString += ` hunksByMarker=(${Array.from(this.hunksByMarker.keys(), (m) => m.id).join(", ")})\n`;
    for (const filePatch of this.filePatches) {
      inspectString += filePatch.inspect({ indent: 2 });
    }
    inspectString += ")\n";
    return inspectString;
  }

  /* istanbul ignore next */
  isEqual(other) {
    return this.toString() === other.toString();
  }
}
