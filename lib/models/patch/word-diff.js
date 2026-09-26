/** @babel */
import { diffWords } from "diff";

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
  const changes = diffWords(deletionText, additionText);

  let deletionColumn = 0;
  let additionColumn = 0;

  for (const change of changes) {
    if (change.removed) {
      patchBuffer.markRange(
        WORD_DELETION_LAYER,
        [
          [deletionRow, deletionColumn],
          [deletionRow, deletionColumn + change.value.length],
        ],
        { invalidate: "never", exclusive: true },
      );
      deletionColumn += change.value.length;
    } else if (change.added) {
      patchBuffer.markRange(
        WORD_ADDITION_LAYER,
        [
          [additionRow, additionColumn],
          [additionRow, additionColumn + change.value.length],
        ],
        { invalidate: "never", exclusive: true },
      );
      additionColumn += change.value.length;
    } else {
      deletionColumn += change.value.length;
      additionColumn += change.value.length;
    }
  }
}
