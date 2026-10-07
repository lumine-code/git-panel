/** @babel */

// Optional navigation into this package's UI. Repository data and writes are
// provided by core; patch rendering is provided independently by patch-view.
export default function createPanelService(pack) {
  return {
    openGitTab: () => pack.openGitTab(),
    openCloneDialog: () => pack.openCloneDialog(),
    openInitializeDialog: () => pack.openInitializeDialog(),
  };
}
