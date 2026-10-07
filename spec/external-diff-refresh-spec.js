/** @babel */
import path from "path";
import { Disposable, Emitter } from "lumine";
import ChangedFileContainer from "../lib/containers/changed-file-container";
import ChangedFileItem from "../lib/items/changed-file-item";
import RefHolder from "../lib/models/ref-holder";
import { buildMultiFilePatch } from "../lib/models/patch";
import { flushViews } from "./helpers/etch";

function hunk(section, count = 60, start = section * 300 + 1) {
  return {
    oldStartLine: start,
    newStartLine: start,
    oldLineCount: count,
    newLineCount: count,
    heading: `section ${section}`,
    lines: Array.from({ length: count }, (_, row) => [
      `-old ${section}:${row} ${"long content ".repeat(25)}`,
      `+new ${section}:${row} ${"long content ".repeat(25)}`,
    ]).flat(),
  };
}

describe("mounted diff snapshots from repository updates", () => {
  let view, container, stylesheet, emitter, repository, source, refEditor, refPatchController;
  let discardLines;
  const patches = [];
  const paintMonitors = [];

  beforeEach(() => {
    stylesheet = lumine.themes.requireStylesheet(path.join(__dirname, "..", "styles", "main.css"));
    container = document.createElement("div");
    container.style.cssText = "display: flex; width: 1000px; height: 340px;";
    jasmine.attachToDOM(container);
    emitter = new Emitter();
    refEditor = new RefHolder();
    refPatchController = new RefHolder();
    repository = {
      isLoading: () => false,
      onDidUpdate: (callback) => emitter.on("did-update", callback),
      getWorkingDirectoryPath: () => path.dirname(__filename),
      getFilePatchForPath: jasmine.createSpy("read external patch").and.callFake(() => source),
      isPartiallyStaged: () => false,
      hasDiscardHistory: () => false,
      applyPatchToIndex: jasmine.createSpy("stage chunk").and.callFake(async () => {
        emitter.emit("did-update");
      }),
    };
    discardLines = jasmine.createSpy("delete chunk").and.callFake(async () => {
      emitter.emit("did-update");
    });
  });

  afterEach(async () => {
    for (const finish of paintMonitors.splice(0)) finish(false);
    await view?.destroy();
    view = null;
    for (const patch of patches.splice(0)) patch.dispose();
    emitter.dispose();
    container.remove();
    stylesheet.dispose();
  });

  function build(hunks) {
    const patch = buildMultiFilePatch(
      [
        {
          oldPath: "example.txt",
          newPath: "example.txt",
          oldMode: "100644",
          newMode: "100644",
          status: "modified",
          hunks,
        },
      ],
      { largeDiffThreshold: Infinity },
    );
    patches.push(patch);
    return patch;
  }

  function controller() {
    return refPatchController.get();
  }

  function patchView() {
    return controller().refView.get();
  }

  function pair() {
    return patchView().refSideBySide.get();
  }

  function editors() {
    return Array.from(view.element.querySelectorAll("lumine-text-editor"), (element) =>
      element.getModel(),
    );
  }

  async function settle(didPaint = () => {}) {
    for (let pass = 0; pass < 4; pass++) {
      await flushViews(() => {});
      const elements = Array.from(view.element.querySelectorAll("lumine-text-editor"));
      const updates = elements.map((element) => element.getNextUpdatePromise());
      for (const element of elements) element.getComponent().scheduleUpdate();
      await Promise.all(updates);
      for (const element of elements) didPaint(element.getComponent());
    }
  }

  async function mount(mode, hunks) {
    source = build(hunks);
    view = new ChangedFileContainer({
      repository,
      relPath: "example.txt",
      stagingStatus: "unstaged",
      itemType: ChangedFileItem,
      initialDiffView: mode,
      refEditor,
      refPatchController,
      workspace: lumine.workspace,
      config: lumine.config,
      commands: lumine.commands,
      keymaps: lumine.keymaps,
      tooltips: { add: () => new Disposable(), addComposite: () => new Disposable() },
      surfaceFileAtPath: () => {},
      discardLines,
      undoLastDiscard: () => {},
    });
    container.appendChild(view.element);
    await settle();
    for (const editor of editors()) {
      expect(editor.isReadOnly()).toBe(true);
      editor.setSoftWrapped(false);
    }
    await settle();
    if (mode === "side-by-side") pair().releaseInitialScrollAnchor();
    const element = refEditor.get().getElement();
    const component = element.getComponent();
    const row = mode === "side-by-side" ? 80 : 160;
    element.setScrollTop(component.pixelPositionBeforeBlocksForRow(row) + 7);
    element.setScrollLeft(180);
    await settle();
  }

  function snapshot() {
    return editors().map((editor) => ({
      editor,
      element: editor.getElement(),
      buffer: editor.getBuffer(),
      top: editor.getElement().getScrollTop(),
      left: editor.getElement().getScrollLeft(),
    }));
  }

  function expectStable(previous) {
    const current = editors();
    expect(current.length).toBe(previous.length);
    current.forEach((editor, index) => {
      const before = previous[index];
      expect(editor).toBe(before.editor);
      expect(editor.getElement()).toBe(before.element);
      expect(editor.getBuffer()).toBe(before.buffer);
      expect(editor.getElement().getScrollTop()).toBeCloseTo(before.top, 0);
      expect(editor.getElement().getScrollLeft()).toBeCloseTo(before.left, 0);
    });
    expect(view.element.querySelector(".git-panel-Loader")).toBeNull();
  }

  function monitorPaints(previous) {
    const frames = [];
    const sample = () => {
      frames.push({
        editors: editors(),
        loading: Boolean(view.element.querySelector(".git-panel-Loader")),
        offsets: previous.map(({ element }) => {
          const component = element.getComponent();
          return [component.renderedScrollTop, component.renderedScrollLeft];
        }),
      });
      frame = requestAnimationFrame(sample);
    };
    let frame = requestAnimationFrame(sample);
    const finish = (verify = true) => {
      cancelAnimationFrame(frame);
      if (!verify) return;
      expect(frames.length).toBeGreaterThan(0);
      expect(frames.every((paint) => !paint.loading)).toBe(true);
      expect(
        frames.every((paint) =>
          paint.editors.every((editor, index) => editor === previous[index].editor),
        ),
      ).toBe(true);
      previous.forEach((before, index) => {
        expect(
          Math.max(...frames.map((paint) => Math.abs(paint.offsets[index][0] - before.top))),
        ).toBeLessThanOrEqual(1);
        expect(
          Math.max(...frames.map((paint) => Math.abs(paint.offsets[index][1] - before.left))),
        ).toBeLessThanOrEqual(1);
      });
    };
    paintMonitors.push(finish);
    return finish;
  }

  function expectSnapshot(mode, hunks) {
    const patch = controller().props.multiFilePatch;
    const loadedHunks = patch.getFilePatches()[0].getHunks();
    expect(loadedHunks.length).toBe(hunks.length);
    expect(view.element.querySelectorAll(".patch-view-HunkHeaderView").length).toBe(hunks.length);
    let canonicalRow = 0;
    let displayRow = 0;
    loadedHunks.forEach((loaded, index) => {
      const expected = hunks[index];
      expect(loaded.getRange().start.row).toBe(canonicalRow);
      expect(patch.getHunkAt(canonicalRow)).toBe(loaded);
      expect(patch.getHunkAt(canonicalRow + expected.lines.length - 1)).toBe(loaded);
      if (mode === "side-by-side") {
        for (const side of ["old", "new"]) {
          const editor = pair().editors[side].get();
          const gutter = editor.gutterWithName(`${side}-line-numbers`);
          expect(editor.lineTextForBufferRow(displayRow)).toBe(
            expected.lines[side === "old" ? 0 : 1].slice(1),
          );
          expect(gutter.labelFn({ bufferRow: displayRow, softWrapped: false })).toBe(
            String(expected[`${side}StartLine`]),
          );
        }
        const entry = pair().projection.rows[displayRow];
        expect(entry.hunk).toBe(loaded);
        expect(entry.oldRow).toBe(canonicalRow);
        expect(entry.newRow).toBe(canonicalRow + 1);
      } else {
        expect(
          patchView().oldLineNumberLabel({ bufferRow: canonicalRow, softWrapped: false }).trim(),
        ).toBe(String(expected.oldStartLine));
        expect(
          patchView()
            .newLineNumberLabel({ bufferRow: canonicalRow + 1, softWrapped: false })
            .trim(),
        ).toBe(String(expected.newStartLine));
      }
      canonicalRow += expected.lines.length;
      displayRow += expected.oldLineCount;
    });
  }

  for (const mode of ["unified", "side-by-side"]) {
    it(`updates ${mode} text, source line numbers and markers from external changes in place`, async () => {
      const hunks = [hunk(0), hunk(1), hunk(2)];
      await mount(mode, hunks);
      const previous = snapshot();
      const finishPaints = monitorPaints(previous);
      expect(previous.every((entry) => entry.top > 0 && entry.left > 0)).toBe(true);
      const originalSource = source;
      const nextHunks = [hunks[0], hunk(3, 70, 850), hunks[2]];
      source = build(nextHunks);
      await flushViews(() => emitter.emit("did-update"));
      await settle((component) => {
        const before = previous.find((entry) => entry.element === component.element);
        expect(Math.abs(component.renderedScrollTop - before.top)).toBeLessThanOrEqual(1);
      });
      expectStable(previous);
      finishPaints();
      expect(controller().getDiffView()).toBe(mode);
      expect(refEditor.get().getText()).toContain("new 3:0");
      expect(refEditor.get().getText()).not.toContain("new 1:0");
      expect(originalSource.getBuffer().getText()).toContain("new 1:0");
      expect(originalSource.getBuffer().getText()).not.toContain("new 3:0");
      expectSnapshot(mode, nextHunks);
      source.dispose();
      expect(controller().props.multiFilePatch.getBuffer().isDestroyed()).toBe(false);
      expectStable(previous);
    });

    it(`keeps ${mode} mounted while queued updates supersede an asynchronous repository read`, async () => {
      const hunks = [hunk(0), hunk(1), hunk(2)];
      await mount(mode, hunks);
      const previous = snapshot();
      const finishPaints = monitorPaints(previous);
      const changed = [];
      const subscriptions = previous.map(({ buffer }) =>
        buffer.onDidChangeText((event) => changed.push(...event.changes)),
      );
      let complete;
      source = new Promise((resolve) => {
        complete = resolve;
      });
      await flushViews(() => emitter.emit("did-update"));
      source = build([hunks[0], hunk(3, 70, 850), hunks[2]]);
      await flushViews(() => {
        emitter.emit("did-update");
        emitter.emit("did-update");
      });
      await settle();
      expectStable(previous);
      expect(refEditor.get().getText()).toContain("new 1:0");
      const superseded = build([hunks[0], hunk(4), hunks[2]]);
      complete(superseded);
      await settle((component) => {
        const before = previous.find((entry) => entry.element === component.element);
        expect(Math.abs(component.renderedScrollTop - before.top)).toBeLessThanOrEqual(1);
      });
      for (const subscription of subscriptions) subscription.dispose();
      finishPaints();
      expect(repository.getFilePatchForPath).toHaveBeenCalledTimes(3);
      expectStable(previous);
      expect(refEditor.get().getText()).toContain("new 3:0");
      expect(refEditor.get().getText()).not.toContain("new 4:0");
      expect(changed.length).toBeGreaterThan(0);
      for (const change of changed) expect(change.newText).not.toContain("new 4:0");
      expectSnapshot(mode, [hunks[0], hunk(3, 70, 850), hunks[2]]);
    });
  }

  for (const kind of ["stage", "delete"]) {
    it(`keeps both Side by Side viewports stable after a ${kind} chunk`, async () => {
      const hunks = [hunk(0), hunk(1), hunk(2)];
      await mount("side-by-side", hunks);
      const previous = snapshot();
      const finishPaints = monitorPaints(previous);
      source = build([hunks[0], hunks[2]]);
      const suffix = kind === "stage" ? "stageButton" : "discardButton";
      await flushViews(() => {
        const button = view.element.querySelectorAll(`.patch-view-HunkHeaderView-${suffix}`)[1];
        button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        button.focus();
        button.click();
      });
      await settle((component) => {
        const before = previous.find((entry) => entry.element === component.element);
        expect(Math.abs(component.renderedScrollTop - before.top)).toBeLessThanOrEqual(1);
      });
      expect(kind === "stage" ? repository.applyPatchToIndex : discardLines).toHaveBeenCalledTimes(
        1,
      );
      expectStable(previous);
      finishPaints();
      expect(pair().editors.old.get().getText()).not.toContain("old 1:0");
      expect(pair().editors.new.get().getText()).not.toContain("new 1:0");
      expect(view.element.querySelectorAll(".patch-view-HunkHeaderView").length).toBe(2);
    });
  }

  it("retains both Side by Side offsets without text edits when an identical snapshot arrives", async () => {
    const hunks = [hunk(0), hunk(1), hunk(2)];
    await mount("side-by-side", hunks);
    const previous = snapshot();
    const finishPaints = monitorPaints(previous);
    const changed = jasmine.createSpy("identical projection text edit");
    const subscriptions = previous.map(({ buffer }) => buffer.onDidChangeText(changed));
    source = build(hunks);
    await flushViews(() => emitter.emit("did-update"));
    await settle((component) => {
      const before = previous.find((entry) => entry.element === component.element);
      expect(Math.abs(component.renderedScrollTop - before.top)).toBeLessThanOrEqual(1);
    });
    for (const subscription of subscriptions) subscription.dispose();
    finishPaints();
    expectStable(previous);
    expect(changed).not.toHaveBeenCalled();
  });
});
