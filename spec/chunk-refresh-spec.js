/** @babel */
import path from "path";
import { Disposable, Emitter } from "lumine";
import ChangedFileContainer from "../lib/containers/changed-file-container";
import ChangedFileItem from "../lib/items/changed-file-item";
import RefHolder from "../lib/models/ref-holder";
import { buildMultiFilePatch } from "../lib/models/patch";
import { flushViews } from "./helpers/etch";

function hunk(section, count = 90, width = 0) {
  const start = section * 300 + 1;
  return {
    oldStartLine: start,
    newStartLine: start,
    oldLineCount: count,
    newLineCount: count,
    heading: `section ${section}`,
    lines: Array.from({ length: count }, (_, row) => [
      `-old ${section}:${row} ${"long content ".repeat(width)}`,
      `+new ${section}:${row} ${"long content ".repeat(width)}`,
    ]).flat(),
  };
}

describe("mounted diff chunk refreshes", () => {
  let view, container, stylesheet, emitter, repository, source, refEditor, refPatchController;
  let discardLines;
  const patches = [];

  beforeEach(() => {
    stylesheet = lumine.themes.requireStylesheet(path.join(__dirname, "..", "styles", "main.css"));
    container = document.createElement("div");
    container.style.cssText = "display: flex; width: 780px; height: 340px;";
    jasmine.attachToDOM(container);
    emitter = new Emitter();
    refEditor = new RefHolder();
    refPatchController = new RefHolder();
    repository = {
      isLoading: () => false,
      onDidUpdate: (callback) => emitter.on("did-update", callback),
      getWorkingDirectoryPath: () => path.dirname(__filename),
      getFilePatchForPath: jasmine.createSpy("read refreshed patch").and.callFake(() => source),
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

  async function mount(hunks) {
    source = build(hunks);
    view = new ChangedFileContainer({
      repository,
      relPath: "example.txt",
      stagingStatus: "unstaged",
      itemType: ChangedFileItem,
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
    expect(editor().isReadOnly()).toBe(true);
  }

  function editor() {
    return refEditor.get();
  }

  function expectReleasedViewport() {
    const component = editor().getElement().getComponent();
    const overlay = refPatchController.get().refView.get().fullWidthHeaders;
    expect(overlay.viewportRestoration).toBeNull();
    for (const key of ["pendingScrollAnchor", "settlingScrollAnchor", "pendingReflowScrollAnchor"])
      expect(component[key]).toBeNull();
  }

  async function scrollTo(row, column = 0) {
    const model = editor();
    const component = model.getElement().getComponent();
    const screenRow = model.screenPositionForBufferPosition([row, column]).row;
    model.getElement().setScrollTop(component.pixelPositionBeforeBlocksForRow(screenRow) + 7);
    await settle();
    return model.getElement().getScrollTop();
  }

  function clickChunk(kind, index) {
    const suffix = kind === "stage" ? "stageButton" : "discardButton";
    const button = view.element.querySelectorAll(`.patch-view-HunkHeaderView-${suffix}`)[index];
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    button.focus();
    button.click();
  }

  for (const kind of ["stage", "delete"]) {
    it(`keeps the editor and viewport while a ${kind} chunk refresh waits, then removes its hunk`, async () => {
      const hunks = [hunk(0), hunk(1), hunk(2)];
      await mount(hunks);
      const previousEditor = editor();
      const previousElement = previousEditor.getElement();
      const previousBuffer = previousEditor.getBuffer();
      const scrollTop = await scrollTo(205);
      expect(scrollTop).toBeGreaterThan(0);
      let complete;
      source = new Promise((resolve) => {
        complete = resolve;
      });
      await flushViews(() => clickChunk(kind, 1));
      await settle();
      expect(kind === "stage" ? repository.applyPatchToIndex : discardLines).toHaveBeenCalledTimes(
        1,
      );
      expect(editor()).toBe(previousEditor);
      expect(view.element.querySelector("lumine-text-editor")).toBe(previousElement);
      expect(editor().getBuffer()).toBe(previousBuffer);
      expect(editor().getElement().getScrollTop()).toBeCloseTo(scrollTop, 0);
      expect(editor().getText()).toContain("new 1:0");
      expect(view.element.querySelector(".git-panel-Loader")).toBeNull();

      const changes = [];
      const changeSub = previousBuffer.onDidChangeText((event) => changes.push(...event.changes));
      source = build([hunks[0], hunks[2]]);
      complete(source);
      await settle((component) => {
        expect(Math.abs(component.renderedScrollTop - scrollTop)).toBeLessThanOrEqual(1);
      });
      changeSub.dispose();
      expect(editor()).toBe(previousEditor);
      expect(view.element.querySelector("lumine-text-editor")).toBe(previousElement);
      expect(editor().getBuffer()).toBe(previousBuffer);
      expect(editor().getText()).not.toContain("new 1:0");
      expect(editor().getElement().getScrollTop()).toBeCloseTo(scrollTop, 0);
      expectReleasedViewport();
      expect(
        refPatchController.get().props.multiFilePatch.getFilePatches()[0].getHunks().length,
      ).toBe(2);
      expect(changes.length).toBeGreaterThan(0);
      for (const change of changes) {
        expect(change.oldText).not.toContain("new 0:0");
        expect(change.oldText).not.toContain("new 2:0");
      }
    }, 15000);
  }

  it("retains the viewport through sequential wrapped refreshes and rebuilt headers", async () => {
    const hunks = [hunk(0, 24, 15), hunk(1, 24, 15), hunk(2, 24, 15), hunk(3, 24, 15)];
    await mount(hunks);
    editor().setSoftWrapped(true);
    await settle();
    const previousEditor = editor();
    const scrollTop = await scrollTo(60, 90);
    for (const nextHunks of [
      [hunks[1], hunks[2], hunks[3]],
      [hunks[2], hunks[3]],
    ]) {
      source = build(nextHunks);
      await flushViews(() => emitter.emit("did-update"));
      await settle((component) => {
        expect(Math.abs(component.renderedScrollTop - scrollTop)).toBeLessThanOrEqual(1);
      });
      expect(editor()).toBe(previousEditor);
      expect(editor().getElement().getScrollTop()).toBeCloseTo(scrollTop, 0);
      expectReleasedViewport();
      expect(view.element.querySelectorAll(".patch-view-HunkHeaderView").length).toBe(
        nextHunks.length,
      );
    }
  });

  it("clamps the preserved viewport when the remaining chunk is shorter", async () => {
    const hunks = [hunk(0, 40), hunk(1, 90)];
    await mount(hunks);
    const previousEditor = editor();
    const scrollTop = await scrollTo(220);
    source = build([hunks[0]]);
    await flushViews(() => clickChunk("delete", 1));
    await settle();
    const component = editor().getElement().getComponent();
    expect(editor()).toBe(previousEditor);
    expect(component.getMaxScrollTop()).toBeLessThan(scrollTop);
    expect(editor().getElement().getScrollTop()).toBeCloseTo(component.getMaxScrollTop(), 0);
  }, 15000);

  it("keeps both scroll offsets without replacing unchanged text on a fresh snapshot", async () => {
    const hunks = [hunk(0, 50, 25), hunk(1, 50, 25)];
    await mount(hunks);
    editor().setSoftWrapped(false);
    await settle();
    const previousEditor = editor();
    const scrollTop = await scrollTo(120);
    editor().getElement().setScrollLeft(180);
    await settle();
    const scrollLeft = editor().getElement().getScrollLeft();
    expect(scrollLeft).toBeGreaterThan(0);
    const changed = jasmine.createSpy("unchanged diff text");
    const changeSub = editor().getBuffer().onDidChangeText(changed);
    source = build(hunks);
    await flushViews(() => emitter.emit("did-update"));
    await settle();
    changeSub.dispose();
    expect(editor()).toBe(previousEditor);
    expect(editor().getElement().getScrollTop()).toBeCloseTo(scrollTop, 0);
    expect(editor().getElement().getScrollLeft()).toBeCloseTo(scrollLeft, 0);
    expect(changed).not.toHaveBeenCalled();
    expectReleasedViewport();
  });

  it("lets a wheel gesture replace a refresh viewport before the headers are measured", async () => {
    await mount([hunk(0, 50), hunk(1, 50)]);
    editor().update({ smoothScrolling: false });
    const scrollTop = await scrollTo(90);
    const element = editor().getElement();
    const component = element.getComponent();
    const overlay = refPatchController.get().refView.get().fullWidthHeaders;
    overlay.preserveViewport(scrollTop, element.getScrollLeft());
    const pin = overlay.viewportRestoration.anchor;
    const wheel = new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true });
    element.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    const moved = element.getScrollTop();
    expect(moved).toBeGreaterThan(scrollTop);
    expect(overlay.viewportRestoration).toBeNull();
    for (const key of ["pendingScrollAnchor", "settlingScrollAnchor", "pendingReflowScrollAnchor"])
      expect(component[key]).not.toBe(pin);
    await settle((painted) => {
      expect(Math.abs(painted.renderedScrollTop - moved)).toBeLessThanOrEqual(1);
    });
    overlay.measure();
    await settle();
    expect(element.getScrollTop()).toBeCloseTo(moved, 0);
  });

  it("shows the empty diff after the last chunk is staged", async () => {
    await mount([hunk(0, 20)]);
    const previousEditor = editor();
    const empty = buildMultiFilePatch([]);
    patches.push(empty);
    source = empty;
    await flushViews(() => clickChunk("stage", 0));
    await settle();
    expect(repository.applyPatchToIndex).toHaveBeenCalledTimes(1);
    expect(view.element.querySelector("lumine-text-editor")).toBeNull();
    expect(view.element.querySelector(".patch-view-FilePatchView-message").textContent).toBe(
      "No changes to display",
    );
    expect(view.element.querySelector(".git-panel-Loader")).toBeNull();
    expect(previousEditor.isDestroyed()).toBe(true);
  });
});
