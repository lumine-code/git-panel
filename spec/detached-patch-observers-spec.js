/** @babel */
import path from "node:path";
import { Disposable } from "lumine";
import MultiFilePatchView from "../lib/views/multi-file-patch-view.js";
import ImagePatchView from "../lib/views/image-patch-view.js";
import { buildMultiFilePatch } from "../lib/models/patch/index.js";
import { addPatchScrollmap, consumeScrollmapWidget } from "../lib/scrollmap-widget.js";
import { flushViews } from "./helpers/etch.js";

describe("Patch measurement across presentation windows", () => {
  let extra, view, patch, stylesheet;
  const leases = [];

  beforeEach(async () => {
    const root = lumine.workspace.getElement();
    root.style.cssText = "width: 900px; height: 500px";
    jasmine.attachToDOM(root);
    stylesheet = lumine.themes.requireStylesheet(
      path.join(import.meta.dirname, "..", "styles", "main.css"),
    );
    extra = await lumine.workspace.openEditorWindow({ show: false });
  });

  afterEach(async () => {
    while (leases.length) leases.pop().dispose();
    await view?.destroy();
    view = null;
    patch?.dispose();
    patch = null;
    await lumine.workspace.discardEditorWindows();
    stylesheet.dispose();
  });

  async function mount(layout) {
    patch = buildMultiFilePatch(
      [
        {
          oldPath: "example.txt",
          newPath: "example.txt",
          oldMode: "100644",
          newMode: "100644",
          status: "modified",
          hunks: [
            {
              oldStartLine: 1,
              newStartLine: 1,
              oldLineCount: 2,
              newLineCount: 2,
              heading: "",
              lines: [" context", `-${"long words ".repeat(30)}`, "+short"],
            },
          ],
        },
      ],
      { largeDiffThreshold: Infinity },
    );
    view = new MultiFilePatchView({
      multiFilePatch: patch,
      initialDiffView: layout,
      workspace: lumine.workspace,
      commands: lumine.commands,
      config: lumine.config,
      keymaps: lumine.keymaps,
      tooltips: { add: () => new Disposable(), addComposite: () => new Disposable() },
      stagingStatus: "unstaged",
      selectedRows: new Set(),
      selectionMode: "hunk",
      selectedRowsChanged() {},
      toggleRows() {},
      discardRows() {},
      toggleFile() {},
      openFile() {},
      surface() {},
      undoLastDiscard() {},
      diveIntoMirrorPatch() {},
    });
    const item = { element: view.element, getTitle: () => "Patch measurement" };
    await lumine.workspace.open(item);
    await flushViews(() => {});
    return item;
  }

  it("rebinds full-width controls to the destination document", async () => {
    const item = await mount("unified");
    const observer = view.fullWidthHeaders.resizeObserver;
    const disconnect = spyOn(observer, "disconnect").and.callThrough();
    await lumine.workspace.movePaneItem(item, {
      targetPane: extra.getEditorContainer().getActivePane(),
    });
    expect(disconnect).toHaveBeenCalled();
    expect(
      view.fullWidthHeaders.resizeObserver instanceof extra.getDOMWindow().ResizeObserver,
    ).toBeTrue();
  });

  it("rebinds side-by-side wrapping and shared headers to the destination document", async () => {
    const item = await mount("side-by-side");
    const pair = view.refSideBySide.get();
    const observers = [
      pair.wrapAlignment.resizeObserver,
      pair.wrapAlignment.selectionObserver,
      pair.headerResizeObserver,
      pair.headerPaintObserver,
    ];
    const disconnects = observers.map((observer) =>
      spyOn(observer, "disconnect").and.callThrough(),
    );
    await lumine.workspace.movePaneItem(item, {
      targetPane: extra.getEditorContainer().getActivePane(),
    });
    for (const disconnect of disconnects) expect(disconnect).toHaveBeenCalled();
    expect(
      pair.wrapAlignment.resizeObserver instanceof extra.getDOMWindow().ResizeObserver,
    ).toBeTrue();
    expect(pair.headerResizeObserver instanceof extra.getDOMWindow().ResizeObserver).toBeTrue();
  });

  it("rebinds the scrollbar widget's editor observer on transfer", async () => {
    const editor = await lumine.workspace.open();
    const widgets = [];
    class Widget {
      constructor() {
        this.element = document.createElement("div");
        widgets.push(this);
      }
      setItems() {}
      update() {}
      destroy() {
        this.element.remove();
      }
    }
    leases.push(consumeScrollmapWidget(Widget));
    const source = spyOn(window, "ResizeObserver").and.callThrough();
    leases.push(
      addPatchScrollmap({
        getScrollmapEditor: () => editor,
        getScrollmapState: () => ({ editor, markers: [] }),
        observeScrollmapState(callback) {
          callback();
          return new Disposable();
        },
      }),
    );
    await globalThis.waitForFrames(() => widgets.length === 1);
    const observer = source.calls.mostRecent().returnValue;
    const disconnect = spyOn(observer, "disconnect").and.callThrough();
    await lumine.workspace.movePaneItem(editor, {
      targetPane: extra.getEditorContainer().getActivePane(),
    });
    expect(disconnect).toHaveBeenCalled();
  });

  it("rebinds image preview sizing to the destination document", async () => {
    patch = buildMultiFilePatch([
      {
        oldPath: "image.png",
        newPath: "image.png",
        oldMode: "100644",
        newMode: "100644",
        status: "modified",
        binary: true,
        hunks: [],
      },
    ]);
    view = new ImagePatchView({
      filePatch: patch.getFilePatches()[0],
      document: { kind: "file", stagingStatus: "unstaged" },
      repository: { readFileAtEndpoint: async () => null },
    });
    const item = { element: view.element, getTitle: () => "Image patch" };
    await lumine.workspace.open(item);
    await flushViews(() => {});
    const observer = view.resizeObserver;
    const disconnect = spyOn(observer, "disconnect").and.callThrough();
    await lumine.workspace.movePaneItem(item, {
      targetPane: extra.getEditorContainer().getActivePane(),
    });
    expect(disconnect).toHaveBeenCalled();
    expect(view.resizeObserver instanceof extra.getDOMWindow().ResizeObserver).toBeTrue();
  });
});
