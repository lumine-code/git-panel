module.exports = function registerGlobalCommands(commands, getPackage) {
  return commands.add("lumine-workspace", {
    "git-panel:toggle-git-tab": () =>
      getPackage()
        .ensureRootController()
        .then(({ root }) => root.gitTabTracker.toggle()),
    "git-panel:toggle-focus": () =>
      getPackage()
        .ensureRootController()
        .then(({ root }) => root.gitTabTracker.toggleFocus()),
    "git-panel:toggle-commit-preview": {
      description: "Show what the staged changes would commit as, before committing.",
      didDispatch: () => getPackage().invokeGitController("toggleCommitPreviewItem"),
    },
    "git-panel:show-waterfall-diagnostics": {
      description: "Open a timing report of the Git calls this window has made.",
      didDispatch: () => getPackage().invokeGitController("showWaterfallDiagnostics"),
    },
    "git-panel:show-cache-diagnostics": {
      description: "Report what the Git cache is holding and what it has missed.",
      didDispatch: () => getPackage().invokeGitController("showCacheDiagnostics"),
    },
    "git-panel:initialize": {
      description: "Create a Git repository in a project folder you choose.",
      didDispatch: () => getPackage().invokeGitController("openInitializeDialog"),
    },
    "git-panel:clone": {
      description: "Clone a remote repository into a folder you choose.",
      didDispatch: () => getPackage().invokeGitController("openCloneDialog"),
    },
    "git-panel:open-commit": {
      description: "Open a commit by the hash you type, and show what it changed.",
      didDispatch: () => getPackage().invokeGitController("openCommitDialog"),
    },
    "git-panel:view-unstaged-changes-for-current-file": {
      description: "Open the diff of what this file has that is not yet staged.",
      didDispatch: (event) =>
        getPackage().invokeGitController("viewUnstagedChangesForCurrentFile", event),
    },
    "git-panel:view-staged-changes-for-current-file": {
      description: "Open the diff of what this file has already staged.",
      didDispatch: (event) =>
        getPackage().invokeGitController("viewStagedChangesForCurrentFile", event),
    },
    "git-panel:close-all-diff-views": {
      description: "Close every diff tab this package has opened.",
      didDispatch: () => getPackage().invokeGitController("destroyPatchPaneItems"),
    },
    "git-panel:close-empty-diff-views": {
      description: "Close the diff tabs whose file no longer has changes.",
      didDispatch: () => getPackage().invokeGitController("destroyEmptyPatchPaneItems"),
    },
  });
};
