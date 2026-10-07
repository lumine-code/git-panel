/** @babel */
import path from "path";
import { Disposable, Range } from "lumine";
import ChangedFileController from "../lib/controllers/changed-file-controller";
import CommitPreviewController from "../lib/controllers/commit-preview-controller";
import ChangedFileItem from "../lib/items/changed-file-item";
import CommitPreviewItem from "../lib/items/commit-preview-item";
import RefHolder from "../lib/models/ref-holder";
import { buildMultiFilePatch } from "../lib/models/patch";
import { flushViews } from "./helpers/etch";

function diff(filePath, oldValue = "old value", newValue = "new value", context = []) {
  return {
    oldPath: filePath,
    newPath: filePath,
    oldMode: "100644",
    newMode: "100644",
    status: "modified",
    hunks: [
      {
        oldStartLine: 1,
        oldLineCount: 3 + context.length,
        newStartLine: 1,
        newLineCount: 3 + context.length,
        heading: "",
        lines: [" before", `-${oldValue}`, `+${newValue}`, " after", ...context],
      },
    ],
  };
}

const surfaces = [
  {
    name: "unstaged file changes",
    Controller: ChangedFileController,
    itemType: ChangedFileItem,
    stagingStatus: "unstaged",
    title: "Unstaged Changes",
    fileCount: 1,
  },
  {
    name: "staged file changes",
    Controller: ChangedFileController,
    itemType: ChangedFileItem,
    stagingStatus: "staged",
    title: "Staged Changes",
    fileCount: 1,
  },
  {
    name: "combined staged changes",
    Controller: CommitPreviewController,
    itemType: CommitPreviewItem,
    stagingStatus: "staged",
    title: "Staged Changes",
    fileCount: 2,
  },
];

describe("changes diff layout", () => {
  let view;
  let container;
  let stylesheet;
  let refPatchController;
  let refEditor;
  let repository;
  let discardLines;
  let appliedPatches;
  const patches = [];

  beforeEach(() => {
    stylesheet = lumine.themes.requireStylesheet(path.join(__dirname, "..", "styles", "main.css"));
    container = document.createElement("div");
    container.style.cssText = "display: flex; width: 1000px; height: 400px;";
    jasmine.attachToDOM(container);
    refPatchController = new RefHolder();
    refEditor = new RefHolder();
    appliedPatches = [];
    repository = {
      getWorkingDirectoryPath: () => path.dirname(__filename),
      applyPatchToIndex: jasmine.createSpy("apply index patch").and.callFake(async (patch) => {
        appliedPatches.push(patch.toString());
      }),
    };
    discardLines = jasmine.createSpy("discard selected changes").and.resolveTo();
  });

  afterEach(async () => {
    await view?.destroy();
    view = null;
    while (patches.length) patches.pop().dispose();
    container.remove();
    stylesheet.dispose();
  });

  function build(raw) {
    const patch = buildMultiFilePatch(raw, { largeDiffThreshold: Infinity });
    patches.push(patch);
    return patch;
  }

  async function mount(surface, raw) {
    const patch = build(
      raw || Array.from({ length: surface.fileCount }, (_, index) => diff(`file-${index + 1}.txt`)),
    );
    view = new surface.Controller({
      multiFilePatch: patch,
      itemType: surface.itemType,
      stagingStatus: surface.stagingStatus,
      relPath: "file-1.txt",
      repository,
      refPatchController,
      refEditor,
      workspace: lumine.workspace,
      commands: lumine.commands,
      config: lumine.config,
      keymaps: lumine.keymaps,
      tooltips: { add: () => new Disposable(), addComposite: () => new Disposable() },
      surfaceFileAtPath: () => {},
      surfaceToCommitPreviewButton: () => {},
      discardLines,
      undoLastDiscard: () => {},
    });
    container.appendChild(view.element);
    await renderEditors();
    spyOn(controller(), "setDiffView").and.callThrough();
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

  function button(mode) {
    return view.element.querySelector(`[data-diff-view="${mode}"]`);
  }

  async function renderEditors() {
    for (let pass = 0; pass < 3; pass++) {
      await flushViews(async () => {});
      const elements = Array.from(view.element.querySelectorAll("lumine-text-editor"));
      const updates = elements.map((element) => element.getNextUpdatePromise());
      for (const element of elements) element.getComponent().scheduleUpdate();
      await Promise.all(updates);
    }
  }

  async function clickLayout(mode) {
    await flushViews(() => {
      button(mode).click();
      return controller().setDiffView.calls.mostRecent().returnValue;
    });
    await renderEditors();
  }

  function expectHeader(surface, mode) {
    const header = view.element.querySelector(".patch-view-ChangesView-header.native-key-bindings");
    const toggles = view.element.querySelectorAll(".patch-view-DiffViewToggle");
    expect(toggles.length).toBe(1);
    expect(header.contains(toggles[0])).toBe(true);
    expect(header.querySelector(".patch-view-ChangesView-title").textContent).toBe(surface.title);
    expect(
      view.element.querySelectorAll(".patch-view-FilePatchView-header [data-diff-view]").length,
    ).toBe(0);
    for (const candidate of ["unified", "side-by-side"]) {
      expect(button(candidate).classList.contains("btn")).toBe(true);
      expect(button(candidate).classList.contains("selected")).toBe(candidate === mode);
      expect(button(candidate).getAttribute("aria-pressed")).toBe(String(candidate === mode));
    }
  }

  function selectedRanges() {
    return patchView()
      .getCanonicalSelectionRanges()
      .map((range) => range.serialize());
  }

  for (const surface of surfaces) {
    describe(surface.name, () => {
      it("defaults to unified and switches the whole patch through one header toggle", async () => {
        const patch = await mount(surface);
        expect(controller().getDiffView()).toBe("unified");
        expect(view.element.querySelectorAll("lumine-text-editor").length).toBe(1);
        expectHeader(surface, "unified");

        await clickLayout("side-by-side");
        expect(controller().getDiffView()).toBe("side-by-side");
        expect(view.element.querySelectorAll("lumine-text-editor").length).toBe(2);
        expect(pair().projection.fileRanges.size).toBe(surface.fileCount);
        expect(pair().editors.old.get().getText()).toContain("old value");
        expect(pair().editors.new.get().getText()).toContain("new value");
        expectHeader(surface, "side-by-side");

        await clickLayout("unified");
        expect(controller().getDiffView()).toBe("unified");
        expect(view.element.querySelectorAll("lumine-text-editor").length).toBe(1);
        expect(patchView().refEditor.get().getBuffer()).toBe(patch.getBuffer());
        expectHeader(surface, "unified");
      });

      it("preserves canonical selected rows and editor focus while changing layouts", async () => {
        await mount(surface);
        const editor = patchView().refEditor.get();
        editor.setSelectedBufferRange(new Range([1, 0], [1, Infinity]), { autoscroll: false });
        editor.getElement().focus();
        await flushViews(async () => {});
        const ranges = selectedRanges();
        const rows = Array.from(controller().state.selectedRows);
        const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        button("side-by-side").dispatchEvent(mouseDown);
        expect(mouseDown.defaultPrevented).toBe(true);
        expect(editor.getElement().contains(document.activeElement)).toBe(true);

        await clickLayout("side-by-side");
        expect(selectedRanges()).toEqual(ranges);
        expect(Array.from(controller().state.selectedRows)).toEqual(rows);
        expect(pair().editors.old.get().getElement().contains(document.activeElement)).toBe(true);
        await clickLayout("unified");
        expect(selectedRanges()).toEqual(ranges);
        expect(Array.from(controller().state.selectedRows)).toEqual(rows);
        expect(patchView().refEditor.get().getElement().contains(document.activeElement)).toBe(
          true,
        );
      });

      it("keeps side-by-side selected after a refreshed patch arrives", async () => {
        await mount(surface);
        await clickLayout("side-by-side");
        const originalController = controller();
        const refreshed = build(
          Array.from({ length: surface.fileCount }, (_, index) =>
            diff(`file-${index + 1}.txt`, "previous content", "refreshed content"),
          ),
        );
        await flushViews(() => view.update({ ...view.props, multiFilePatch: refreshed }));
        await renderEditors();
        expect(controller()).toBe(originalController);
        expect(controller().getDiffView()).toBe("side-by-side");
        expect(pair().editors.old.get().getText()).toContain("previous content");
        expect(pair().editors.new.get().getText()).toContain("refreshed content");
        expectHeader(surface, "side-by-side");
      });

      it("applies the chosen side's canonical line through the repository staging handler", async () => {
        const patch = await mount(surface);
        await clickLayout("side-by-side");
        const editor = pair().editors.new.get();
        editor.setSelectedBufferRange(new Range([1, 0], [1, Infinity]), { autoscroll: false });
        await flushViews(async () => {});
        expect(Array.from(controller().state.selectedRows)).toEqual([2]);
        const selectedPatch =
          surface.stagingStatus === "unstaged"
            ? patch.getStagePatchForLines(new Set([2]))
            : patch.getUnstagePatchForLines(new Set([2]));
        patches.push(selectedPatch);
        const expectedPatch = selectedPatch.toString();
        lumine.commands.dispatch(editor.getElement(), "core:confirm");
        await flushViews(async () => {});
        expect(repository.applyPatchToIndex).toHaveBeenCalledTimes(1);
        expect(appliedPatches).toEqual([expectedPatch]);
      });
    });
  }

  it("forwards the loaded patch controller and editor for changed-file navigation", async () => {
    const loaded = refPatchController.getPromise();
    await mount(surfaces[0]);
    expect(await loaded).toBe(controller());
    controller().goToSourceLine(2);
    expect(refEditor.get()).toBe(patchView().refEditor.get());
    expect(refEditor.get().getCursorBufferPosition().row).toBe(2);
    await clickLayout("side-by-side");
    controller().goToSourceLine(2);
    expect(refEditor.get()).toBe(pair().editors.new.get());
    expect(refEditor.get().getCursorBufferPosition().row).toBe(1);
  });

  it("transfers the external controller reference and clears it when the changes view closes", async () => {
    await mount(surfaces[0]);
    const originalHolder = refPatchController;
    const currentController = controller();
    const replacementHolder = new RefHolder();
    await flushViews(() => view.update({ ...view.props, refPatchController: replacementHolder }));
    expect(originalHolder.getOr(null)).toBeNull();
    expect(replacementHolder.get()).toBe(currentController);
    await view.destroy();
    expect(replacementHolder.getOr(null)).toBeNull();
  });

  it("discards only the selected canonical line in unstaged side-by-side changes", async () => {
    const patch = await mount(surfaces[0]);
    await clickLayout("side-by-side");
    const editor = pair().editors.new.get();
    editor.setSelectedBufferRange(new Range([1, 0], [1, Infinity]), { autoscroll: false });
    await flushViews(async () => {});
    lumine.commands.dispatch(editor.getElement(), "patch-view:discard-selected-lines");
    await flushViews(async () => {});
    expect(discardLines).toHaveBeenCalledOnceWith(patch, new Set([2]), repository);
    expect(repository.applyPatchToIndex).not.toHaveBeenCalled();
  });

  it("keeps keyboard focus on the combined staged changes header buttons", async () => {
    await mount(surfaces[2]);
    for (const mode of ["side-by-side", "unified"]) {
      button(mode).focus();
      await clickLayout(mode);
      expect(document.activeElement).toBe(button(mode));
      expectHeader(surfaces[2], mode);
    }
  });

  it("unstages selections from both files in the combined side-by-side view", async () => {
    const patch = await mount(surfaces[2]);
    await clickLayout("side-by-side");
    const editor = pair().editors.new.get();
    editor.setSelectedBufferRanges(
      [new Range([1, 0], [1, Infinity]), new Range([4, 0], [4, Infinity])],
      { autoscroll: false },
    );
    await flushViews(async () => {});
    expect(Array.from(controller().state.selectedRows)).toEqual([2, 6]);
    expect(controller().state.hasMultipleFileSelections).toBe(true);
    const selectedPatch = patch.getUnstagePatchForLines(new Set([2, 6]));
    patches.push(selectedPatch);
    const expectedPatch = selectedPatch.toString();
    lumine.commands.dispatch(editor.getElement(), "core:confirm");
    await flushViews(async () => {});
    expect(repository.applyPatchToIndex).toHaveBeenCalledTimes(1);
    expect(appliedPatches).toEqual([expectedPatch]);
    expect(appliedPatches[0]).toContain("file-1.txt");
    expect(appliedPatches[0]).toContain("file-2.txt");
  });

  it("uses shared headers, wrapping, and one right scrollbar for combined staged changes", async () => {
    container.style.width = "700px";
    await mount(surfaces[2], [
      diff(
        "first.txt",
        "old words ".repeat(45),
        "new words ".repeat(15),
        Array.from({ length: 80 }, (_, index) => ` context ${index}`),
      ),
      diff("second.txt"),
    ]);
    await clickLayout("side-by-side");
    const oldEditor = pair().editors.old.get();
    const newEditor = pair().editors.new.get();
    const oldElement = oldEditor.getElement();
    const newElement = newEditor.getElement();
    expect(pair().sharedHeaders.filter((record) => record.kind === "file").length).toBe(2);
    expect(pair().sharedHeaders.filter((record) => record.kind === "hunk").length).toBe(2);
    for (const element of [oldElement, newElement]) {
      expect(element.querySelector(".patch-view-FilePatchView-header")).toBeNull();
      expect(element.querySelector(".patch-view-HunkHeaderView")).toBeNull();
    }
    for (const editor of [oldEditor, newEditor]) {
      expect(editor.isSoftWrapped()).toBe(true);
      expect(editor.getScreenLineCount()).toBeGreaterThan(editor.getLineCount());
    }
    for (let row = 0; row < pair().projection.rows.length; row++) {
      expect(oldElement.pixelPositionForBufferPosition([row, 0]).top).toBeCloseTo(
        newElement.pixelPositionForBufferPosition([row, 0]).top,
        0,
      );
    }
    const visibleScrollbars = Array.from(
      view.element.querySelectorAll(".vertical-scrollbar"),
    ).filter((scrollbar) => getComputedStyle(scrollbar).visibility !== "hidden");
    expect(visibleScrollbars).toEqual([newElement.querySelector(".vertical-scrollbar")]);
    expect(newElement.getMaxScrollTop()).toBeGreaterThan(200);
    oldElement.setScrollTop(150);
    await renderEditors();
    expect(newElement.getScrollTop()).toBe(150);
    expect(oldElement.getScrollTop()).toBe(150);
    expectHeader(surfaces[2], "side-by-side");
  });
});
