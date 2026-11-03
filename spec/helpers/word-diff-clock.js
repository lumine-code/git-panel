/** @babel */
import { populateBoundedWordDiffs, wordDiff } from "../../lib/models/patch/word-diff.js";

// Semantic marker tests exercise the real diff algorithm independently of host
// scheduling. Budget/omission behavior has its own controlled-clock suite.
export function useDeterministicWordDiffClock() {
  spyOn(wordDiff, "populateWordDiffs").and.callFake((patchBuffer, hunks) =>
    withDiffDateClock(() => populateBoundedWordDiffs(patchBuffer, hunks, { clock: () => 0 })),
  );
}

export function withDiffDateClock(callback) {
  const dateNow = Date.now;
  try {
    // jsdiff uses Date.now internally; the outer monotonic clock is injected
    // separately. Keep this frozen only during synchronous population.
    Date.now = () => 0;
    return callback();
  } finally {
    Date.now = dateNow;
  }
}
