/** @babel */
import path from "path";

import RecentCommitsController from "../lib/controllers/recent-commits-controller.js";
import PatchDocument from "../lib/models/patch-document.js";
import { createViewModel } from "./helpers/etch.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("recent commit selection and preview opening", () => {
  let controller, repository, workspace, subscription, destroySubscription;

  const commits = ["first", "second", "third"].map((sha) => ({ getSha: () => sha }));
  const workdir = path.join(import.meta.dirname, "fixtures", "repository");

  beforeEach(() => {
    subscription = { dispose: jasmine.createSpy("dispose active item observer") };
    destroySubscription = { dispose: jasmine.createSpy("dispose destroyed item observer") };
    repository = { getWorkingDirectoryPath: () => workdir };
    workspace = {
      onDidChangeActivePaneItem: jasmine
        .createSpy("observe active item")
        .and.returnValue(subscription),
      onDidDestroyPaneItem: jasmine
        .createSpy("observe destroyed item")
        .and.returnValue(destroySubscription),
      getActivePaneItem: jasmine.createSpy("get active item").and.returnValue(null),
      open: jasmine.createSpy("open commit").and.resolveTo({}),
    };
    controller = createViewModel(RecentCommitsController, {
      repository,
      workspace,
      commits,
      hasMoreCommits: false,
    });
    spyOn(controller, "setFocus").and.returnValue(true);
  });

  afterEach(() => controller.destroy());

  it("selects the clicked commit before its pending preview finishes opening", async () => {
    const opening = deferred();
    workspace.open.and.returnValue(opening.promise);
    await controller.selectCommit("first");

    const pendingOpen = controller.openCommit({ sha: "second", preserveFocus: true });

    expect(controller.state.selectedCommitSha).toBe("second");
    expect(controller.setFocus).not.toHaveBeenCalled();
    opening.resolve({});
    await pendingOpen;

    expect(workspace.open).toHaveBeenCalledOnceWith(
      PatchDocument.commit(workdir, "second").getURI(),
      { pending: true, activatePane: false },
    );
    expect(controller.setFocus).toHaveBeenCalledOnceWith(
      RecentCommitsController.focus.RECENT_COMMIT,
    );
    expect(controller.state.selectedCommitSha).toBe("second");
  });

  it("keeps the diff's focus when opening the selected commit from the keyboard", async () => {
    await controller.openCommit({ sha: "second", preserveFocus: false });

    expect(controller.state.selectedCommitSha).toBe("second");
    expect(workspace.open).toHaveBeenCalledOnceWith(
      PatchDocument.commit(workdir, "second").getURI(),
      { pending: true, activatePane: true },
    );
    expect(controller.setFocus).not.toHaveBeenCalled();
  });

  it("does not restore focus when the user selected another commit while opening", async () => {
    const opening = deferred();
    workspace.open.and.returnValue(opening.promise);
    const pendingOpen = controller.openCommit({ sha: "first", preserveFocus: true });

    await controller.selectCommit("third");
    opening.resolve({});
    await pendingOpen;

    expect(controller.state.selectedCommitSha).toBe("third");
    expect(controller.setFocus).not.toHaveBeenCalled();
  });

  it("does not steal focus from an unrelated control when a preview finishes opening", async () => {
    const opening = deferred();
    workspace.open.and.returnValue(opening.promise);
    const button = document.createElement("button");
    jasmine.attachToDOM(button);
    const pendingOpen = controller.openCommit({ sha: "first", preserveFocus: true });

    try {
      button.focus();
      expect(document.activeElement).toBe(button);
      opening.resolve({});
      await pendingOpen;

      expect(controller.state.selectedCommitSha).toBe("first");
      expect(document.activeElement).toBe(button);
      expect(controller.setFocus).not.toHaveBeenCalled();
    } finally {
      button.remove();
    }
  });

  it("ignores an earlier open completion after a newer preview has opened", async () => {
    const opening = deferred();
    workspace.open.and.returnValues(opening.promise, Promise.resolve({}));
    const previousOpen = controller.openCommit({ sha: "first", preserveFocus: true });

    await controller.openCommit({ sha: "second", preserveFocus: true });
    controller.setFocus.calls.reset();
    opening.resolve({});
    await previousOpen;

    expect(controller.state.selectedCommitSha).toBe("second");
    expect(controller.setFocus).not.toHaveBeenCalled();
  });

  it("ignores an earlier completion even when both preview requests name the same commit", async () => {
    const opening = deferred();
    workspace.open.and.returnValues(opening.promise, Promise.resolve({}));
    const previousOpen = controller.openCommit({ sha: "first", preserveFocus: true });

    await controller.openCommit({ sha: "first", preserveFocus: true });
    controller.setFocus.calls.reset();
    opening.resolve({});
    await previousOpen;

    expect(controller.state.selectedCommitSha).toBe("first");
    expect(controller.setFocus).not.toHaveBeenCalled();
  });

  it("does not restore focus to another repository when a previous open completes", async () => {
    const opening = deferred();
    workspace.open.and.returnValue(opening.promise);
    const pendingOpen = controller.openCommit({ sha: "first", preserveFocus: true });
    const nextRepository = { getWorkingDirectoryPath: () => path.join(workdir, "other") };

    await controller.update({ ...controller.props, repository: nextRepository });
    opening.resolve({});
    await pendingOpen;

    expect(controller.state.selectedCommitSha).toBe("");
    expect(controller.setFocus).not.toHaveBeenCalled();
  });

  it("does not restore focus after a refresh removes the opening commit", async () => {
    const opening = deferred();
    workspace.open.and.returnValue(opening.promise);
    const pendingOpen = controller.openCommit({ sha: "second", preserveFocus: true });

    await controller.update({ ...controller.props, commits: [commits[0], commits[2]] });
    opening.resolve({});
    await pendingOpen;

    expect(controller.state.selectedCommitSha).toBe("");
    expect(controller.setFocus).not.toHaveBeenCalled();
  });

  it("does not restore focus after the history controller is destroyed", async () => {
    const opening = deferred();
    workspace.open.and.returnValue(opening.promise);
    const pendingOpen = controller.openCommit({ sha: "first", preserveFocus: true });

    await controller.destroy();
    opening.resolve({});
    await pendingOpen;

    expect(controller.setFocus).not.toHaveBeenCalled();
    expect(subscription.dispose).toHaveBeenCalledOnceWith();
    expect(destroySubscription.dispose).toHaveBeenCalledOnceWith();
  });

  it("does not restore history focus when the workspace declines the preview", async () => {
    workspace.open.and.resolveTo(undefined);

    await controller.openCommit({ sha: "second", preserveFocus: true });

    expect(controller.setFocus).not.toHaveBeenCalled();
  });

  it("does not restore history focus when opening the preview fails", async () => {
    const error = new Error("Cannot open commit preview");
    workspace.open.and.rejectWith(error);

    await expectAsync(
      controller.openCommit({ sha: "second", preserveFocus: true }),
    ).toBeRejectedWith(error);

    expect(controller.setFocus).not.toHaveBeenCalled();
  });

  it("does not open an empty or unavailable commit selection", async () => {
    for (const sha of ["", null, undefined, "missing"]) {
      await controller.openCommit({ sha, preserveFocus: false });
    }

    expect(workspace.open).not.toHaveBeenCalled();
    expect(controller.state.selectedCommitSha).toBe("");
    expect(controller.setFocus).not.toHaveBeenCalled();
  });

  it("clears the old selection when the repository changes", async () => {
    await controller.selectCommit("second");
    const nextRepository = { getWorkingDirectoryPath: () => path.join(workdir, "other") };

    await controller.update({ ...controller.props, repository: nextRepository });

    expect(controller.state.selectedCommitSha).toBe("");
  });

  it("clears a selection removed from the refreshed commit history", async () => {
    await controller.selectCommit("second");

    await controller.update({ ...controller.props, commits: [commits[0], commits[2]] });

    expect(controller.state.selectedCommitSha).toBe("");
  });

  it("retains the selection when a refresh replaces commit objects with the same hashes", async () => {
    await controller.selectCommit("second");

    await controller.update({
      ...controller.props,
      commits: commits.map((commit) => ({ getSha: () => commit.getSha() })),
    });

    expect(controller.state.selectedCommitSha).toBe("second");
  });

  it("selects a matching commit when its diff pane is activated manually", async () => {
    workspace.getActivePaneItem.and.returnValue({
      getURI: () => PatchDocument.commit(workdir, "second").getURI(),
    });

    await controller.updateSelectedCommit();

    expect(controller.state.selectedCommitSha).toBe("second");
  });

  it("clears the visible selection when an active commit is outside the loaded history", async () => {
    await controller.selectCommit("second");
    workspace.getActivePaneItem.and.returnValue({
      getURI: () => PatchDocument.commit(workdir, "older").getURI(),
    });

    await controller.updateSelectedCommit();

    expect(controller.state.selectedCommitSha).toBe("");
  });

  it("clears a closed selected commit even when the dock remains active", async () => {
    await controller.selectCommit("second");
    workspace.getActivePaneItem.and.returnValue({ getURI: () => "lumine-git://dock-item/git" });
    const destroyedItem = workspace.onDidDestroyPaneItem.calls.mostRecent().args[0];

    await destroyedItem({
      item: { getURI: () => PatchDocument.commit(workdir, "second").getURI() },
      index: 0,
      pane: {},
    });

    expect(controller.state.selectedCommitSha).toBe("");
  });

  it("keeps selection when an unrelated pane item closes", async () => {
    await controller.selectCommit("second");
    for (const item of [
      {},
      { getURI: () => "file:///unrelated.txt" },
      { getURI: () => PatchDocument.file(workdir, "file.txt", "unstaged").getURI() },
      { getURI: () => PatchDocument.commit(workdir, "first").getURI() },
      { getURI: () => PatchDocument.commit(path.join(workdir, "other"), "second").getURI() },
    ]) {
      await controller.clearDestroyedCommit({ item, index: 0, pane: {} });
      expect(controller.state.selectedCommitSha).toBe("second");
    }
  });

  it("keeps the history selection when focus returns to the dock or another repository", async () => {
    await controller.selectCommit("second");
    for (const item of [
      null,
      { getURI: () => "lumine-git://dock-item/git" },
      { getURI: () => PatchDocument.commit(path.join(workdir, "other"), "third").getURI() },
    ]) {
      workspace.getActivePaneItem.and.returnValue(item);
      await controller.updateSelectedCommit();
      expect(controller.state.selectedCommitSha).toBe("second");
    }
  });

  it("selects the first appended commit when moving down past the loaded history", async () => {
    const loading = deferred();
    const loadMoreCommits = jasmine.createSpy("load next commits").and.returnValue(loading.promise);
    await controller.update({ ...controller.props, hasMoreCommits: true, loadMoreCommits });
    await controller.selectCommit("third");

    const move = controller.selectNextCommit();

    expect(loadMoreCommits).toHaveBeenCalledOnceWith();
    expect(controller.state.selectedCommitSha).toBe("third");
    await controller.update({
      ...controller.props,
      commits: [...commits, { getSha: () => "fourth" }, { getSha: () => "fifth" }],
    });
    loading.resolve();
    await move;

    expect(controller.state.selectedCommitSha).toBe("fourth");
  });

  it("does not replace a newer selection when keyboard paging finishes", async () => {
    const loading = deferred();
    const loadMoreCommits = jasmine.createSpy("load next commits").and.returnValue(loading.promise);
    await controller.update({ ...controller.props, hasMoreCommits: true, loadMoreCommits });
    await controller.selectCommit("third");
    const move = controller.selectNextCommit();

    await controller.selectCommit("first");
    await controller.update({
      ...controller.props,
      commits: [...commits, { getSha: () => "fourth" }],
    });
    loading.resolve();
    await move;

    expect(controller.state.selectedCommitSha).toBe("first");
  });

  it("moves past the selected commit when new history is prepended during paging", async () => {
    const loading = deferred();
    const loadMoreCommits = jasmine.createSpy("load next commits").and.returnValue(loading.promise);
    await controller.update({ ...controller.props, hasMoreCommits: true, loadMoreCommits });
    await controller.selectCommit("third");
    const move = controller.selectNextCommit();

    await controller.update({
      ...controller.props,
      commits: [{ getSha: () => "new-head" }, ...commits, { getSha: () => "fourth" }],
    });
    loading.resolve();
    await move;

    expect(controller.state.selectedCommitSha).toBe("fourth");
  });

  it("loads only one page while repeated down commands wait at the last row", async () => {
    const loading = deferred();
    const loadMoreCommits = jasmine.createSpy("load next commits").and.returnValue(loading.promise);
    await controller.update({ ...controller.props, hasMoreCommits: true, loadMoreCommits });
    await controller.selectCommit("third");

    const firstMove = controller.selectNextCommit();
    await controller.selectNextCommit();
    await controller.selectNextCommit();

    expect(loadMoreCommits).toHaveBeenCalledOnceWith();
    await controller.update({
      ...controller.props,
      commits: [...commits, { getSha: () => "fourth" }],
    });
    loading.resolve();
    await firstMove;

    expect(controller.state.selectedCommitSha).toBe("fourth");
  });

  it("keeps the replacement repository's selection when a previous page finishes", async () => {
    const loading = deferred();
    const loadMoreCommits = jasmine.createSpy("load next commits").and.returnValue(loading.promise);
    await controller.update({ ...controller.props, hasMoreCommits: true, loadMoreCommits });
    await controller.selectCommit("third");
    const previousMove = controller.selectNextCommit();

    await controller.update({
      ...controller.props,
      repository: { getWorkingDirectoryPath: () => path.join(workdir, "other") },
      commits: [...commits, { getSha: () => "fourth" }],
    });
    await controller.selectCommit("second");
    loading.resolve();
    await previousMove;

    expect(controller.state.selectedCommitSha).toBe("second");
  });

  it("allows the new repository to page while an old repository request remains pending", async () => {
    const previousLoading = deferred();
    const nextLoading = deferred();
    const loadMoreCommits = jasmine
      .createSpy("load next commits")
      .and.returnValues(previousLoading.promise, nextLoading.promise);
    await controller.update({ ...controller.props, hasMoreCommits: true, loadMoreCommits });
    await controller.selectCommit("third");
    const previousMove = controller.selectNextCommit();

    await controller.update({
      ...controller.props,
      repository: { getWorkingDirectoryPath: () => path.join(workdir, "other") },
    });
    await controller.selectCommit("third");
    const nextMove = controller.selectNextCommit();

    expect(loadMoreCommits).toHaveBeenCalledTimes(2);
    previousLoading.resolve();
    await previousMove;
    await controller.selectNextCommit();
    expect(loadMoreCommits).toHaveBeenCalledTimes(2);
    await controller.update({
      ...controller.props,
      commits: [...commits, { getSha: () => "fourth" }],
    });
    nextLoading.resolve();
    await nextMove;

    expect(controller.state.selectedCommitSha).toBe("fourth");
  });

  it("moves to the first and last loaded commits without opening a preview", async () => {
    await controller.selectCommit("second");

    await controller.selectFirstCommit();
    expect(controller.state.selectedCommitSha).toBe("first");
    await controller.selectLastCommit();
    expect(controller.state.selectedCommitSha).toBe("third");
    expect(workspace.open).not.toHaveBeenCalled();
  });

  it("keeps the last commit selected when no more history exists", async () => {
    const loadMoreCommits = jasmine.createSpy("load next commits");
    await controller.update({ ...controller.props, loadMoreCommits });
    await controller.selectCommit("third");

    await controller.selectNextCommit();

    expect(controller.state.selectedCommitSha).toBe("third");
    expect(loadMoreCommits).not.toHaveBeenCalled();
  });
});

describe("recent commit selection when real pane items close", () => {
  let controller, centerPane, initialItems, initialPanes;
  const workdir = path.join(import.meta.dirname, "fixtures", "repository");
  const commits = ["first", "second"].map((sha) => ({ getSha: () => sha }));

  beforeEach(() => {
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    initialItems = new Set(lumine.workspace.getPaneItems());
    initialPanes = new Set(lumine.workspace.getPanes());
    centerPane = lumine.workspace.getCenter().getActivePane();
    controller = createViewModel(RecentCommitsController, {
      repository: { getWorkingDirectoryPath: () => workdir },
      workspace: lumine.workspace,
      commits,
      hasMoreCommits: false,
    });
  });

  afterEach(async () => {
    await controller.destroy();
    for (const item of lumine.workspace.getPaneItems()) {
      if (!initialItems.has(item)) await lumine.workspace.paneForItem(item)?.destroyItem(item);
    }
    for (const pane of lumine.workspace.getPanes()) {
      if (!initialPanes.has(pane)) pane.destroy();
    }
  });

  function commitItem(sha) {
    return {
      element: document.createElement("div"),
      getURI: () => PatchDocument.commit(workdir, sha).getURI(),
      getTitle: () => `Commit ${sha}`,
      getAllowedLocations: () => ["center"],
    };
  }

  it("clears a closed center preview while its Git dock remains active", async () => {
    const dock = lumine.workspace.getRightDock();
    const dockPane = dock.getActivePane();
    const dockItem = {
      element: document.createElement("div"),
      getURI: () => "lumine-git://dock-item/git",
      getTitle: () => "Git",
      getAllowedLocations: () => ["right"],
    };
    dockPane.activateItem(dockItem);
    dock.show();
    dockPane.activate();
    const item = commitItem("second");
    centerPane.activateItem(item);
    await controller.selectCommit("second");
    expect(lumine.workspace.getActivePaneItem()).toBe(dockItem);

    await centerPane.destroyItem(item);

    expect(lumine.workspace.getActivePaneItem()).toBe(dockItem);
    expect(controller.state.selectedCommitSha).toBe("");
  });

  it("clears the selection when closing the last active center commit", async () => {
    const item = commitItem("second");
    centerPane.activateItem(item);
    centerPane.activate();
    expect(controller.state.selectedCommitSha).toBe("second");

    await centerPane.destroyItem(item);

    expect(lumine.workspace.getCenter().getActivePaneItem()).toBeUndefined();
    expect(controller.state.selectedCommitSha).toBe("");
  });

  it("selects the surviving commit after closing replaces the active center item", async () => {
    const survivingItem = commitItem("first");
    const closingItem = commitItem("second");
    centerPane.activateItem(survivingItem);
    centerPane.activateItem(closingItem);
    centerPane.activate();
    expect(controller.state.selectedCommitSha).toBe("second");

    await centerPane.destroyItem(closingItem);

    expect(lumine.workspace.getActivePaneItem()).toBe(survivingItem);
    expect(controller.state.selectedCommitSha).toBe("first");
  });
});
