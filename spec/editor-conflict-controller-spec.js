/** @babel */
import { createViewModel } from "./helpers/etch.js";

import EditorConflictController from "../lib/controllers/editor-conflict-controller.js";
import { BASE } from "../lib/models/conflicts/source.js";
import { TextBuffer } from "lumine";

class TestPoint {
  constructor(value) {
    this.value = value;
  }

  compare(other) {
    return this.value - other.value;
  }

  isLessThan(other) {
    return this.compare(other) < 0;
  }
}

describe("EditorConflictController", () => {
  it("clears conflict analysis for None and resumes when a grammar returns", async () => {
    const pkg = await lumine.packages.activatePackage("language-text");
    await pkg.resourceLoadPromise;
    const editor = lumine.workspace.buildTextEditor();
    const grammar = lumine.grammars.grammarForId("text.plain");
    editor.setGrammar(grammar);
    editor.setText("<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n");
    const resolutionProgress = {
      reportBufferMarkerCount: jasmine.createSpy("reportBufferMarkerCount"),
      clearBuffer: jasmine.createSpy("clearBuffer"),
    };
    const controller = createViewModel(EditorConflictController, {
      editor,
      isRebase: false,
      resolutionProgress,
      refreshResolutionProgress() {},
    });
    controller.updateState = (state) => {
      Object.assign(controller.state, state);
      controller.updateMarkerCount();
    };
    controller.didMount();
    try {
      expect(controller.state.conflicts.size).toBe(1);
      const scan = spyOn(editor.getBuffer(), "getTextSnapshotInRange").and.callThrough();
      resolutionProgress.reportBufferMarkerCount.calls.reset();
      editor.setGrammar(lumine.grammars.nullGrammar);
      expect(controller.state.conflicts.size).toBe(0);
      expect(controller.layer.getMarkerCount()).toBe(0);
      expect(resolutionProgress.clearBuffer).toHaveBeenCalled();
      expect(resolutionProgress.reportBufferMarkerCount).not.toHaveBeenCalled();
      expect(scan).not.toHaveBeenCalled();
      editor.setGrammar(grammar);
      expect(scan).toHaveBeenCalled();
      expect(controller.state.conflicts.size).toBe(1);
    } finally {
      controller.willDestroy();
      editor.destroy();
    }
  });

  it("owns a private marker layer and scopes commands to its editor element", () => {
    const layer = {
      clear: jasmine.createSpy("clear"),
      destroy: jasmine.createSpy("destroy"),
    };
    const element = document.createElement("lumine-text-editor");
    const buffer = new TextBuffer();
    const editor = {
      addMarkerLayer: jasmine.createSpy("addMarkerLayer").and.returnValue(layer),
      getElement: () => element,
      getBuffer: () => buffer,
      getPath: () => "conflicted.txt",
      getFileState: () => "unmodified",
    };
    const resolutionProgress = {
      reportBufferMarkerCount: jasmine.createSpy("reportBufferMarkerCount"),
      clearBuffer: jasmine.createSpy("clearBuffer"),
    };
    const refreshResolutionProgress = jasmine.createSpy("refreshResolutionProgress");

    const controller = createViewModel(EditorConflictController, {
      editor,
      isRebase: false,
      resolutionProgress,
      refreshResolutionProgress,
    });

    expect(editor.addMarkerLayer).toHaveBeenCalledWith({
      maintainHistory: true,
      persistent: false,
    });
    expect(controller.commandTarget).toBe(element);

    controller.willDestroy();
    buffer.destroy();
    expect(layer.destroy).toHaveBeenCalled();
    expect(resolutionProgress.clearBuffer).toHaveBeenCalledWith("conflicted.txt");
  });

  it("finds a conflict when the cursor is exactly at its starting position", () => {
    const start = new TestPoint(10);
    const end = new TestPoint(20);
    const side = {};
    const conflict = {
      getRange: () => ({ start, end }),
      includesPoint: (point) => point.compare(start) >= 0 && point.compare(end) < 0,
      getSideContaining: () => side,
    };
    const controller = Object.create(EditorConflictController.prototype);
    controller.props = {
      editor: { getCursorBufferPositions: () => [new TestPoint(10)] },
    };
    controller.state = { conflicts: new Set([conflict]) };

    expect(controller.getCurrentConflicts()).toEqual([{ conflict, sides: new Set([side]) }]);
  });

  it("ignores a base resolution command when the conflict has no base side", () => {
    const controller = Object.create(EditorConflictController.prototype);
    controller.props = { editor: { transact: jasmine.createSpy("transact") } };
    const conflict = { getSide: () => undefined };

    expect(controller.resolveAsSequence(conflict, [BASE])).toBe(false);
    expect(controller.props.editor.transact).not.toHaveBeenCalled();
  });

  it("keeps dismissed conflicts in the unresolved marker count", () => {
    const conflict = { isResolved: () => false };
    const reportBufferMarkerCount = jasmine.createSpy("reportBufferMarkerCount");
    const controller = Object.create(EditorConflictController.prototype);
    controller.props = {
      editor: { getPath: () => "conflicted.txt", getFileState: () => "unmodified" },
      resolutionProgress: { reportBufferMarkerCount },
    };
    controller.state = {
      conflicts: new Set([conflict]),
      dismissedConflicts: new Set(),
    };
    controller.updateState = (updater) => {
      controller.state = { ...controller.state, ...updater(controller.state) };
    };

    controller.dismissConflicts([conflict]);
    controller.updateMarkerCount();

    expect(controller.state.dismissedConflicts.has(conflict)).toBe(true);
    expect(reportBufferMarkerCount).toHaveBeenCalledWith("conflicted.txt", 1, {
      modified: false,
    });
  });
});
