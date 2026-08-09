/** @babel */

// The patch-size filter now lives in Lumine core; re-exported here under the
// name git-panel and github-panel already import.
import { filterPatch } from "lumine";

export const filter = filterPatch;
