/** @babel */
import { filterPatch } from "atom";

import Repository from "./models/repository";
import { buildMultiFilePatch } from "./models/patch";
import { parseDiff } from "./git-shell-out-strategy";

// The MultiFilePatchController pulls in React and the whole patch view tree, so
// it is loaded on demand — only when github-panel actually renders a diff.
let MultiFilePatchController;

function ensureMultiFilePatchController() {
  if (!MultiFilePatchController) {
    const controllerModule = require("./controllers/multi-file-patch-controller");
    MultiFilePatchController = controllerModule.default || controllerModule;
  }
}

// The service git-panel provides to github-panel: the shared diff → MultiFilePatch
// pipeline (the pieces that can't move to core because they render into editor
// buffers) plus a mirror of the panel's active-repository context and Git tab
// control. github-panel consumes this instead of reaching into git-panel
// internals, and gets `GitError`/`filterPatch` from the `atom` module directly.
// The review-comment patch preview stays in github-panel (a forge feature): it
// renders the MultiFilePatch built here, but the view itself is not git-panel's.
export default function createGitHubBridge(pack) {
  return {
    // Diff → MultiFilePatch pipeline. github-panel feeds a raw GitHub API diff
    // through the same parser git-panel uses, guaranteeing a matching shape.
    filterDiff: filterPatch,
    parseDiff,
    buildMultiFilePatch,
    get MultiFilePatchController() {
      ensureMultiFilePatchController();
      return MultiFilePatchController;
    },

    // Repository objects for github-panel's ObserveModel.
    getAbsentRepository: () => Repository.absent(),
    getRepositoryForWorkdir: (workdir) => pack.getRepositoryForWorkdir(workdir),
    getContextPool: () => pack.getContextPool(),

    // The panel's active-repository context mirror + Git tab control.
    getActiveRepository: () => pack.getActiveRepository(),
    getActiveWorkdir: () => pack.getActiveWorkdir(),
    isContextLocked: () => pack.isContextLocked(),
    scheduleActiveContextUpdate: (options) => pack.scheduleActiveContextUpdate(options),
    openGitTab: () => pack.openGitTab(),
    onDidUpdate: (cb) => pack.onDidUpdate(cb),
  };
}
