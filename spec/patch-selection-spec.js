/** @babel */
import path from "path";
import { Range } from "lumine";
import ChangesView from "../lib/views/changes-view";
import { buildMultiFilePatch } from "../lib/models/patch";
import { flushViews } from "./helpers/etch";

describe("selection in mounted patch views", () => {
  let view, patch, container, stylesheet;

  beforeEach(() => {
    stylesheet = lumine.themes.requireStylesheet(path.join(__dirname, "..", "styles", "main.css"));
    container = document.createElement("div");
    container.style.cssText = `
      display: flex; width: 1000px; height: 500px;
      --syntax-selection-color: rgb(100, 110, 120);
      --syntax-background-color: rgb(220, 230, 240);
    `;
    jasmine.attachToDOM(container);
  });

  afterEach(async () => {
    await view?.destroy();
    view = null;
    patch?.dispose();
    patch = null;
    container.remove();
    stylesheet.dispose();
  });

  function controller() {
    return view.refPatchController.get();
  }

  function patchView() {
    return controller().refView.get();
  }

  function editor() {
    return patchView().state.diffView === "side-by-side"
      ? patchView().refSideBySide.get().editors.new.get()
      : patchView().refEditor.get();
  }

  async function paint() {
    await flushViews(() => {});
    const elements = Array.from(view.element.querySelectorAll("lumine-text-editor"));
    const pending = elements.map((element) => element.getNextUpdatePromise());
    for (const element of elements) element.getComponent().scheduleUpdate();
    await Promise.all(pending);
    await globalThis.flushMicrotasks();
  }

  async function mount(layout) {
    patch = buildMultiFilePatch([
      {
        oldPath: "example.txt",
        newPath: "example.txt",
        oldMode: "100644",
        newMode: "100644",
        status: "modified",
        hunks: [
          {
            oldStartLine: 1,
            oldLineCount: 0,
            newStartLine: 1,
            newLineCount: 1,
            heading: "",
            lines: ["+new value"],
          },
        ],
      },
    ]);
    view = new ChangesView({
      title: "Changes",
      multiFilePatch: patch,
      stagingStatus: "unstaged",
      surfaceKind: "file",
      readOnly: false,
      initialDiffView: layout,
      clipboard: { write: jasmine.createSpy("copy diff").and.resolveTo() },
      repository: { getWorkingDirectoryPath: () => path.dirname(__filename) },
      discardLines: jasmine.createSpy("discard rows").and.resolveTo(),
      workspace: lumine.workspace,
      commands: lumine.commands,
      config: lumine.config,
      keymaps: lumine.keymaps,
      tooltips: lumine.tooltips,
      surface: () => {},
    });
    container.appendChild(view.element);
    await paint();
    await paint();
  }

  async function clickHeader() {
    await flushViews(() => {
      view.element
        .querySelector(".git-panel-HunkHeaderView-title")
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });
    await paint();
    expect(patchView().element.matches(":focus-within")).toBe(true);
  }

  async function selectText(range) {
    await flushViews(() => {
      editor().getElement().focus();
      editor().setSelectedBufferRange(range, { autoscroll: false });
    });
    await paint();
  }

  function expectMode(mode) {
    expect(controller().state.selectionMode).toBe(mode);
    expect(patchView().props.selectionMode).toBe(mode);
    expect(patchView().element.classList.contains("git-panel-FilePatchView--hunkMode")).toBe(
      mode === "hunk",
    );
  }

  function selectionColor() {
    const regions = editor().getElement().querySelectorAll(".highlight.selection .region");
    expect(regions.length).toBeGreaterThan(0);
    const colors = Array.from(regions, (region) => getComputedStyle(region).backgroundColor);
    for (const color of colors) expect(color).not.toBe("rgba(0, 0, 0, 0)");
    return colors[0];
  }

  for (const layout of ["unified", "side-by-side"]) {
    it(`selects a ${layout} hunk when clicking its header leaves the native range unchanged`, async () => {
      await mount(layout);
      if (layout === "unified") {
        expectMode("hunk");
        expect(Array.from(patchView().props.selectedRows)).toEqual(
          Array.from(controller().state.selectedRows),
        );
        expect(view.element.querySelector(".git-panel-HunkHeaderView--isSelected")).not.toBeNull();
      }
      await clickHeader();
      const hunkRange = editor().getSelectedBufferRange();
      expectMode("hunk");
      expect(Array.from(controller().state.selectedRows)).toEqual([
        patch.getFilePatches()[0].getHunks()[0].getRange().start.row,
      ]);
      expect(view.element.querySelector(".git-panel-HunkHeaderView--isSelected")).not.toBeNull();
      const hunkColor = selectionColor();

      await selectText(new Range([hunkRange.start.row, 1], [hunkRange.end.row, 6]));
      await selectText(hunkRange);
      expectMode("line");
      expect(selectionColor()).not.toBe(hunkColor);
      const before = editor().getSelectedBufferRange();
      await clickHeader();
      expect(editor().getSelectedBufferRange().isEqual(before)).toBe(true);
      expectMode("hunk");
      expect(selectionColor()).toBe(hunkColor);
    });

    it(`leaves ${layout} hunk mode after repeated header clicks followed by native selection on the same row`, async () => {
      await mount(layout);
      await clickHeader();
      const hunkRange = editor().getSelectedBufferRange();
      await clickHeader();
      expect(editor().getSelectedBufferRange().isEqual(hunkRange)).toBe(true);
      const hunkColor = selectionColor();
      const selectedRows = Array.from(controller().state.selectedRows);
      await selectText(new Range([hunkRange.start.row, 1], [hunkRange.end.row, 6]));
      const nativeRange = editor().getSelectedBufferRange();
      expect(nativeRange.start.row).toBe(hunkRange.start.row);
      expect(nativeRange.end.row).toBe(hunkRange.end.row);
      expect(Array.from(controller().state.selectedRows)).toEqual(selectedRows);
      expectMode("line");
      expect(selectionColor()).not.toBe(hunkColor);
    });
  }
});
