/** @babel */

// The patch-size filter now lives in Lumine core; re-exported here under the
// name git-panel and github-panel already import.
import { filterPatch } from "atom";

export const filter = filterPatch;
