/** @babel */
import StagingView from "../lib/views/staging-view";
import RecentCommitsView, { RecentCommitView } from "../lib/views/recent-commits-view";

describe("middle-click list selection", () => {
  it("selects unstaged and staged items without starting the normal mouse action", async () => {
    for (const listKey of ["unstaged", "staged"]) {
      const item = { filePath: `${listKey}.txt` };
      const nextSelection = {};
      const selection = {
        listKeyForItem: jasmine.createSpy().and.returnValue(listKey),
        selectItem: jasmine.createSpy().and.returnValue(nextSelection),
      };
      const focus = jasmine.createSpy();
      const view = {
        state: { selection },
        mouseSelectionInProgress: false,
        refRoot: {
          map(callback) {
            callback({ focus });
          },
        },
        setState(update, callback) {
          this.state = { ...this.state, ...update(this.state) };
          callback();
        },
      };
      const event = {
        button: 1,
        ctrlKey: false,
        preventDefault: jasmine.createSpy(),
        stopPropagation: jasmine.createSpy(),
      };

      await StagingView.prototype.mousedownOnItem.call(view, event, item);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
      expect(selection.selectItem).toHaveBeenCalledWith(item);
      expect(view.state.selection).toBe(nextSelection);
      expect(view.mouseSelectionInProgress).toBe(false);
      expect(focus).toHaveBeenCalled();
    }
  });

  it("selects and focuses a recent commit without opening it", () => {
    const view = Object.create(RecentCommitsView.prototype);
    const selectCommit = jasmine.createSpy();
    view.props = { selectCommit };
    view.setFocus = jasmine.createSpy();
    const commit = { getSha: () => "abc123" };
    const event = {
      button: 1,
      preventDefault: jasmine.createSpy(),
      stopPropagation: jasmine.createSpy(),
    };

    view.mousedownOnCommit(event, commit);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(selectCommit).toHaveBeenCalledWith("abc123");
    expect(view.setFocus).toHaveBeenCalledWith(RecentCommitsView.focus.RECENT_COMMIT);
  });

  it("only opens a recent commit from a primary click", () => {
    const openCommit = jasmine.createSpy();
    const view = { props: { openCommit } };
    const middleClick = {
      button: 1,
      preventDefault: jasmine.createSpy(),
      stopPropagation: jasmine.createSpy(),
    };

    RecentCommitView.prototype.clickCommit.call(view, middleClick);
    expect(openCommit).not.toHaveBeenCalled();

    RecentCommitView.prototype.clickCommit.call(view, { button: 0 });
    expect(openCommit).toHaveBeenCalled();
  });
});
