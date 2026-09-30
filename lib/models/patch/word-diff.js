/** @babel */
import { diffWordsWithSpace } from "diff";

import { WORD_ADDITION_LAYER, WORD_DELETION_LAYER } from "./patch-buffer";

export function populateWordDiffs(patchBuffer, hunks) {
  patchBuffer.getLayer(WORD_DELETION_LAYER).clear();
  patchBuffer.getLayer(WORD_ADDITION_LAYER).clear();

  const buffer = patchBuffer.getBuffer();
  for (const hunk of hunks) {
    let pendingDeletionRows = [];

    for (const region of hunk.getRegions()) {
      if (region.isDeletion()) {
        pendingDeletionRows.push(...region.getBufferRows());
      } else if (region.isAddition()) {
        const additionRows = region.getBufferRows();
        const pairCount = Math.min(pendingDeletionRows.length, additionRows.length);

        for (let i = 0; i < pairCount; i++) {
          markWordDiffForRows(patchBuffer, buffer, pendingDeletionRows[i], additionRows[i]);
        }

        pendingDeletionRows = [];
      } else {
        pendingDeletionRows = [];
      }
    }
  }
}

function markWordDiffForRows(patchBuffer, buffer, deletionRow, additionRow) {
  const deletionText = buffer.lineForRow(deletionRow);
  const additionText = buffer.lineForRow(additionRow);
  // Repeated whitespace tokens can align across different word boundaries.
  // Keep a line that differs only in spacing out of the detailed highlights.
  if (deletionText.trim().replace(/\s+/g, " ") === additionText.trim().replace(/\s+/g, " ")) {
    return;
  }
  // Whitespace-aware tokens preserve both source strings. diffWords may use
  // the added side's spacing in a common part, shifting the deleted columns.
  const changes = diffWordsWithSpace(deletionText, additionText);

  let deletionColumn = 0;
  let additionColumn = 0;

  for (const change of changes) {
    if (change.removed) {
      if (/\S/.test(change.value)) {
        patchBuffer.markRange(
          WORD_DELETION_LAYER,
          [
            [deletionRow, deletionColumn],
            [deletionRow, deletionColumn + change.value.length],
          ],
          { invalidate: "never", exclusive: true },
        );
      }
      deletionColumn += change.value.length;
    } else if (change.added) {
      if (/\S/.test(change.value)) {
        patchBuffer.markRange(
          WORD_ADDITION_LAYER,
          [
            [additionRow, additionColumn],
            [additionRow, additionColumn + change.value.length],
          ],
          { invalidate: "never", exclusive: true },
        );
      }
      additionColumn += change.value.length;
    } else {
      deletionColumn += change.value.length;
      additionColumn += change.value.length;
    }
  }
}
