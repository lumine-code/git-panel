/** @babel */
import { diffWordsWithSpace } from "diff";

import { WORD_ADDITION_LAYER, WORD_DELETION_LAYER } from "./patch-buffer";

export function populateWordDiffs(patchBuffer, hunks) {
  return populateBoundedWordDiffs(patchBuffer, hunks);
}

export const WORD_DIFF_LIMITS = Object.freeze({
  maxLineCodeUnits: 256 * 1024,
  maxEditLength: 256,
  lineTimeoutMs: 8,
  populationBudgetMs: 50,
});

// `performance.now` measures real elapsed time even when test timers freeze Date.now.
export function populateBoundedWordDiffs(patchBuffer, hunks, options = {}) {
  const limits = { ...WORD_DIFF_LIMITS, ...options };
  const now = options.clock || (() => performance.now());
  const started = now();
  const stats = {
    pairedLines: 0,
    detailedPairs: 0,
    omittedPairs: 0,
    unchangedPairs: 0,
    reasons: { lineLength: 0, editOrTimeLimit: 0, populationBudget: 0 },
    elapsedMs: 0,
  };
  patchBuffer.wordDiffStats = stats;

  const buffer = patchBuffer.getBuffer();
  buffer.batchMarkerLayerUpdates(() => {
    patchBuffer.getLayer(WORD_DELETION_LAYER).clear();
    patchBuffer.getLayer(WORD_ADDITION_LAYER).clear();
    for (const hunk of hunks) {
      const hunkStarted = now();
      const hunkStats = {
        pairedLines: 0,
        detailedPairs: 0,
        omittedPairs: 0,
        unchangedPairs: 0,
        reasons: { lineLength: 0, editOrTimeLimit: 0, populationBudget: 0 },
        elapsedMs: 0,
      };
      hunk.wordDiffStats = hunkStats;
      const record = (result, count = 1) => {
        for (const summary of [stats, hunkStats]) {
          if (result === "unchanged") summary.unchangedPairs += count;
          else if (result === "detailed") summary.detailedPairs += count;
          else {
            summary.omittedPairs += count;
            summary.reasons[result] += count;
          }
        }
      };
      let pendingDeletionRows = [];

      for (const region of hunk.getRegions()) {
        if (region.isDeletion()) {
          pendingDeletionRows.push(...region.getBufferRows());
        } else if (region.isAddition()) {
          const additionRows = region.getBufferRows();
          const pairCount = Math.min(pendingDeletionRows.length, additionRows.length);
          stats.pairedLines += pairCount;
          hunkStats.pairedLines += pairCount;

          for (let i = 0; i < pairCount; i++) {
            const remaining = limits.populationBudgetMs - (now() - started);
            if (remaining <= 0) {
              record("populationBudget", pairCount - i);
              break;
            }
            const result = markWordDiffForRows(
              patchBuffer,
              buffer,
              pendingDeletionRows[i],
              additionRows[i],
              limits,
              remaining,
              now,
            );
            record(result);
          }

          pendingDeletionRows = [];
        } else {
          pendingDeletionRows = [];
        }
      }
      hunkStats.elapsedMs = now() - hunkStarted;
    }
  });
  stats.elapsedMs = now() - started;
  Object.freeze(stats.reasons);
  Object.freeze(stats);
  return stats;
}

function markWordDiffForRows(
  patchBuffer,
  buffer,
  deletionRow,
  additionRow,
  limits,
  remaining,
  now,
) {
  const deletionText = buffer.lineForRow(deletionRow);
  const additionText = buffer.lineForRow(additionRow);
  if (
    deletionText.length > limits.maxLineCodeUnits ||
    additionText.length > limits.maxLineCodeUnits
  )
    return "lineLength";
  // Repeated whitespace tokens can align across different word boundaries.
  // Keep a line that differs only in spacing out of the detailed highlights.
  if (deletionText.trim().replace(/\s+/g, " ") === additionText.trim().replace(/\s+/g, " ")) {
    return "unchanged";
  }
  // Whitespace-aware tokens preserve both source strings. diffWords may use
  // the added side's spacing in a common part, shifting the deleted columns.
  const lineStarted = now();
  const timeout = Math.min(limits.lineTimeoutMs, remaining);
  const changes = diffWordsWithSpace(deletionText, additionText, {
    timeout,
    maxEditLength: limits.maxEditLength,
  });
  if (!changes || now() - lineStarted > timeout) return "editOrTimeLimit";

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
  return "detailed";
}
