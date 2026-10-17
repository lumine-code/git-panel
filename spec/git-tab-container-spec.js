/** @babel */
import { createViewModel } from "./helpers/etch.js";

import GitTabContainer from "../lib/containers/git-tab-container.js";

describe("GitTabContainer repository data", () => {
  function renderData(container, data) {
    const observer = container.render().children[0];
    return observer.props.children(data).props;
  }

  function snapshot(repository) {
    return {
      repository,
      fetchInProgress: false,
      recentCommits: [],
      hasMoreRecentCommits: false,
      unstagedChanges: [{ filePath: "changed.txt" }],
    };
  }

  it("waits for the first snapshot even when the repository model is already loaded", () => {
    const repository = { isDestroyed: () => false };
    const container = createViewModel(GitTabContainer, { repository });

    const props = renderData(container, null);

    expect(props.repository).toBe(repository);
    expect(props.fetchInProgress).toBe(true);
    expect(props.unstagedChanges).toEqual([]);
    expect(renderData(container, snapshot(repository)).fetchInProgress).toBe(false);
  });

  it("keeps a complete snapshot behind the workspace restoration gate", async () => {
    const repository = { isDestroyed: () => false };
    const container = createViewModel(GitTabContainer, {
      repository,
      startupContextPending: true,
    });
    const data = snapshot(repository);

    expect(renderData(container, data).fetchInProgress).toBe(true);
    await container.update({ repository, startupContextPending: false });
    expect(renderData(container, data).fetchInProgress).toBe(false);
  });

  it("discards an observer snapshot from the destroyed startup guess", async () => {
    let destroyed = false;
    const guess = { isDestroyed: () => destroyed };
    const repository = { isDestroyed: () => false };
    const container = createViewModel(GitTabContainer, { repository: guess });
    const guessData = snapshot(guess);
    renderData(container, guessData);

    destroyed = true;
    await container.update({ repository });
    const props = renderData(container, guessData);

    expect(props.repository).toBe(repository);
    expect(props.fetchInProgress).toBe(true);
    expect(props.unstagedChanges).toEqual([]);
    expect(props.isSwitchingRepository).toBe(false);
    expect(container.lastData).toBeNull();
  });

  it("retains an accepted repository snapshot while the next repository loads", async () => {
    const previous = { isDestroyed: () => false };
    const repository = { isDestroyed: () => false };
    const container = createViewModel(GitTabContainer, { repository: previous });
    const previousData = snapshot(previous);
    renderData(container, previousData);
    await container.update({ repository });

    for (const data of [previousData, null]) {
      const props = renderData(container, data);
      expect(props.repository).toBe(previous);
      expect(props.unstagedChanges).toBe(previousData.unstagedChanges);
      expect(props.fetchInProgress).toBe(false);
      expect(props.isSwitchingRepository).toBe(true);
    }

    const props = renderData(container, snapshot(repository));
    expect(props.repository).toBe(repository);
    expect(props.isSwitchingRepository).toBe(false);
  });

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
    const container = createViewModel(GitTabContainer, { repository });

    const dataPromise = container.fetchData(repository);
    loading = false;
    finishIdentityRead("Configured identity");

    const data = await dataPromise;
    expect(data.fetchInProgress).toBe(true);
    expect(data.username).toBe("Configured identity");
    expect(data.email).toBe("Configured identity");
  });
});

describe("GitTabContainer history pagination", () => {
  function commit(sha) {
    return { getSha: () => sha };
  }

  function page(repository, prefix) {
    return {
      repository,
      recentCommits: Array.from({ length: 15 }, (_, index) => commit(`${prefix}-${index}`)),
      hasMoreRecentCommits: true,
    };
  }

  function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  }

  it("anchors each older page to the displayed history instead of a moving HEAD", async () => {
    const commits = Array.from({ length: 16 }, (_, index) => commit(`older-${index}`));
    const repository = {
      getRecentCommits: jasmine.createSpy().and.resolveTo(commits),
    };
    const container = createViewModel(GitTabContainer, { repository });
    const data = page(repository, "head");
    container.getRecentCommitProps(data);

    await container.loadMoreRecentCommits();

    expect(repository.getRecentCommits).toHaveBeenCalledOnceWith({
      max: 16,
      skip: 15,
      ref: "head-0",
    });
    const result = container.getRecentCommitProps(data);
    expect(result.recentCommits).toEqual(data.recentCommits.concat(commits.slice(0, 15)));
    expect(result.hasMoreRecentCommits).toBe(true);
    expect(container.state.recentCommitsLoading).toBe(false);
  });

  it("allows a failed page to be retried at the same history position", async () => {
    const failedRead = deferred();
    const repository = {
      getRecentCommits: jasmine.createSpy().and.returnValue(failedRead.promise),
    };
    const container = createViewModel(GitTabContainer, { repository });
    const data = page(repository, "head");
    container.getRecentCommitProps(data);

    const failedLoad = container.loadMoreRecentCommits();
    expect(container.state.recentCommitsLoading).toBe(true);
    failedRead.reject(new Error("Temporary history read failure"));
    await failedLoad;
    expect(container.state.recentCommitsLoading).toBe(false);

    repository.getRecentCommits.and.resolveTo([commit("older")]);
    await container.loadMoreRecentCommits();

    expect(repository.getRecentCommits).toHaveBeenCalledTimes(2);
    expect(container.getRecentCommitProps(data).recentCommits.at(-1).getSha()).toBe("older");
    expect(container.state.recentCommitsLoading).toBe(false);
  });

  it("lets concurrent callers wait for the same page to reach the rendered history", async () => {
    const read = deferred();
    const repository = {
      getRecentCommits: jasmine.createSpy().and.returnValue(read.promise),
    };
    const container = createViewModel(GitTabContainer, { repository });
    const data = page(repository, "head");
    container.getRecentCommitProps(data);
    const updateState = container.updateState.bind(container);
    container.updateState = async (...args) => {
      await updateState(...args);
      container.getRecentCommitProps(data);
    };

    const scrollLoad = container.loadMoreRecentCommits();
    const keyboardLoad = container.loadMoreRecentCommits();
    expect(keyboardLoad).toBe(scrollLoad);
    await Promise.resolve();
    expect(repository.getRecentCommits).toHaveBeenCalledTimes(1);

    const renderedCounts = [];
    scrollLoad.then(() => renderedCounts.push(container.recentCommitPage.count));
    keyboardLoad.then(() => renderedCounts.push(container.recentCommitPage.count));
    read.resolve([commit("older")]);
    await Promise.all([scrollLoad, keyboardLoad]);

    expect(renderedCounts).toEqual([16, 16]);
    expect(container.state.recentCommitsLoading).toBe(false);
  });

  it("keeps a new repository's page locked when an old repository finishes", async () => {
    for (const oldReadFails of [false, true]) {
      const oldRead = deferred();
      const newRead = deferred();
      const oldRepository = {
        getRecentCommits: jasmine.createSpy().and.returnValue(oldRead.promise),
      };
      const newRepository = {
        getRecentCommits: jasmine.createSpy().and.returnValue(newRead.promise),
      };
      const container = createViewModel(GitTabContainer, { repository: oldRepository });
      container.getRecentCommitProps(page(oldRepository, "old-head"));
      const oldLoad = container.loadMoreRecentCommits();

      await container.update({ repository: newRepository });
      const newData = page(newRepository, "new-head");
      container.getRecentCommitProps(newData);
      const newLoad = container.loadMoreRecentCommits();
      if (oldReadFails) {
        oldRead.reject(new Error("Previous repository is unavailable"));
      } else {
        oldRead.resolve([commit("old-commit")]);
      }
      await oldLoad;

      expect(container.state.recentCommitsLoading).toBe(true);
      expect(container.state.extraRecentCommits).toEqual([]);
      const repeatedNewLoad = container.loadMoreRecentCommits();
      expect(repeatedNewLoad).toBe(newLoad);
      expect(newRepository.getRecentCommits).toHaveBeenCalledTimes(1);

      newRead.resolve([commit("new-commit")]);
      await Promise.all([newLoad, repeatedNewLoad]);
      expect(container.getRecentCommitProps(newData).recentCommits.at(-1).getSha()).toBe(
        "new-commit",
      );
      expect(container.state.recentCommitsLoading).toBe(false);
    }
  });

  it("discards an older page when the displayed history changes while it loads", async () => {
    const read = deferred();
    const repository = {
      getRecentCommits: jasmine.createSpy().and.returnValue(read.promise),
    };
    const container = createViewModel(GitTabContainer, { repository });
    container.getRecentCommitProps(page(repository, "old-head"));
    const load = container.loadMoreRecentCommits();

    const newData = page(repository, "new-head");
    container.getRecentCommitProps(newData);
    read.resolve([commit("old-commit")]);
    await load;

    expect(container.state.extraRecentCommits).toEqual([]);
    expect(container.state.recentCommitsLoading).toBe(false);
    expect(container.getRecentCommitProps(newData).recentCommits).toEqual(newData.recentCommits);
    repository.getRecentCommits.and.resolveTo([commit("new-commit")]);
    await container.loadMoreRecentCommits();
    expect(repository.getRecentCommits.calls.mostRecent().args[0]).toEqual({
      max: 16,
      skip: 15,
      ref: "new-head-0",
    });
  });
});
