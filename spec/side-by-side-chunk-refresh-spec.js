/** @babel */
import path from "path";
import { Disposable, Emitter } from "lumine";
import ChangedFileContainer from "../lib/containers/changed-file-container";
import ChangedFileItem from "../lib/items/changed-file-item";
import RefHolder from "../lib/models/ref-holder";
import { buildMultiFilePatch } from "../lib/models/patch";
import { flushViews } from "./helpers/etch";

const sides = ["old", "new"];

function hunk(section, count = 16) {
  const widths = [
    [28, 4],
    [4, 40],
    [18, 2],
  ][section];
  return {
    oldStartLine: section * 100 + 1,
    newStartLine: section * 100 + 1,
    oldLineCount: count,
    newLineCount: count,
    heading: `section ${section}`,
    lines: Array.from({ length: count }, (_, row) => [
      `-before ${section}:${row} ${"before words ".repeat(widths[0] + (row % 3))}`,
      `+after ${section}:${row} ${"after words ".repeat(widths[1] + (row % 3))}`,
    ]).flat(),
  };
}

describe("mounted Side by Side chunk refreshes", () => {
  let view, container, stylesheet, emitter, repository, source, refPatchController, discardLines;
  const patches = [];

  beforeEach(() => {
    stylesheet = lumine.themes.requireStylesheet(path.join(__dirname, "..", "styles", "main.css"));
    container = document.createElement("div");
    container.style.cssText = "display: flex; width: 760px; height: 340px;";
    jasmine.attachToDOM(container);
    emitter = new Emitter();
    refPatchController = new RefHolder();
    repository = {
      isLoading: () => false,
      onDidUpdate: (callback) => emitter.on("did-update", callback),
      getWorkingDirectoryPath: () => path.dirname(__filename),
      getFilePatchForPath: () => source,
      isPartiallyStaged: () => false,
      hasDiscardHistory: () => false,
      applyPatchToIndex: jasmine.createSpy("stage Side by Side chunk").and.callFake(async () => {
        emitter.emit("did-update");
      }),
    };
    discardLines = jasmine.createSpy("delete Side by Side chunk").and.callFake(async () => {
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

  function pair() {
    return refPatchController.get().refView.get().refSideBySide.get();
  }

  function editor(side) {
    return pair().editors[side].get();
  }

  function expectReleasedViewport() {
    expect(pair().patchViewportRestoration).toBeNull();
    for (const side of sides) {
      const component = editor(side).getElement().getComponent();
      for (const key of [
        "pendingScrollAnchor",
        "settlingScrollAnchor",
        "pendingReflowScrollAnchor",
      ])
        expect(component[key]).toBeNull();
    }
  }

  async function settle() {
    for (let pass = 0; pass < 4; pass++) {
      await flushViews(() => {});
      const elements = sides.map((side) => editor(side).getElement());
      const updates = elements.map((element) => element.getNextUpdatePromise());
      for (const element of elements) element.getComponent().scheduleUpdate();
      await Promise.all(updates);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }

  async function mount(hunks) {
    source = build(hunks);
    view = new ChangedFileContainer({
      repository,
      relPath: "example.txt",
      stagingStatus: "unstaged",
      itemType: ChangedFileItem,
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
    await flushViews(() => {});
    await flushViews(() => refPatchController.get().setDiffView("side-by-side"));
    await settle();
    for (const side of sides) {
      expect(editor(side).isReadOnly()).toBe(true);
      expect(editor(side).isSoftWrapped()).toBe(true);
    }
    for (const padding of pair().wrapAlignment.padding) expect(padding.size).toBeGreaterThan(0);
  }

  async function revealHunk(index) {
    pair().releaseInitialScrollAnchor();
    const selected = refPatchController.get().props.multiFilePatch.getFilePatches()[0].getHunks()[
      index
    ];
    const row = pair().projection.patchRowToDisplayRow.get(selected.getRange().start.row);
    const model = editor("new");
    const screenRow = model.screenPositionForBufferPosition([row, 0]).row;
    const component = model.getElement().getComponent();
    model.getElement().setScrollTop(component.pixelPositionBeforeBlocksForRow(screenRow) - 30);
    await settle();
    return sides.map((side) => editor(side).getElement().getScrollTop());
  }

  function recordFrames() {
    const frames = [];
    let frameId;
    const record = () => {
      frames.push(sides.map((side) => editor(side).getElement().getComponent().renderedScrollTop));
      frameId = requestAnimationFrame(record);
    };
    frameId = requestAnimationFrame(record);
    return {
      frames,
      stop: () => cancelAnimationFrame(frameId),
    };
  }

  function clickChunk(kind, index) {
    const suffix = kind === "stage" ? "stageButton" : "discardButton";
    const button = view.element.querySelectorAll(`.patch-view-HunkHeaderView-${suffix}`)[index];
    const header = button.closest(".patch-view-HunkHeaderView").getBoundingClientRect();
    const viewport = editor("new")
      .getElement()
      .getComponent()
      .refs.scrollContainer.getBoundingClientRect();
    expect(header.top).toBeGreaterThanOrEqual(viewport.top);
    expect(header.bottom).toBeLessThanOrEqual(viewport.bottom);
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    button.focus();
    button.click();
  }

  for (const kind of ["stage", "delete"]) {
    it(`keeps both wrapped viewports through the visible ${kind} chunk control and its refresh`, async () => {
      const hunks = [hunk(0), hunk(1), hunk(2)];
      await mount(hunks);
      const models = sides.map((side) => editor(side));
      const elements = models.map((model) => model.getElement());
      const buffers = models.map((model) => model.getBuffer());
      const viewport = await revealHunk(1);
      expect(viewport[0]).toBeGreaterThan(0);
      expect(viewport[0]).toBeCloseTo(viewport[1], 0);
      let complete;
      source = new Promise((resolve) => {
        complete = resolve;
      });
      const recording = recordFrames();
      try {
        await flushViews(() => clickChunk(kind, 1));
        await settle();
        expect(
          kind === "stage" ? repository.applyPatchToIndex : discardLines,
        ).toHaveBeenCalledTimes(1);
        for (let index = 0; index < sides.length; index++)
          expect(editor(sides[index]).getElement().getScrollTop())
            .withContext("while the refreshed patch is pending")
            .toBeCloseTo(viewport[index], 0);
        source = build([hunks[0], hunks[2]]);
        complete(source);
        await settle();
      } finally {
        recording.stop();
      }
      expect(recording.frames.length).toBeGreaterThan(0);
      for (let index = 0; index < sides.length; index++) {
        const side = sides[index];
        expect(editor(side)).toBe(models[index]);
        expect(editor(side).getElement()).toBe(elements[index]);
        expect(editor(side).getBuffer()).toBe(buffers[index]);
        expect(editor(side).getText()).not.toContain(`${side === "old" ? "before" : "after"} 1:0`);
        expect(editor(side).getElement().getScrollTop()).toBeCloseTo(viewport[index], 0);
        expect(
          Math.max(...recording.frames.map((frame) => Math.abs(frame[index] - viewport[index]))),
        )
          .withContext(`${side} column's largest painted viewport drift`)
          .toBeLessThanOrEqual(1);
      }
      expectReleasedViewport();
      for (const side of sides) editor(side).update({ smoothScrolling: false });
      editor("new")
        .getElement()
        .dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true }));
      const moved = editor("new").getElement().getScrollTop();
      expect(moved).toBeGreaterThan(viewport[1]);
      await settle();
      pair().measureSharedHeaders();
      pair().wrapAlignment.synchronize();
      await settle();
      for (const side of sides)
        expect(editor(side).getElement().getScrollTop()).toBeCloseTo(moved, 0);
      container.style.width = "700px";
      await settle();
      expect(editor("old").getElement().getScrollTop()).toBeCloseTo(
        editor("new").getElement().getScrollTop(),
        0,
      );
      expect(editor("new").getElement().getScrollTop()).toBeGreaterThan(0);
      expectReleasedViewport();
    }, 15000);
  }

  it("clamps both wrapped viewports when deleting the final visible chunk shortens the diff", async () => {
    const hunks = [hunk(0, 8), hunk(1, 8), hunk(2, 8)];
    await mount(hunks);
    const models = sides.map((side) => editor(side));
    const viewport = await revealHunk(2);
    const recording = recordFrames();
    try {
      source = build([hunks[0], hunks[1]]);
      await flushViews(() => clickChunk("delete", 2));
      await settle();
    } finally {
      recording.stop();
    }
    expect(discardLines).toHaveBeenCalledTimes(1);
    for (let index = 0; index < sides.length; index++) {
      const current = editor(sides[index]);
      const maximum = current.getElement().getComponent().getMaxScrollTop();
      expect(current).toBe(models[index]);
      expect(maximum).toBeLessThan(viewport[index]);
      expect(current.getElement().getScrollTop()).toBeCloseTo(maximum, 0);
      expect(Math.min(...recording.frames.map((frame) => frame[index]))).toBeGreaterThanOrEqual(
        maximum - 1,
      );
      expect(Math.max(...recording.frames.map((frame) => frame[index]))).toBeLessThanOrEqual(
        viewport[index] + 1,
      );
    }
    expectReleasedViewport();
  }, 15000);
});
