/** @babel */
import RecentCommitsView from "../lib/views/recent-commits-view.js";
import { flushViews } from "./helpers/etch.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeCommit(sha) {
  return {
    getSha: () => sha,
    getMessageSubject: () => `Subject ${sha}`,
    getFullMessage: () => `Subject ${sha}`,
    getAuthorDate: () => 1700000000,
    getAuthor: () => ({ getEmail: () => "author@example.com", getAvatarUrl: () => null }),
    getCoAuthors: () => [],
  };
}

describe("recent commit history interactions", () => {
  let view, commits, clipboard, checkout, openCommit, selectCommit, undoLastCommit;

  beforeEach(async () => {
    commits = ["first", "second", "third"].map(makeCommit);
    clipboard = { write: jasmine.createSpy("write clipboard") };
    checkout = jasmine.createSpy("checkout commit");
    openCommit = jasmine.createSpy("open commit");
    undoLastCommit = jasmine.createSpy("undo last commit");
    selectCommit = jasmine
      .createSpy("select commit")
      .and.callFake((sha) => view.update({ ...view.props, selectedCommitSha: sha }));
    view = new RecentCommitsView({
      repository: {},
      commits,
      commands: lumine.commands,
      clipboard,
      checkout,
      openCommit,
      selectCommit,
      undoLastCommit,
      selectedCommitSha: "second",
      selectNextCommit: jasmine.createSpy("select next commit"),
      selectPreviousCommit: jasmine.createSpy("select previous commit"),
      selectFirstCommit: jasmine.createSpy("select first commit"),
      selectLastCommit: jasmine.createSpy("select last commit"),
    });
    jasmine.attachToDOM(view.element);
    await flushViews(async () => {});
  });

  afterEach(async () => {
    await view.destroy();
  });

  function messageFor(sha) {
    return view.element.querySelector(`[data-commit-sha="${sha}"] .git-panel-RecentCommit-message`);
  }

  function mouse(target, type, button) {
    const event = new MouseEvent(type, { button, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  }

  it("opens a clicked row as a pending preview without moving keyboard focus", () => {
    mouse(messageFor("third"), "click", 0);

    expect(openCommit).toHaveBeenCalledOnceWith({ sha: "third", preserveFocus: true });
  });

  it("opens a valid keyboard selection and supports the first and last row commands", () => {
    view.element.focus();
    lumine.commands.dispatch(view.element, "core:confirm");
    lumine.commands.dispatch(view.element, "core:move-to-top");
    lumine.commands.dispatch(view.element, "core:move-to-bottom");

    expect(openCommit).toHaveBeenCalledOnceWith({ sha: "second", preserveFocus: false });
    expect(view.props.selectFirstCommit).toHaveBeenCalledTimes(1);
    expect(view.props.selectLastCommit).toHaveBeenCalledTimes(1);
  });

  it("makes copy and checkout commands available at the focused history root", () => {
    view.element.focus();
    lumine.commands.dispatch(view.element, "git-panel:copy-commit-sha");
    lumine.commands.dispatch(view.element, "git-panel:copy-commit-subject");
    lumine.commands.dispatch(view.element, "git-panel:checkout-to-commit");

    expect(clipboard.write.calls.allArgs()).toEqual([["second"], ["Subject second"]]);
    expect(checkout).toHaveBeenCalledOnceWith("second");
  });

  it("acts on the command's target row when it differs from the keyboard selection", () => {
    const target = messageFor("third");
    lumine.commands.dispatch(target, "git-panel:copy-commit-sha");
    lumine.commands.dispatch(target, "git-panel:copy-commit-subject");
    lumine.commands.dispatch(target, "git-panel:checkout-to-commit");

    expect(clipboard.write.calls.allArgs()).toEqual([["third"], ["Subject third"]]);
    expect(checkout).toHaveBeenCalledOnceWith("third");
    expect(view.props.selectedCommitSha).toBe("second");
  });

  it("ignores empty and stale selections for opening, copying and checkout", async () => {
    for (const selectedCommitSha of ["", "missing"]) {
      await flushViews(() => view.update({ ...view.props, selectedCommitSha }));
      for (const command of [
        "core:confirm",
        "git-panel:dive",
        "git-panel:copy-commit-sha",
        "git-panel:copy-commit-subject",
        "git-panel:checkout-to-commit",
      ]) {
        lumine.commands.dispatch(view.element, command);
      }
    }

    expect(openCommit).not.toHaveBeenCalled();
    expect(clipboard.write).not.toHaveBeenCalled();
    expect(checkout).not.toHaveBeenCalled();
  });

  it("selects and focuses a right-clicked row while leaving its context menu enabled", async () => {
    const event = mouse(messageFor("third"), "mousedown", 2);
    await flushViews(async () => {});

    expect(event.defaultPrevented).toBe(false);
    expect(selectCommit).toHaveBeenCalledOnceWith("third");
    expect(document.activeElement).toBe(view.element);
    expect(messageFor("third").closest("li").classList.contains("is-selected")).toBe(true);
    expect(openCommit).not.toHaveBeenCalled();
  });

  it("selects a middle-clicked row without opening its commit", async () => {
    const target = messageFor("third");
    const event = mouse(target, "mousedown", 1);
    mouse(target, "click", 1);
    await flushViews(async () => {});

    expect(event.defaultPrevented).toBe(true);
    expect(selectCommit).toHaveBeenCalledOnceWith("third");
    expect(document.activeElement).toBe(view.element);
    expect(openCommit).not.toHaveBeenCalled();
  });

  it("keeps Undo mouse interactions separate from row selection and opening", () => {
    const button = view.element.querySelector(".git-panel-RecentCommit-undoButton");
    for (const buttonNumber of [0, 1, 2]) mouse(button, "mousedown", buttonNumber);
    mouse(button, "click", 0);

    expect(undoLastCommit).toHaveBeenCalledOnceWith();
    expect(selectCommit).not.toHaveBeenCalled();
    expect(openCommit).not.toHaveBeenCalled();
  });

  it("leaves Enter on the Undo button to its native button activation", () => {
    const button = view.element.querySelector(".git-panel-RecentCommit-undoButton");
    button.focus();
    lumine.commands.dispatch(button, "core:confirm");

    expect(openCommit).not.toHaveBeenCalled();
    expect(undoLastCommit).not.toHaveBeenCalled();
    const abortKeyBinding = jasmine.createSpy("abort Undo Enter binding");
    view.confirmSelectedCommit({ target: button, abortKeyBinding });
    expect(abortKeyBinding).toHaveBeenCalledTimes(1);
  });

  describe("loading older history", () => {
    const scrollEnd = { currentTarget: { scrollHeight: 500, scrollTop: 400, clientHeight: 100 } };
    let loadMore;

    beforeEach(async () => {
      loadMore = jasmine.createSpy("load more commits").and.resolveTo(false);
      await flushViews(() =>
        view.update({ ...view.props, hasMoreCommits: true, loadMoreCommits: loadMore }),
      );
    });

    it("releases a declined request so a later scroll can retry unchanged history", async () => {
      await view.loadMoreCommitsAtScrollEnd(scrollEnd);
      expect(loadMore).toHaveBeenCalledTimes(1);

      await view.loadMoreCommitsAtScrollEnd(scrollEnd);
      expect(loadMore).toHaveBeenCalledTimes(2);
    });

    it("releases a failed request without automatically retrying it", async () => {
      const error = new Error("Cannot load history");
      loadMore.and.rejectWith(error);

      await expectAsync(view.loadMoreCommitsAtScrollEnd(scrollEnd)).toBeRejectedWith(error);
      await globalThis.flushMicrotasks();
      expect(loadMore).toHaveBeenCalledTimes(1);

      loadMore.and.resolveTo(false);
      await view.loadMoreCommitsAtScrollEnd(scrollEnd);
      expect(loadMore).toHaveBeenCalledTimes(2);
    });

    it("prevents overlapping requests until the current load and render finish", async () => {
      const loading = deferred();
      loadMore.and.returnValue(loading.promise);
      const pending = view.loadMoreCommitsAtScrollEnd(scrollEnd);

      await flushViews(() =>
        view.update({ ...view.props, commits: [...commits, makeCommit("older")] }),
      );
      await view.loadMoreCommitsAtScrollEnd(scrollEnd);
      expect(loadMore).toHaveBeenCalledTimes(1);

      loading.resolve();
      await pending;
      loadMore.and.resolveTo(false);
      await view.loadMoreCommitsAtScrollEnd(scrollEnd);
      expect(loadMore).toHaveBeenCalledTimes(2);
    });

    it("does not let an old repository's completion unlock the new repository's request", async () => {
      const previousLoading = deferred();
      const currentLoading = deferred();
      loadMore.and.returnValues(previousLoading.promise, currentLoading.promise);
      const previous = view.loadMoreCommitsAtScrollEnd(scrollEnd);

      await flushViews(() => view.update({ ...view.props, repository: {} }));
      const current = view.loadMoreCommitsAtScrollEnd(scrollEnd);
      previousLoading.resolve();
      await previous;
      await view.loadMoreCommitsAtScrollEnd(scrollEnd);
      expect(loadMore).toHaveBeenCalledTimes(2);

      currentLoading.resolve();
      await current;
      loadMore.and.resolveTo(false);
      await view.loadMoreCommitsAtScrollEnd(scrollEnd);
      expect(loadMore).toHaveBeenCalledTimes(3);
    });
  });
});
