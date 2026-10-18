/** @babel */
import path from "node:path";
import { Disposable } from "lumine";

import GitTabView from "../lib/views/git-tab-view.js";
import GitTabContainer from "../lib/containers/git-tab-container.js";
import RefHolder from "../lib/models/ref-holder.js";
import { nullAuthor } from "../lib/models/author.js";
import { nullBranch } from "../lib/models/branch.js";
import { nullCommit } from "../lib/models/commit.js";
import { nullOperationStates } from "../lib/models/operation-states.js";
import ResolutionProgress from "../lib/models/conflicts/resolution-progress.js";
import { flushViews } from "./helpers/etch.js";

describe("Git tab initial repository loading", () => {
  let view;
  const workdir = path.join(path.parse(process.cwd()).root, "git-tab-loading-spec");

  function repository({ loading = false, absent = false } = {}) {
    return {
      isTooLarge: () => false,
      hasDirectory: () => !absent,
      getWorkingDirectoryPath: () => (absent ? null : workdir),
      getGitDirectoryPath: () => path.join(workdir, ".git"),
      showGitTabLoading: () => loading,
      showGitTabInit: () => absent,
      showGitTabInitInProgress: () => false,
      isAbsent: () => absent,
      isPresent: () => !absent,
      isDestroyed: () => false,
      getCommitter: async () => nullAuthor,
      onDidUpdate: () => new Disposable(),
      getCommitMessage: () => "",
      setCommitMessage: () => {},
      getOperationStates: () => nullOperationStates,
    };
  }

  function containerProps(getUnstagedChanges) {
    return {
      repository: {
        ...repository(),
        getConfig: async () => "Configured identity",
        getAuthors: async () => [],
        getRecentCommits: async () => [],
        getLastCommit: async () => nullCommit,
        getCurrentBranch: async () => nullBranch,
        isMerging: async () => false,
        isRebasing: async () => false,
        hasDiscardHistory: () => false,
        getUnstagedChanges,
        getStagedChanges: async () => [],
        getMergeConflicts: async () => [],
      },
      repositoryDataCache: new WeakMap(),
      commands: lumine.commands,
      workspace: lumine.workspace,
      config: lumine.config,
      grammars: lumine.grammars,
      tooltips: lumine.tooltips,
      notificationManager: lumine.notifications,
      project: lumine.project,
      resolutionProgress: new ResolutionProgress(),
    };
  }

  async function mount(props = {}) {
    view = new GitTabView({
      repository: repository(),
      isLoading: false,
      isSwitchingRepository: false,
      refRoot: new RefHolder(),
      refStagingView: new RefHolder(),
      commands: lumine.commands,
      workspace: lumine.workspace,
      config: lumine.config,
      grammars: lumine.grammars,
      tooltips: lumine.tooltips,
      notificationManager: lumine.notifications,
      workingDirectoryPath: workdir,
      unstagedChanges: [],
      stagedChanges: [],
      mergeConflicts: [],
      recentCommits: [],
      lastCommit: nullCommit,
      currentBranch: nullBranch,
      selectedCoAuthors: [],
      openInitializeDialog: jasmine.createSpy("open initialize dialog"),
      openCloneDialog: jasmine.createSpy("open clone dialog"),
      ...props,
    });
    jasmine.attachToDOM(view.element);
    await flushViews(async () => {});
  }

  afterEach(async () => {
    await view?.destroy();
    view = null;
  });

  function expectLoading() {
    const status = view.element.querySelector(".git-panel-Git-loading");
    expect(status).not.toBeNull();
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-label")).toBe("Loading repository…");
    expect(status.querySelector(".git-panel-Loader .git-panel-Spinner")).not.toBeNull();
    expect(view.element.getAttribute("aria-busy")).toBe("true");
    expect(view.element.querySelector(".git-panel-StagingView")).toBeNull();
    expect(view.element.querySelector(".git-panel-CommitView")).toBeNull();
    expect(view.element.querySelector(".no-repository")).toBeNull();
    expect(view.element.classList.contains("is-no-repository")).toBe(false);
  }

  it("keeps one loading body through discovery until the first repository snapshot is ready", async () => {
    await mount({ repository: repository({ loading: true }) });
    expectLoading();
    const status = view.element.querySelector(".git-panel-Git-loading");

    // Discovery can briefly expose an absent guess before it selects the real
    // repository. Neither that guess nor its unfinished snapshot is content.
    await flushViews(() =>
      view.update({ ...view.props, repository: repository({ absent: true }), isLoading: true }),
    );
    expectLoading();
    expect(view.element.querySelector(".git-panel-Git-loading")).toBe(status);

    await flushViews(() => view.update({ ...view.props, repository: repository() }));
    expectLoading();
    expect(view.element.querySelector(".git-panel-Git-loading")).toBe(status);

    let finishSnapshot;
    const snapshot = new Promise((resolve) => (finishSnapshot = resolve));
    const ready = snapshot.then((unstagedChanges) =>
      view.update({ ...view.props, isLoading: false, unstagedChanges }),
    );
    finishSnapshot([{ filePath: "ready.txt", status: "modified" }]);
    await flushViews(() => ready);

    expect(view.element.querySelector(".git-panel-Git-loading")).toBeNull();
    expect(view.element.querySelector(".no-repository")).toBeNull();
    expect(view.element.getAttribute("aria-busy")).toBe("false");
    expect(view.element.querySelector(".git-panel-StagingView")).not.toBeNull();
    expect(view.element.querySelector(".git-panel-CommitView")).not.toBeNull();
    expect(view.element.querySelector(".git-panel-FilePatchListView-path").textContent).toBe(
      "ready.txt",
    );
  });

  it("offers Create and Clone only after discovery confirms there is no repository", async () => {
    await mount({ repository: repository({ absent: true }), isLoading: true });
    expectLoading();

    await flushViews(() => view.update({ ...view.props, isLoading: false }));

    expect(view.element.querySelector(".git-panel-Git-loading")).toBeNull();
    expect(view.element.querySelector(".git-panel-StagingView")).toBeNull();
    expect(view.element.getAttribute("aria-busy")).toBe("false");
    const actions = Array.from(view.element.querySelectorAll(".no-repository button"));
    expect(actions.map((button) => button.textContent.trim())).toEqual([
      "Create repository",
      "Clone repository",
    ]);
    actions[0].click();
    actions[1].click();
    expect(view.props.openInitializeDialog).toHaveBeenCalledOnceWith(null);
    expect(view.props.openCloneDialog).toHaveBeenCalledTimes(1);
  });

  it("reopens with the accepted content while refreshing changes made with the panel closed", async () => {
    let finishChanges;
    const getUnstagedChanges = jasmine
      .createSpy("read changes")
      .and.callFake(() => new Promise((resolve) => (finishChanges = resolve)));
    const props = containerProps(getUnstagedChanges);
    view = new GitTabContainer(props);
    jasmine.attachToDOM(view.element);
    expect(view.element.querySelector(".git-panel-Git-loading")).not.toBeNull();

    await flushViews(() => finishChanges([{ filePath: "ready.txt", status: "modified" }]));
    expect(view.element.querySelector(".git-panel-Git-loading")).toBeNull();
    await view.destroy();

    view = new GitTabContainer(props);
    jasmine.attachToDOM(view.element);
    expect(getUnstagedChanges).toHaveBeenCalledTimes(2);
    expect(view.element.querySelector(".git-panel-Git-loading")).toBeNull();
    expect(view.element.querySelector(".git-panel-FilePatchListView-path").textContent).toBe(
      "ready.txt",
    );
    await flushViews(() => finishChanges([{ filePath: "updated.txt", status: "modified" }]));
    expect(view.element.querySelector(".git-panel-Git-loading")).toBeNull();
    expect(view.element.querySelector(".git-panel-FilePatchListView-path").textContent).toBe(
      "updated.txt",
    );
  });

  it("removes cached actions when a reopened repository is no longer available", async () => {
    const getUnstagedChanges = jasmine
      .createSpy("read changes")
      .and.resolveTo([{ filePath: "ready.txt", status: "modified" }]);
    const props = containerProps(getUnstagedChanges);
    view = new GitTabContainer(props);
    jasmine.attachToDOM(view.element);
    await flushViews(async () => {});
    expect(view.element.querySelector(".git-panel-FilePatchListView-path").textContent).toBe(
      "ready.txt",
    );
    await view.destroy();

    let rejectRead;
    getUnstagedChanges.and.callFake(() => new Promise((resolve, reject) => (rejectRead = reject)));
    view = new GitTabContainer(props);
    jasmine.attachToDOM(view.element);
    expect(view.element.querySelector(".git-panel-Git-loading")).toBeNull();

    await flushViews(() =>
      rejectRead(
        Object.assign(new Error("Working directory disappeared"), {
          code: "ERR_GIT_REPOSITORY_UNAVAILABLE",
        }),
      ),
    );
    expect(view.element.querySelector(".git-panel-Git-loading")).not.toBeNull();
    expect(view.element.querySelector(".git-panel-StagingView")).toBeNull();
    expect(view.element.querySelector(".git-panel-FilePatchListView-path")).toBeNull();
    expect(props.repositoryDataCache.has(props.repository)).toBe(false);
    await view.destroy();

    view = new GitTabContainer(props);
    jasmine.attachToDOM(view.element);
    expect(view.element.querySelector(".git-panel-Git-loading")).not.toBeNull();
    expect(view.element.querySelector(".git-panel-FilePatchListView-path")).toBeNull();
  });

  jasmine.itWithDocumentFocus(
    "holds requested staging focus on the loader and restores it when changes are ready",
    async () => {
      await mount({ isLoading: true });

      expect(view.setFocus(GitTabView.focus.UNSTAGED)).toBe(true);
      expect(document.activeElement).toBe(view.element);
      expectLoading();

      await flushViews(() =>
        view.update({
          ...view.props,
          isLoading: false,
          unstagedChanges: [{ filePath: "ready.txt", status: "modified" }],
        }),
      );

      const staging = view.element.querySelector(".git-panel-StagingView");
      expect(staging.contains(document.activeElement)).toBe(true);
      expect(view.getFocus(document.activeElement)).toBe(GitTabView.focus.UNSTAGED);
    },
  );

  jasmine.itWithDocumentFocus(
    "keeps focus outside the panel if the user leaves the loader before changes are ready",
    async () => {
      await mount({ isLoading: true });
      expect(view.setFocus(GitTabView.focus.STAGING)).toBe(true);
      expect(document.activeElement).toBe(view.element);
      const outside = document.createElement("button");
      outside.textContent = "Outside the Git panel";
      jasmine.attachToDOM(outside);
      outside.focus();
      expect(document.activeElement).toBe(outside);

      await flushViews(() =>
        view.update({
          ...view.props,
          isLoading: false,
          unstagedChanges: [{ filePath: "ready.txt", status: "modified" }],
        }),
      );

      expect(view.element.querySelector(".git-panel-StagingView")).not.toBeNull();
      expect(document.activeElement).toBe(outside);
      expect(view.hasFocus()).toBe(false);
    },
  );

  it("preserves the accepted repository content while a replacement is being prepared", async () => {
    await mount({ unstagedChanges: [{ filePath: "current.txt", status: "modified" }] });
    const staging = view.element.querySelector(".git-panel-StagingView");
    const commit = view.element.querySelector(".git-panel-CommitView");

    await flushViews(() => view.update({ ...view.props, isSwitchingRepository: true }));

    expect(view.element.getAttribute("aria-busy")).toBe("true");
    expect(view.element.querySelector(".git-panel-Git-loading")).toBeNull();
    expect(view.element.querySelector(".no-repository")).toBeNull();
    expect(view.element.querySelector(".git-panel-StagingView")).toBe(staging);
    expect(view.element.querySelector(".git-panel-CommitView")).toBe(commit);
    expect(view.element.querySelector(".git-panel-FilePatchListView-path").textContent).toBe(
      "current.txt",
    );

    await flushViews(() => view.update({ ...view.props, isSwitchingRepository: false }));
    expect(view.element.getAttribute("aria-busy")).toBe("false");
    expect(view.element.querySelector(".git-panel-StagingView")).toBe(staging);
  });
});
