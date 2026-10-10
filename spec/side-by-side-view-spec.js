/** @babel */
import path from "path";
import { Disposable, Emitter, Range } from "lumine";
import MultiFilePatchView from "../lib/views/multi-file-patch-view";
import { buildMultiFilePatch } from "../lib/models/patch";
import { flushViews } from "./helpers/etch";

function hunk(lines, oldStartLine = 1, newStartLine = oldStartLine) {
  return {
    oldStartLine,
    oldLineCount: lines.filter((line) => line[0] !== "+").length,
    newStartLine,
    newLineCount: lines.filter((line) => line[0] !== "-").length,
    heading: "",
    lines,
  };
}

function diff(hunks) {
  return {
    oldPath: "example.txt",
    newPath: "example.txt",
    oldMode: "100644",
    newMode: "100644",
    status: "modified",
    hunks,
  };
}

function exampleDiff() {
  return diff([
    hunk([" before", "-old value", "+new value", " after"]),
    hunk(["-old later", "+new later"], 20),
  ]);
}

describe("mounted side-by-side diff view", () => {
  let view;
  let container;
  let stylesheet;
  let publication;
  let nextSelection;
  const patches = [];

  function build(raw = exampleDiff(), options = {}) {
    const patch = buildMultiFilePatch([raw], { largeDiffThreshold: Infinity, ...options });
    patches.push(patch);
    return patch;
  }

  beforeEach(() => {
    publication = new Emitter();
    nextSelection = null;
    stylesheet = lumine.themes.requireStylesheet(path.join(__dirname, "..", "styles", "main.css"));
    container = document.createElement("div");
    container.style.cssText = "display: flex; width: 1000px; height: 320px;";
    jasmine.attachToDOM(container);
  });

  afterEach(async () => {
    await view?.destroy();
    view = null;
    while (patches.length) patches.pop().dispose();
    publication.dispose();
    container.remove();
    stylesheet.dispose();
  });

  async function settleSelection() {
    await flushViews(async () => {});
    if (nextSelection) {
      const selection = nextSelection;
      nextSelection = null;
      await flushViews(() => view.update({ ...view.props, ...selection }));
    }
  }

  async function mount(raw = exampleDiff(), options) {
    const patch = build(raw, options);
    view = new MultiFilePatchView({
      multiFilePatch: patch,
      surfaceKind: "file",
      workspace: lumine.workspace,
      commands: lumine.commands,
      config: lumine.config,
      keymaps: lumine.keymaps,
      tooltips: { add: () => new Disposable(), addComposite: () => new Disposable() },
      stagingStatus: "unstaged",
      selectedRows: new Set(),
      selectionMode: "hunk",
      selectedRowsChanged: jasmine
        .createSpy("selected diff rows")
        .and.callFake((rows, mode, multiple) => {
          nextSelection = {
            selectedRows: rows,
            selectionMode: mode,
            hasMultipleFileSelections: multiple,
          };
        }),
      toggleRows: jasmine.createSpy("stage selected rows"),
      discardRows: jasmine.createSpy("discard selected rows"),
      toggleFile: () => {},
      toggleModeChange: () => {},
      toggleSymlinkChange: () => {},
      openFile: jasmine.createSpy("jump to selected file"),
      surface: () => {},
      undoLastDiscard: () => {},
      diveIntoMirrorPatch: () => {},
      onWillUpdatePatch: (callback) => publication.on("will-update", callback),
      onDidUpdatePatch: (callback) => publication.on("did-update", callback),
    });
    container.appendChild(view.element);
    await settleSelection();
    return patch;
  }

  function pair() {
    return view.refSideBySide.get();
  }

  function editor(side) {
    return pair().editors[side].get();
  }

  async function layout(mode) {
    await flushViews(() => view.didChangeDiffView(mode));
    await settleSelection();
  }

  async function renderEditors() {
    await flushViews(async () => {});
    const elements = Array.from(view.element.querySelectorAll("lumine-text-editor"));
    const updates = elements.map((element) => element.getNextUpdatePromise());
    for (const element of elements) element.getComponent().scheduleUpdate();
    await Promise.all(updates);
  }

  it("defaults to unified and switches into two read-only native editors", async () => {
    const patch = await mount();
    expect(view.state.diffView).toBe("unified");
    expect(view.element.querySelectorAll("lumine-text-editor").length).toBe(1);
    expect(view.refEditor.get().getBuffer()).toBe(patch.getBuffer());
    expect(view.element.querySelector('[data-diff-view="side-by-side"]')).toBeNull();
    await layout("side-by-side");
    expect(view.state.diffView).toBe("side-by-side");
    expect(view.element.querySelectorAll("lumine-text-editor").length).toBe(2);
    expect(editor("old").getText()).toBe("before\nold value\nafter\nold later");
    expect(editor("new").getText()).toBe("before\nnew value\nafter\nnew later");
    for (const side of ["old", "new"]) {
      expect(editor(side).isReadOnly()).toBe(true);
      expect(editor(side).isSoftWrapped()).toBe(true);
    }
    expect(view.element.querySelector(".git-panel-SideBySidePatchView-toolbar")).toBeNull();
  });

  for (const [side, canonicalRow, included, excluded] of [
    ["old", 1, "-old value", "+new value"],
    ["new", 2, "+new value", "-old value"],
  ]) {
    it(`stages just the chosen ${side} changed line using the canonical patch row`, async () => {
      const patch = await mount();
      await layout("side-by-side");
      editor(side).setSelectedBufferRange(
        [
          [1, 0],
          [1, Infinity],
        ],
        { autoscroll: false },
      );
      await settleSelection();
      expect(Array.from(view.props.selectedRows)).toEqual([canonicalRow]);
      expect(view.props.selectionMode).toBe("line");
      lumine.commands.dispatch(editor(side).getElement(), "core:confirm");
      expect(view.props.toggleRows).toHaveBeenCalledWith(new Set([canonicalRow]), "line");
      const staged = patch.getStagePatchForLines(view.props.toggleRows.calls.mostRecent().args[0]);
      patches.push(staged);
      expect(staged.toString()).toContain(included);
      expect(staged.toString()).not.toContain(excluded);
    });
  }

  it("preserves disjoint canonical selections while switching layouts in both directions", async () => {
    await mount();
    const selected = [new Range([1, 0], [1, Infinity]), new Range([5, 0], [5, Infinity])];
    view.refEditor.get().setSelectedBufferRanges(selected, { autoscroll: false });
    await settleSelection();
    const expected = view.getCanonicalSelectionRanges().map((range) => range.serialize());
    await layout("side-by-side");
    expect(view.getCanonicalSelectionRanges().map((range) => range.serialize())).toEqual(expected);
    expect(Array.from(view.props.selectedRows)).toEqual([1, 5]);
    await layout("unified");
    expect(
      view.refEditor
        .get()
        .getSelectedBufferRanges()
        .map((range) => range.serialize()),
    ).toEqual(expected);
    expect(Array.from(view.props.selectedRows)).toEqual([1, 5]);
  });

  it("navigates hunks and switches hunk or line selection through the registered commands", async () => {
    const patch = await mount();
    const [first, second] = patch.getFilePatches()[0].getHunks();
    await layout("side-by-side");
    lumine.commands.dispatch(editor("new").getElement(), "git-panel:select-next-hunk");
    await settleSelection();
    expect(view.getSelectedHunks()).toEqual([second]);
    expect(Array.from(view.props.selectedRows)).toEqual([4, 5]);
    expect(view.props.selectionMode).toBe("hunk");
    lumine.commands.dispatch(editor("old").getElement(), "git-panel:select-previous-hunk");
    await settleSelection();
    expect(view.getSelectedHunks()).toEqual([first]);
    expect(Array.from(view.props.selectedRows)).toEqual([1, 2]);
    lumine.commands.dispatch(editor("old").getElement(), "git-panel:toggle-patch-selection-mode");
    await settleSelection();
    expect(view.props.selectionMode).toBe("line");
    expect(Array.from(view.props.selectedRows)).toEqual([1]);
    lumine.commands.dispatch(editor("old").getElement(), "git-panel:toggle-patch-selection-mode");
    await settleSelection();
    expect(view.props.selectionMode).toBe("hunk");
    expect(Array.from(view.props.selectedRows)).toEqual([1, 2]);
  });

  it("keeps word highlights attached to the changed words on their respective side", async () => {
    await mount();
    await layout("side-by-side");
    for (const [side, kind, word] of [
      ["old", "deleted", "old"],
      ["new", "added", "new"],
    ]) {
      const highlights = editor(side).getHighlightDecorations({
        class: `git-panel-FilePatchView-word--${kind}`,
      });
      expect(highlights.length).toBeGreaterThan(0);
      const words = highlights.map((decoration) =>
        editor(side).getTextInBufferRange(decoration.getMarker().getBufferRange()),
      );
      expect(words).toContain(word);
      expect(
        editor(side).getHighlightDecorations({
          class: `git-panel-FilePatchView-word--${kind === "added" ? "deleted" : "added"}`,
        }).length,
      ).toBe(0);
    }
  });

  for (const [side, expected] of [
    ["old", [0, 1]],
    ["new", [2, 3]],
  ]) {
    it(`extends ${side} gutter selections without adding changed rows from the opposite side`, async () => {
      await mount(diff([hunk(["-old one", "-old two", "+new one", "+new two"])]));
      await layout("side-by-side");
      pair().didMouseDownOnLineNumber(side, {
        bufferRow: 0,
        domEvent: new MouseEvent("mousedown", { button: 0 }),
      });
      await settleSelection();
      pair().didMouseDownOnLineNumber(side, {
        bufferRow: 1,
        domEvent: new MouseEvent("mousedown", { button: 0, shiftKey: true }),
      });
      await settleSelection();
      expect(Array.from(view.props.selectedRows)).toEqual(expected);
      expect(view.props.selectionMode).toBe("line");
      pair().didMouseDownOnLineNumber(side, {
        bufferRow: 0,
        domEvent: new MouseEvent("mousedown", { button: 0 }),
      });
      pair().didMouseMoveOnLineNumber(side, {
        bufferRow: 1,
        domEvent: new MouseEvent("mousemove", { buttons: 1 }),
      });
      await settleSelection();
      expect(Array.from(view.props.selectedRows)).toEqual(expected);
    });
  }

  it("moves to the present editor when hunk navigation reaches a deletion-only hunk", async () => {
    const patch = await mount(diff([hunk(["-old", "+new"]), hunk(["-deleted later"], 20)]));
    await layout("side-by-side");
    lumine.commands.dispatch(editor("new").getElement(), "git-panel:select-next-hunk");
    await settleSelection();
    expect(view.getSelectedHunks()).toEqual([patch.getFilePatches()[0].getHunks()[1]]);
    expect(Array.from(view.props.selectedRows)).toEqual([2]);
    expect(pair().activeSide).toBe("old");
    expect(
      pair()
        .getCanonicalCursorPositions()
        .every((position) => position.row === 2),
    ).toBe(true);
  });

  it("keeps a focused deletion selection on its present side and jumps to the corresponding file line", async () => {
    const patch = await mount(diff([hunk(["-old", "+new"]), hunk(["-deleted later"], 20)]));
    const unifiedEditor = view.refEditor.get();
    unifiedEditor.setSelectedBufferRange(
      [
        [2, 0],
        [2, Infinity],
      ],
      { autoscroll: false },
    );
    unifiedEditor.getElement().focus();
    await settleSelection();
    await layout("side-by-side");
    expect(pair().activeSide).toBe("old");
    expect(editor("old").getElement().contains(document.activeElement)).toBe(true);
    lumine.commands.dispatch(editor("old").getElement(), "git-panel:jump-to-file");
    expect(view.props.openFile).toHaveBeenCalledWith(patch.getFilePatches()[0], [[19, 0]], true);
  });

  it("loads a collapsed diff through its button and refreshes a collapsed model in place", async () => {
    const patch = await mount(exampleDiff(), { largeDiffThreshold: 0 });
    await layout("side-by-side");
    expect(editor("old").getText()).toBe("");
    expect(editor("new").getText()).toBe("");
    const button = view.element.querySelector(".git-panel-FilePatchView-showDiffButton");
    expect(button).not.toBeNull();
    await flushViews(() => button.click());
    await settleSelection();
    expect(editor("old").getText()).toBe("before\nold value\nafter\nold later");
    expect(editor("new").getText()).toBe("before\nnew value\nafter\nnew later");
    patch.collapseFilePatch(patch.getFilePatches()[0]);
    await flushViews(() => view.update({ ...view.props }));
    await settleSelection();
    expect(editor("old").getText()).toBe("");
    expect(editor("new").getText()).toBe("");
    expect(pair().projection.hunkRanges.size).toBe(0);
  });

  it("aligns corresponding native rows and block headers at a narrow pane width", async () => {
    container.style.width = "700px";
    await mount();
    await layout("side-by-side");
    await renderEditors();
    await renderEditors();
    const oldElement = editor("old").getElement();
    const newElement = editor("new").getElement();
    const oldColumn = view.element.querySelector('[data-diff-side="old"]');
    const newColumn = view.element.querySelector('[data-diff-side="new"]');
    expect(oldColumn.getBoundingClientRect().width).toBeCloseTo(
      newColumn.getBoundingClientRect().width,
      0,
    );
    for (let row = 0; row < pair().projection.rows.length; row++) {
      expect(oldElement.pixelPositionForBufferPosition([row, 0]).top).toBeCloseTo(
        newElement.pixelPositionForBufferPosition([row, 0]).top,
        0,
      );
    }
    expect(oldElement.pixelPositionForBufferPosition([3, 0]).top).toBeGreaterThan(
      oldElement.pixelPositionForBufferPosition([1, 0]).top,
    );
  });

  it("keeps long lines unwrapped and synchronizes horizontal scrolling", async () => {
    const oldPrefix = "a".repeat(2000);
    const newPrefix = "a".repeat(3000);
    container.style.width = "700px";
    await mount(diff([hunk([`-${oldPrefix} old`, `+${newPrefix} new`, " after"])]));
    await layout("side-by-side");
    for (const side of ["old", "new"]) {
      editor(side).setSoftWrapped(false);
      editor(side).update({ maxScreenLineLength: Infinity });
    }
    await renderEditors();
    const oldElement = editor("old").getElement();
    const newElement = editor("new").getElement();
    for (const side of ["old", "new"]) {
      expect(editor(side).getScreenLineCount()).toBe(2);
      expect(editor(side).getElement().getScrollWidth()).toBeGreaterThan(
        editor(side).getElement().getWidth(),
      );
    }
    oldElement.setScrollLeft(180);
    await renderEditors();
    expect(newElement.getScrollLeft()).toBe(180);
    expect(oldElement.pixelPositionForBufferPosition([1, 0]).top).toBeCloseTo(
      newElement.pixelPositionForBufferPosition([1, 0]).top,
      0,
    );
  });

  it("decorates an empty added final line and its aligned placeholder", async () => {
    await mount(diff([hunk(["-old", "+new", "+"])]));
    await layout("side-by-side");
    const addition = editor("new")
      .getLineDecorations()
      .find(
        (decoration) =>
          decoration.getProperties().class.includes("git-panel-FilePatchView-line--added") &&
          decoration.getMarker().getBufferRange().intersectsRow(1),
      );
    const placeholder = editor("old")
      .getLineDecorations()
      .find(
        (decoration) =>
          decoration.getProperties().class.includes("git-panel-SideBySidePatchView-placeholder") &&
          decoration.getMarker().getBufferRange().intersectsRow(1),
      );
    expect(addition).toBeDefined();
    expect(placeholder).toBeDefined();
    expect(addition.getProperties().omitEmptyLastRow).toBe(false);
    expect(placeholder.getProperties().omitEmptyLastRow).toBe(false);
  });

  it("uses one right scrollbar for both columns and synchronizes scrolling from either editor", async () => {
    const unchanged = Array.from({ length: 80 }, (_, index) => ` context ${index}`);
    await mount(diff([hunk(["-old", "+new", ...unchanged])]));
    await layout("side-by-side");
    const oldElement = editor("old").getElement();
    const newElement = editor("new").getElement();
    oldElement.setHeight(180);
    newElement.setHeight(180);
    await Promise.all([oldElement.getNextUpdatePromise(), newElement.getNextUpdatePromise()]);
    await renderEditors();
    expect(oldElement.getMaxScrollTop()).toBeGreaterThan(240);
    expect(newElement.getMaxScrollTop()).toBeGreaterThan(240);
    const oldScrollbar = oldElement.querySelector(".vertical-scrollbar");
    const sharedScrollbar = newElement.querySelector(".vertical-scrollbar");
    const visibleScrollbars = Array.from(
      view.element.querySelectorAll(".vertical-scrollbar"),
    ).filter((scrollbar) => getComputedStyle(scrollbar).visibility !== "hidden");
    expect(getComputedStyle(oldScrollbar).visibility).toBe("hidden");
    expect(visibleScrollbars).toEqual([sharedScrollbar]);
    expect(sharedScrollbar.getBoundingClientRect().right).toBeCloseTo(
      newElement.getBoundingClientRect().right,
      0,
    );
    oldElement.setScrollTop(120);
    await renderEditors();
    expect(oldElement.getScrollTop()).toBe(120);
    expect(newElement.getScrollTop()).toBe(120);
    expect(sharedScrollbar.scrollTop).toBe(120);
    newElement.setScrollTop(240);
    await renderEditors();
    expect(newElement.getScrollTop()).toBe(240);
    expect(oldElement.getScrollTop()).toBe(240);
    expect(sharedScrollbar.scrollTop).toBe(240);
    sharedScrollbar.scrollTop = 360;
    sharedScrollbar.dispatchEvent(new Event("scroll"));
    await renderEditors();
    expect(newElement.getScrollTop()).toBe(360);
    expect(oldElement.getScrollTop()).toBe(360);
    sharedScrollbar.scrollTop = sharedScrollbar.scrollHeight;
    sharedScrollbar.dispatchEvent(new Event("scroll"));
    await renderEditors();
    expect(newElement.getScrollTop()).toBe(newElement.getMaxScrollTop());
    expect(oldElement.getScrollTop()).toBe(oldElement.getMaxScrollTop());
    container.style.height = "420px";
    oldElement.style.height = "100%";
    newElement.style.height = "100%";
    await renderEditors();
    await renderEditors();
    // Forced paints can finish before ResizeObserver delivers the new height.
    // Compare extents only after both native editors measure that input size.
    await globalThis.waitForFrames(
      () =>
        [oldElement, newElement].every((element) => {
          const component = element.getComponent();
          return (
            component.getClientContainerHeight() === component.refs.clientContainer.offsetHeight
          );
        }),
      { description: "both diff editors to measure the resized viewport" },
    );
    expect(sharedScrollbar.scrollHeight - sharedScrollbar.clientHeight).toBe(
      newElement.getMaxScrollTop(),
    );
    expect(newElement.getMaxScrollTop()).toBe(oldElement.getMaxScrollTop());
  });

  it("paints both columns in each smooth wheel frame when gestures reverse and cross the divider", async () => {
    const unchanged = Array.from(
      { length: 300 },
      (_, index) => ` context ${index} ${"x".repeat(400)}`,
    );
    await mount(diff([hunk(["-old", "+new", ...unchanged])]));
    await layout("side-by-side");
    for (const side of ["old", "new"]) editor(side).setSoftWrapped(false);
    for (const side of ["old", "new"])
      editor(side).update({
        smoothScrolling: true,
        wheelScrollDuration: 120,
        wheelScrollMultiplier: 1.2,
      });
    await renderEditors();
    const oldComponent = editor("old").getElement().getComponent();
    const newComponent = editor("new").getElement().getComponent();
    for (const component of [oldComponent, newComponent]) {
      // Jasmine defaults editors to synchronous updates; production schedules
      // them. Use the real scheduling mode so a follower frame delay is visible.
      component.element.setUpdatedSynchronously(false);
      component.scrollAnimator.raf = () => 0;
      component.scrollAnimator.caf = () => {};
    }
    const assertAlignedFrame = () => {
      expect(oldComponent.getScrollTop()).toBe(newComponent.getScrollTop());
      expect(oldComponent.getScrollLeft()).toBe(newComponent.getScrollLeft());
      expect(oldComponent.renderedScrollTop).toBe(newComponent.renderedScrollTop);
      expect(oldComponent.renderedScrollLeft).toBe(newComponent.renderedScrollLeft);
      expect(oldComponent.refs.content.style.transform).toBe(
        newComponent.refs.content.style.transform,
      );
    };
    for (const [side, deltaX, deltaY] of [
      ["old", 40, 600],
      ["new", 40, 600],
      ["old", -30, -900],
      ["new", -30, -600],
      ["old", 80, 1600],
      ["new", -40, -700],
      ["old", 20, 1200],
      ["new", -40, -2000],
    ]) {
      const event = new WheelEvent("wheel", {
        deltaX,
        deltaY,
        bubbles: true,
        cancelable: true,
      });
      editor(side).getElement().getComponent().refs.scrollContainer.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(oldComponent.scrollAnimator.isAnimating()).toBe(false);
      expect(newComponent.scrollAnimator.isAnimating()).toBe(true);
      for (let frame = 0; frame < 3; frame++) {
        newComponent.scrollAnimator.advance(1000 / 60);
        assertAlignedFrame();
      }
    }
    for (let frame = 0; newComponent.scrollAnimator.isAnimating() && frame < 1000; frame++) {
      newComponent.scrollAnimator.advance(1000 / 60);
      assertAlignedFrame();
    }
    expect(newComponent.scrollAnimator.isAnimating()).toBe(false);
  });

  it("shares the wheel animation with Before when its removed lines are wider than After", async () => {
    const unchanged = Array.from({ length: 80 }, (_, index) => ` context ${index}`);
    await mount(diff([hunk([`-${"x".repeat(2000)}`, "+short line", ...unchanged])]));
    await layout("side-by-side");
    for (const side of ["old", "new"]) editor(side).setSoftWrapped(false);
    for (const side of ["old", "new"])
      editor(side).update({
        smoothScrolling: true,
        wheelScrollDuration: 120,
        wheelScrollMultiplier: 1.2,
      });
    await renderEditors();
    const oldComponent = editor("old").getElement().getComponent();
    const newComponent = editor("new").getElement().getComponent();
    for (const component of [oldComponent, newComponent]) {
      component.element.setUpdatedSynchronously(false);
      component.scrollAnimator.raf = () => 0;
      component.scrollAnimator.caf = () => {};
    }
    expect(oldComponent.getMaxScrollLeft()).toBeGreaterThan(newComponent.getMaxScrollLeft());
    const event = new WheelEvent("wheel", {
      deltaX: oldComponent.getMaxScrollLeft() / 1.2,
      deltaY: 500,
      bubbles: true,
      cancelable: true,
    });
    newComponent.refs.scrollContainer.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(oldComponent.scrollAnimator.isAnimating()).toBe(true);
    expect(newComponent.scrollAnimator.isAnimating()).toBe(false);
    for (let frame = 0; oldComponent.scrollAnimator.isAnimating() && frame < 1000; frame++) {
      oldComponent.scrollAnimator.advance(1000 / 60);
      expect(oldComponent.renderedScrollTop).toBe(newComponent.renderedScrollTop);
    }
    expect(oldComponent.scrollAnimator.isAnimating()).toBe(false);
    expect(oldComponent.getScrollLeft()).toBe(oldComponent.getMaxScrollLeft());
    expect(newComponent.getScrollLeft()).toBe(newComponent.getMaxScrollLeft());
  });

  it("refreshes the projected editors, preserves a logical line selection, and releases the old patch", async () => {
    const previous = await mount();
    await layout("side-by-side");
    const oldEditor = editor("old");
    const newEditor = editor("new");
    newEditor.setSelectedBufferRange(
      [
        [1, 0],
        [1, Infinity],
      ],
      { autoscroll: false },
    );
    await settleSelection();
    const next = build(diff([hunk([" before", "-old value", "+latest value", " after"])]));
    publication.emit("will-update");
    next.adoptBuffer(previous.getPatchBuffer());
    publication.emit("did-update", next);
    await flushViews(() => view.update({ ...view.props, multiFilePatch: next }));
    previous.dispose();
    await settleSelection();
    expect(previous.isDisposed()).toBe(true);
    expect(editor("old")).toBe(oldEditor);
    expect(editor("new")).toBe(newEditor);
    expect(newEditor.getText()).toBe("before\nlatest value\nafter");
    expect(Array.from(view.props.selectedRows)).toEqual([2]);
    expect(view.props.selectionMode).toBe("line");
  });

  it("destroys both projected editor generations and their buffers when the view closes", async () => {
    const patch = await mount();
    await layout("side-by-side");
    const oldEditor = editor("old");
    const newEditor = editor("new");
    const oldBuffer = oldEditor.getBuffer();
    const newBuffer = newEditor.getBuffer();
    patch.dispose();
    expect(patch.isDisposed()).toBe(false);
    await view.destroy();
    expect(oldEditor.isDestroyed()).toBe(true);
    expect(newEditor.isDestroyed()).toBe(true);
    expect(oldBuffer.isDestroyed()).toBe(true);
    expect(newBuffer.isDestroyed()).toBe(true);
    expect(patch.isDisposed()).toBe(true);
    expect(container.querySelectorAll("lumine-text-editor").length).toBe(0);
  });
});
