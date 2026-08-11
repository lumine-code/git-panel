/** @babel */

import EditorConflictController from "../lib/controllers/editor-conflict-controller";
import { BASE } from "../lib/models/conflicts/source";

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
  it("owns a private marker layer and scopes commands to its editor element", () => {
    const layer = {
      clear: jasmine.createSpy("clear"),
      destroy: jasmine.createSpy("destroy"),
    };
    const element = document.createElement("lumine-text-editor");
    const buffer = { scan: jasmine.createSpy("scan") };
    const editor = {
      addMarkerLayer: jasmine.createSpy("addMarkerLayer").and.returnValue(layer),
      getElement: () => element,
      getBuffer: () => buffer,
      getPath: () => "conflicted.txt",
      isModified: () => false,
    };
    const resolutionProgress = {
      reportBufferMarkerCount: jasmine.createSpy("reportBufferMarkerCount"),
      clearBuffer: jasmine.createSpy("clearBuffer"),
    };
    const refreshResolutionProgress = jasmine.createSpy("refreshResolutionProgress");

    const controller = new EditorConflictController({
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

    controller.componentWillUnmount();
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
      editor: { getPath: () => "conflicted.txt", isModified: () => false },
      resolutionProgress: { reportBufferMarkerCount },
    };
    controller.state = {
      conflicts: new Set([conflict]),
      dismissedConflicts: new Set(),
    };
    controller.setState = (updater) => {
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
