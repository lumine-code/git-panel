/** @babel */

import GitTabContainer from "../lib/containers/git-tab-container";

describe("GitTabContainer repository data", () => {
  it("keeps a snapshot started during Loading marked as in progress", async () => {
    let loading = true;
    let finishIdentityRead;
    const identity = new Promise((resolve) => (finishIdentityRead = resolve));
    const repository = {
      showGitTabLoading: () => loading,
      getRecentCommits: () => Promise.resolve([]),
      getConfig: () => identity,
      getLastCommit: () => Promise.resolve(null),
      isMerging: () => Promise.resolve(false),
      isRebasing: () => Promise.resolve(false),
      hasDiscardHistory: () => false,
      getCurrentBranch: () => Promise.resolve(null),
      getUnstagedChanges: () => Promise.resolve([]),
      getStagedChanges: () => Promise.resolve([]),
      getMergeConflicts: () => Promise.resolve([]),
      getWorkingDirectoryPath: () => "C:\\workdir",
    };
    const container = new GitTabContainer({ repository });

    const dataPromise = container.fetchData(repository);
    loading = false;
    finishIdentityRead("Configured identity");

    const data = await dataPromise;
    expect(data.fetchInProgress).toBe(true);
    expect(data.username).toBe("Configured identity");
    expect(data.email).toBe("Configured identity");
  });
});
