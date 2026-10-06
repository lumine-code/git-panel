/** @babel */
import { createViewModel } from "./helpers/etch";

import MultiFilePatchView from "../lib/views/multi-file-patch-view";
import StagingView from "../lib/views/staging-view";

const disposable = () => ({ dispose() {} });

function selectionFor(listKey, headItem) {
  return {
    getActiveListKey: () => listKey,
    getHeadItem: () => headItem,
  };
}

function populatedProps() {
  return {
    workingDirectoryPath: "C:\\repo",
    unstagedChanges: [{ filePath: "a.txt" }],
    stagedChanges: [],
    mergeConflicts: [],
  };
}

function buildPatchView(selectionMode) {
  const callbacks = {};
  const multiFilePatch = {
    getBufferRowForDiffPosition: jasmine.createSpy().and.returnValue(12),
    getMaxSelectionIndex: jasmine.createSpy().and.returnValue(3),
  };
  const view = createViewModel(MultiFilePatchView, {
    multiFilePatch,
    onWillUpdatePatch(callback) {
      callbacks.willUpdate = callback;
      return disposable();
    },
    onDidUpdatePatch(callback) {
      callbacks.didUpdate = callback;
      return disposable();
    },
    selectedRows: new Set([7]),
    selectionMode,
  });
  const element = {
    getComponent: () => component,
    getScrollLeft: jasmine.createSpy().and.returnValue(25),
    getScrollTop: jasmine.createSpy().and.returnValue(125),
    setScrollLeft: jasmine.createSpy(),
    setScrollTop: jasmine.createSpy(),
  };
  const component = { setScrollAnchor: jasmine.createSpy() };
  const editor = {
    getElement: () => element,
    scrollToBufferPosition: jasmine.createSpy(),
    setCursorBufferPosition: jasmine.createSpy(),
    setSelectedBufferRange: jasmine.createSpy(),
    setSelectedBufferRanges: jasmine.createSpy(),
    isSoftWrapped: () => true,
    isDestroyed: () => false,
  };
  view.refEditor.setter(editor);
  spyOn(view, "didChangeSelectedRows");

  return { callbacks, editor, element, multiFilePatch, view };
}

describe("scroll behavior", () => {
  describe("StagingView", () => {
    it("does not reveal the same logical item again after a list refresh", () => {
      const previousItem = { filePath: "same.txt" };
      const currentItem = { filePath: "same.txt" };
      const element = { scrollIntoViewIfNeeded: jasmine.createSpy() };
      const props = populatedProps();
      const view = Object.create(StagingView.prototype);
      view.props = props;
      view.state = { selection: selectionFor("unstaged", currentItem) };
      view.listElementsByItem = new WeakMap([[currentItem, element]]);

      view.didUpdate(props, {
        selection: selectionFor("unstaged", previousItem),
      });

      expect(element.scrollIntoViewIfNeeded).not.toHaveBeenCalled();
    });

    it("reveals a newly selected item at the nearest edge", () => {
      const previousItem = { filePath: "before.txt" };
      const currentItem = { filePath: "after.txt" };
      const element = { scrollIntoViewIfNeeded: jasmine.createSpy() };
      const props = populatedProps();
      const view = Object.create(StagingView.prototype);
      view.props = props;
      view.state = { selection: selectionFor("unstaged", currentItem) };
      view.listElementsByItem = new WeakMap([[currentItem, element]]);

      view.didUpdate(props, {
        selection: selectionFor("unstaged", previousItem),
      });

      expect(element.scrollIntoViewIfNeeded).toHaveBeenCalledOnceWith(false);
    });

    it("reveals the same file when selection moves to a different staging list", () => {
      const previousItem = { filePath: "same.txt" };
      const currentItem = { filePath: "same.txt" };
      const element = { scrollIntoViewIfNeeded: jasmine.createSpy() };
      const props = populatedProps();
      const view = Object.create(StagingView.prototype);
      view.props = props;
      view.state = { selection: selectionFor("staged", currentItem) };
      view.listElementsByItem = new WeakMap([[currentItem, element]]);

      view.didUpdate(props, {
        selection: selectionFor("unstaged", previousItem),
      });

      expect(element.scrollIntoViewIfNeeded).toHaveBeenCalledOnceWith(false);
    });

    it("uses standard nearest-edge scrolling when scrollIntoViewIfNeeded is unavailable", () => {
      const previousItem = { filePath: "before.txt" };
      const currentItem = { filePath: "after.txt" };
      const element = { scrollIntoView: jasmine.createSpy() };
      const props = populatedProps();
      const view = Object.create(StagingView.prototype);
      view.props = props;
      view.state = { selection: selectionFor("unstaged", currentItem) };
      view.listElementsByItem = new WeakMap([[currentItem, element]]);

      view.didUpdate(props, {
        selection: selectionFor("unstaged", previousItem),
      });

      expect(element.scrollIntoView).toHaveBeenCalledOnceWith({ block: "nearest" });
    });
  });

  describe("MultiFilePatchView", () => {
    const views = [];

    afterEach(() => {
      while (views.length > 0) {
        const view = views.pop();
        view.fullWidthHeaders.dispose();
        view.subs.dispose();
      }
    });

    it("restores a line selection without overriding the saved viewport", () => {
      const { callbacks, editor, element, multiFilePatch, view } = buildPatchView("line");
      views.push(view);
      const nextRange = [
        [8, 0],
        [8, Infinity],
      ];
      const nextPatch = {
        getBuffer: () => ({ isEmpty: () => false }),
        getSelectionRangeForIndex: jasmine.createSpy().and.returnValue(nextRange),
      };

      callbacks.willUpdate();
      callbacks.didUpdate(nextPatch);

      expect(multiFilePatch.getMaxSelectionIndex).toHaveBeenCalledWith(view.props.selectedRows);
      expect(editor.setSelectedBufferRange).toHaveBeenCalledOnceWith(nextRange, {
        autoscroll: false,
      });
      expect(element.setScrollTop).toHaveBeenCalledOnceWith(125);
      expect(element.setScrollLeft).toHaveBeenCalledOnceWith(25);
    });

    it("restores a hunk selection without overriding the saved viewport", () => {
      const { callbacks, editor, view } = buildPatchView("hunk");
      views.push(view);
      const nextRange = [
        [8, 0],
        [8, Infinity],
      ];
      const hunkRange = [
        [7, 0],
        [9, 0],
      ];
      const hunk = { getRange: () => hunkRange };
      const nextPatch = {
        getBuffer: () => ({ isEmpty: () => false }),
        getHunkAt: jasmine.createSpy().and.returnValue(hunk),
        getSelectionRangeForIndex: jasmine.createSpy().and.returnValue(nextRange),
      };

      callbacks.willUpdate();
      callbacks.didUpdate(nextPatch);

      expect(editor.setSelectedBufferRanges).toHaveBeenCalledOnceWith([hunkRange], {
        autoscroll: false,
      });
    });

    it("resets the viewport when a refresh collapses all diff content", () => {
      const { callbacks, element, view } = buildPatchView("hunk");
      views.push(view);
      const nextPatch = {
        getBuffer: () => ({ isEmpty: () => true }),
        getHunkAt: jasmine.createSpy().and.returnValue(undefined),
        getSelectionRangeForIndex: jasmine.createSpy().and.returnValue([
          [0, 0],
          [0, 0],
        ]),
      };

      callbacks.willUpdate();
      callbacks.didUpdate(nextPatch);

      expect(element.setScrollTop).toHaveBeenCalledOnceWith(0);
      expect(element.setScrollLeft).toHaveBeenCalledOnceWith(0);
    });

    it("waits for refreshed patch props before synchronizing selected rows", () => {
      const { callbacks, view } = buildPatchView("line");
      views.push(view);
      const previousProps = view.props;
      const nextPatch = {
        getBuffer: () => ({ isEmpty: () => false }),
        getSelectionRangeForIndex: jasmine.createSpy().and.returnValue([
          [8, 0],
          [8, Infinity],
        ]),
      };

      callbacks.willUpdate();
      callbacks.didUpdate(nextPatch);

      expect(view.didChangeSelectedRows).not.toHaveBeenCalled();

      view.didUpdate(previousProps);
      expect(view.didChangeSelectedRows).not.toHaveBeenCalled();
      expect(view.nextSelectionMode).toBe("line");

      const unrelatedProps = { ...previousProps, multiFilePatch: {} };
      view.props = unrelatedProps;
      view.didUpdate(previousProps);
      expect(view.didChangeSelectedRows).not.toHaveBeenCalled();
      expect(view.nextSelectionMode).toBe("line");

      view.props = { ...unrelatedProps, multiFilePatch: nextPatch };
      view.didUpdate(unrelatedProps);

      expect(view.didChangeSelectedRows).toHaveBeenCalledTimes(1);
      expect(view.nextSelectionMode).toBeNull();
      expect(view.pendingViewport).toBeNull();
    });

    it("keeps an explicit centered scroll authoritative when jumping to a file", () => {
      const { editor, multiFilePatch, view } = buildPatchView("hunk");
      views.push(view);

      view.scrollToFile({ changedFilePath: "file.txt", changedFilePosition: 4 });

      expect(multiFilePatch.getBufferRowForDiffPosition).toHaveBeenCalledOnceWith("file.txt", 4);
      expect(editor.setCursorBufferPosition).toHaveBeenCalledOnceWith(
        { row: 12, column: 0 },
        { autoscroll: false },
      );
      expect(editor.scrollToBufferPosition).toHaveBeenCalledOnceWith(
        { row: 12, column: 0 },
        { center: true },
      );
      expect(editor.setCursorBufferPosition.calls.first().invocationOrder).toBeLessThan(
        editor.scrollToBufferPosition.calls.first().invocationOrder,
      );
    });
  });
});
