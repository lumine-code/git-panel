/** @babel */

// Optional navigation into this package's UI. Repository data and writes are
// provided by core; this package provides rendering through `git-panel.diff`.
export default function createPanelService(pack) {
  return {
    openGitTab: () => pack.openGitTab(),
    openCloneDialog: () => pack.openCloneDialog(),
    openInitializeDialog: () => pack.openInitializeDialog(),
  };
}
