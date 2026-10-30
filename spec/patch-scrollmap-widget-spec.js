/** @babel */
import path from "path";
import { CompositeDisposable, Disposable } from "lumine";
import MultiFilePatchView from "../lib/views/multi-file-patch-view.js";
import PaneItemHost from "../lib/items/pane-item-host.js";
import { buildMultiFilePatch } from "../lib/models/patch/index.js";
import { consumeScrollmapWidget } from "../lib/scrollmap-widget.js";
import { flushViews } from "./helpers/etch.js";

function diff(filePath, starts = [1, 20]) {
  return {
    oldPath: filePath,
    newPath: filePath,
    oldMode: "100644",
    newMode: "100644",
    status: "modified",
    hunks: starts.map((line) => ({
      oldStartLine: line,
      newStartLine: line,
      oldLineCount: 2,
      newLineCount: 2,
      heading: `Section ${line}`,
      lines: [" context", `-${"before ".repeat(45)}`, `+${"after ".repeat(45)}`],
    })),
  };
}

describe("patch scrollbar widget", () => {
  let view, container, stylesheet, subscriptions, host, widgets;
  const patches = [];

  beforeEach(() => {
    subscriptions = new CompositeDisposable();
    widgets = [];
    stylesheet = lumine.themes.requireStylesheet(
      path.join(import.meta.dirname, "..", "styles", "main.css"),
    );
    container = document.createElement("div");
    container.style.cssText = "display: flex; width: 700px; height: 300px;";
    jasmine.attachToDOM(container);
  });

  afterEach(async () => {
    subscriptions.dispose();
    host?.destroy();
    host = null;
    await view?.destroy();
    view = null;
    while (patches.length) patches.pop().dispose();
    container.remove();
    stylesheet.dispose();
  });

  class Widget {
    constructor() {
      this.element = document.createElement("div");
      this.element.className = "simplemap";
      this.element.style.cssText = "position: absolute; top: 0; right: 0; pointer-events: none;";
      this.items = [];
      this.setItems = jasmine.createSpy("setItems").and.callFake((items) => (this.items = items));
      this.update = jasmine.createSpy("update");
      this.destroy = jasmine.createSpy("destroy").and.callFake(() => this.element.remove());
      widgets.push(this);
    }
  }

  function build(files, options) {
    const patch = buildMultiFilePatch(files, options);
    patches.push(patch);
    return patch;
  }

  async function paint() {
    await flushViews(() => {});
    const elements = Array.from(view.element.querySelectorAll("lumine-text-editor"));
    const pending = elements.map((element) => element.getNextUpdatePromise());
    for (const element of elements) element.getComponent().scheduleUpdate();
    await Promise.all(pending);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  async function mount(patch, layout, parent = container, props = {}) {
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
      selectedRowsChanged: () => {},
      toggleRows: () => {},
      discardRows: () => {},
      toggleFile: () => {},
      toggleModeChange: () => {},
      toggleSymlinkChange: () => {},
      openFile: () => {},
      surface: () => {},
      undoLastDiscard: () => {},
      diveIntoMirrorPatch: () => {},
      ...props,
    });
    parent.append(view.element);
    await paint();
    await paint();
  }

  function assertPercentages(widget) {
    const state = view.getScrollmapState();
    const component = state.editor.getElement().getComponent();
    expect(widget.items.length).toBe(state.markers.length);
    for (const [index, marker] of state.markers.entries()) {
      expect(widget.items[index].prc).toBeCloseTo(
        Math.max(0, Math.min(100, (marker.top / component.getScrollHeight()) * 100)),
        5,
      );
      expect(widget.items[index].end).toBeUndefined();
      expect(widget.items[index].height).toBeUndefined();
    }
    expect(widget.element.style.width).toBe(
      `${lumine.scrollbars.getGeometry(state.editor.getElement()).verticalSize}px`,
    );
    const geometry = lumine.scrollbars.getGeometry(state.editor.getElement());
    expect(widget.element.style.height).toBe(
      `${geometry.verticalTrackSize ?? geometry.viewportHeight}px`,
    );
  }

  function longLineScreenRows(editor) {
    // Inspect an already projected line. getScreenLineCount() materializes
    // the lazy tail and changes the scrollbar estimate after the map paints.
    return editor
      .screenRangeForBufferRange([
        [1, 0],
        [1, Infinity],
      ])
      .getRowCount();
  }

  for (const layout of ["unified", "side-by-side"]) {
    it(`draws no markers for compact ${layout} views without headers`, async () => {
      subscriptions.add(consumeScrollmapWidget(Widget));
      await mount(build([diff("first.txt")]), layout, container, { compact: true });
      expect(view.element.querySelector(".git-panel-FilePatchView-header")).toBeNull();
      expect(view.element.querySelector(".git-panel-HunkHeaderView-title")).toBeNull();
      expect(view.getScrollmapState().markers).toEqual([]);
      expect(widgets[0].items).toEqual([]);
    });

    it(`attaches a late widget to the native scrollbar and uses wrapped/header pixels in ${layout}`, async () => {
      const patch = build([diff("first.txt"), diff("second.txt")]);
      await mount(patch, layout);
      expect(widgets.length).toBe(0);
      subscriptions.add(consumeScrollmapWidget(Widget));
      await paint();
      const widget = widgets[0];
      const state = view.getScrollmapState();
      expect(widget.update).not.toHaveBeenCalled();
      expect(widget.element.parentElement).toBe(
        lumine.scrollbars.getVerticalTrack(state.editor.getElement()),
      );
      expect(widget.items.filter((item) => item.cls.includes("marker-git-file")).length).toBe(2);
      expect(widget.items.filter((item) => item.cls.includes("marker-git-hunk")).length).toBe(4);
      expect(widget.items.every((item) => item.position === undefined)).toBe(true);
      expect(longLineScreenRows(state.editor)).toBeGreaterThan(1);
      assertPercentages(widget);
      const secondFile = widget.items.filter((item) => item.cls.includes("marker-git-file"))[1];
      expect(secondFile.prc).toBeGreaterThan(0);

      await flushViews(() =>
        view.navigateToNavigationHeader(view.getNavigationHeaders()[1].children[1], {
          focus: false,
        }),
      );
      await paint();
      const current = widget.items.filter((item) => item.cls.includes(" current"));
      expect(current.filter((item) => item.cls.includes("marker-git-file")).length).toBe(1);
      expect(current.filter((item) => item.cls.includes("marker-git-hunk")).length).toBe(1);
      const count = widget.setItems.calls.count();
      view.navigationEmitter.emit("did-change-scrollmap-state");
      view.navigationEmitter.emit("did-change-scrollmap-state");
      await paint();
      expect(widget.setItems.calls.count()).toBe(count);
    });

    it(`maps collapsed file blocks without creating fake markers for hidden hunks in ${layout}`, async () => {
      subscriptions.add(consumeScrollmapWidget(Widget));
      const patch = build([diff("first.txt"), diff("second.txt")], { largeDiffThreshold: 1 });
      await mount(patch, layout);
      const widget = widgets[0];
      expect(widget.items.length).toBe(2);
      expect(widget.items[0].cls).toContain("marker-git-file");
      expect(widget.items[1].prc).toBeGreaterThan(widget.items[0].prc);
      expect(patch.getBuffer().isEmpty()).toBe(true);
      await flushViews(() =>
        view.navigateToNavigationHeader(view.getNavigationHeaders()[1].children[0], {
          focus: false,
        }),
      );
      await paint();
      expect(widget.items.filter((item) => item.cls.includes("marker-git-hunk")).length).toBe(2);
      expect(patch.getFilePatches()[0].getRenderStatus().isVisible()).toBe(false);
      assertPercentages(widget);
    });

    it(`repaints wrapped geometry without buffer edits or an element resize in ${layout}`, async () => {
      subscriptions.add(consumeScrollmapWidget(Widget));
      await mount(build([diff("first.txt"), diff("second.txt")]), layout);
      const { editor } = view.getScrollmapState();
      const element = editor.getElement();
      const component = element.getComponent();
      const text = editor.getText();
      const width = element.getBoundingClientRect().width;
      const wrappedRows = longLineScreenRows(editor);
      const updates = widgets[0].setItems.calls.count();
      // Settling character measurements changes wrapping at the same pixel
      // width, so ResizeObserver and buffer change events cannot detect it.
      spyOn(component, "getScrollContainerClientWidthInBaseCharacters").and.returnValue(20);
      await paint();
      expect(editor.getText()).toBe(text);
      expect(element.getBoundingClientRect().width).toBe(width);
      expect(longLineScreenRows(editor)).toBeGreaterThan(wrappedRows);
      expect(widgets[0].setItems.calls.count()).toBeGreaterThan(updates);
      assertPercentages(widgets[0]);
    });
  }

  it("moves to the right rail on layout replacement and keeps old-side selection current", async () => {
    subscriptions.add(consumeScrollmapWidget(Widget));
    const patch = build([diff("first.txt")]);
    await mount(patch, "unified");
    const previous = widgets[0];
    const previousEditor = view.getScrollmapState().editor;
    await flushViews(() => view.didChangeDiffView("side-by-side"));
    await paint();
    const pair = view.refSideBySide.get();
    const widget = widgets.at(-1);
    expect(previous.destroy).toHaveBeenCalledTimes(1);
    expect(previousEditor.isDestroyed()).toBe(true);
    expect(widget.element.parentElement).toBe(
      lumine.scrollbars.getVerticalTrack(pair.editors.new.get().getElement()),
    );
    expect(view.element.querySelectorAll(".git-panel-patch-scrollmap").length).toBe(1);
    pair.editors.old.get().getElement().focus();
    expect(pair.activeSide).toBe("old");
    pair.setCanonicalSelectionRanges([patch.getFilePatches()[0].getHunks()[1].getRange()]);
    await paint();
    expect(widget.items.filter((item) => item.cls.includes("marker-git-hunk current")).length).toBe(
      1,
    );
    expect(widget.element.parentElement).toBe(
      lumine.scrollbars.getVerticalTrack(pair.editors.new.get().getElement()),
    );
    assertPercentages(widget);
  });

  it("replaces markers with the current patch while retaining the same pane view", async () => {
    subscriptions.add(consumeScrollmapWidget(Widget));
    await mount(build([diff("old.txt")]), "unified");
    const oldItems = widgets[0].items;
    const next = build([diff("new.txt", [100])]);
    await flushViews(() => view.update({ ...view.props, multiFilePatch: next }));
    await paint();
    const widget = widgets.at(-1);
    expect(widget.items).not.toBe(oldItems);
    expect(widget.items.length).toBe(2);
    expect(view.getNavigationHeaders()[0].text).toBe("new.txt");
    expect(view.element.querySelectorAll(".git-panel-patch-scrollmap").length).toBe(1);
    assertPercentages(widget);
  });

  it("moves the thumb without rebuilding file and hunk markers", async () => {
    subscriptions.add(consumeScrollmapWidget(Widget));
    await mount(build([diff("first.txt"), diff("second.txt")]), "unified");
    await paint();
    const editor = view.getScrollmapEditor();
    const state = spyOn(view, "getScrollmapState").and.callThrough();
    const count = widgets[0].setItems.calls.count();
    editor.getElement().setScrollTop(100);
    await paint();
    expect(state).not.toHaveBeenCalled();
    expect(widgets[0].setItems.calls.count()).toBe(count);
  });

  it("waits for patch-host hydration and removes widgets on service withdrawal", async () => {
    host = PaneItemHost.create("git-patch");
    container.append(host.getElement());
    const lease = consumeScrollmapWidget(Widget);
    subscriptions.add(lease);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(widgets.length).toBe(0);
    await mount(build([diff("first.txt")]), "unified", host.getElement());
    host.hydrate(view);
    const widget = widgets[0];
    expect(widget.element.isConnected).toBe(true);
    const state = spyOn(view, "getScrollmapState").and.callThrough();
    lease.dispose();
    expect(widget.destroy).toHaveBeenCalledTimes(1);
    expect(widget.element.isConnected).toBe(false);
    view.navigationEmitter.emit("did-change-scrollmap-state");
    await paint();
    expect(state).not.toHaveBeenCalled();
    subscriptions.add(consumeScrollmapWidget(Widget));
    await paint();
    expect(widgets.length).toBe(2);
    expect(view.element.querySelectorAll(".git-panel-patch-scrollmap").length).toBe(1);
    host.destroy();
    await paint();
    expect(widgets[1].destroy).toHaveBeenCalledTimes(1);
  });

  it("cancels a queued repaint when its provider edge disappears before first paint", async () => {
    await mount(build([diff("first.txt")]), "unified");
    const lease = consumeScrollmapWidget(Widget);
    lease.dispose();
    await paint();
    expect(widgets.length).toBe(0);
  });

  it("paints real Simplemap markers with the marker and scrollmap services active", async () => {
    const markerWasActive = lumine.packages.isPackageActive("marker");
    const scrollmapWasActive = lumine.packages.isPackageActive("scrollmap");
    let lease;
    try {
      await lumine.packages.activatePackage("marker");
      const scrollmap = (await lumine.packages.activatePackage("scrollmap")).mainModule;
      const Simplemap = scrollmap.provideScrollmapWidget();
      let widget;
      class CapturedSimplemap extends Simplemap {
        constructor() {
          super();
          widget = this;
        }
      }
      lease = consumeScrollmapWidget(CapturedSimplemap);
      subscriptions.add(lease);
      await mount(build([diff("first.txt")]), "side-by-side");
      const maps = view.element.querySelectorAll(".git-panel-patch-scrollmap");
      expect(maps.length).toBe(1);
      const canvas = maps[0].querySelector("canvas");
      expect(canvas).not.toBeNull();
      expect(canvas.width).toBeGreaterThan(0);
      expect(canvas.height).toBeGreaterThan(0);
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      expect(pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
      for (let row = 0; row < canvas.height; row++) {
        expect(pixels[row * canvas.width * 4 + 3]).toBe(0);
        expect(pixels[(row * canvas.width + canvas.width - 1) * 4 + 3]).toBe(0);
      }
      const centerColor = (item) => {
        const row = Math.min(canvas.height - 1, Math.floor((item.prc / 100) * canvas.height) + 1);
        const offset = (row * canvas.width + Math.floor(canvas.width / 2)) * 4;
        const color = Array.from(pixels.slice(offset, offset + 4));
        expect(color[3]).toBeGreaterThan(0);
        return color.slice(0, 3);
      };
      const fileItem = widget.items.find((item) => item.cls.includes("marker-git-file"));
      const hunkItem = widget.items.find((item) => item.cls.includes("marker-git-hunk"));
      expect(centerColor(fileItem)).not.toEqual(centerColor(hunkItem));
      expect(
        widget.items.every((item) => item.end === undefined && item.height === undefined),
      ).toBe(true);
      const columnsFor = (item) => {
        const row = Math.min(canvas.height - 1, Math.floor((item.prc / 100) * canvas.height) + 1);
        return Array.from({ length: canvas.width }, (_, column) => column).filter(
          (column) => pixels[(row * canvas.width + column) * 4 + 3] > 0,
        );
      };
      const fileColumns = columnsFor(fileItem);
      const hunkColumns = columnsFor(hunkItem);
      expect(fileColumns).toEqual(hunkColumns);
      expect(fileColumns.length).toBeGreaterThan(0);
      expect(fileColumns.length).toBeLessThan(canvas.width);
      expect(
        Math.abs((fileColumns[0] + fileColumns.at(-1) + 1) / 2 - canvas.width / 2),
      ).toBeLessThanOrEqual(1);
      const paintedRuns = [];
      for (let row = 0; row < canvas.height; row++) {
        const alpha = pixels[(row * canvas.width + Math.floor(canvas.width / 2)) * 4 + 3];
        if (!alpha) continue;
        const previous = paintedRuns.at(-1);
        if (previous && previous.end === row - 1) previous.end = row;
        else paintedRuns.push({ start: row, end: row });
      }
      expect(paintedRuns.length).toBe(widget.items.length);
      for (const run of paintedRuns) {
        expect(run.end - run.start + 1).toBeLessThanOrEqual(
          Math.ceil(3 * window.devicePixelRatio) + 1,
        );
      }
      const fileProbe = maps[0].querySelector(".marker-git-file.scrollmap-style-probe");
      const hunkProbe = maps[0].querySelector(".marker-git-hunk.scrollmap-style-probe");
      const fileColor = getComputedStyle(fileProbe).backgroundColor;
      const hunkColor = getComputedStyle(hunkProbe).backgroundColor;
      expect(fileColor).not.toBe(hunkColor);
      expect(getComputedStyle(fileProbe).width).toBe(getComputedStyle(hunkProbe).width);
      expect(getComputedStyle(fileProbe).height).toBe("3px");
      expect(getComputedStyle(hunkProbe).height).toBe("2px");
      expect(getComputedStyle(fileProbe).opacity).toBe("0.7");
      expect(getComputedStyle(hunkProbe).opacity).toBe("0.7");
      const assertDefaultCenter = () => {
        const baseProbe = widget.canvas.styles.probeFor("marker");
        expect(baseProbe.className).toBe("marker scrollmap-style-probe");
        baseProbe.style.backgroundColor = "rgb(255, 255, 255)";
        const baseWidth = getComputedStyle(baseProbe).width;
        const file = maps[0].querySelector(".marker-git-file.scrollmap-style-probe");
        const hunk = maps[0].querySelector(".marker-git-hunk.scrollmap-style-probe");
        expect(getComputedStyle(file).width).toBe(baseWidth);
        expect(getComputedStyle(hunk).width).toBe(baseWidth);
        const items = widget.items;
        const baseItem = { prc: 95 };
        widget.setItems([...items, baseItem]);
        lumine.views.performDocumentUpdate();
        const drawn = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        const columns = (item) => {
          const row = Math.min(canvas.height - 1, Math.ceil((item.prc / 100) * canvas.height));
          return Array.from({ length: canvas.width }, (_, column) => column).filter(
            (column) => drawn[(row * canvas.width + column) * 4 + 3] > 0,
          );
        };
        const baseColumns = columns(baseItem);
        expect(baseColumns.length).toBeGreaterThan(0);
        expect(columns(items.find((item) => item.cls.includes("marker-git-file")))).toEqual(
          baseColumns,
        );
        expect(columns(items.find((item) => item.cls.includes("marker-git-hunk")))).toEqual(
          baseColumns,
        );
        widget.setItems(items);
        return baseWidth;
      };
      const baseWidth = assertDefaultCenter();
      await flushViews(() =>
        view.navigateToNavigationHeader(view.getNavigationHeaders()[0].children[0], {
          focus: false,
        }),
      );
      await paint();
      const currentFileProbe = maps[0].querySelector(
        ".marker-git-file.current.scrollmap-style-probe",
      );
      const currentHunkProbe = maps[0].querySelector(
        ".marker-git-hunk.current.scrollmap-style-probe",
      );
      expect(getComputedStyle(currentFileProbe).backgroundColor).toBe(fileColor);
      expect(getComputedStyle(currentHunkProbe).backgroundColor).toBe(hunkColor);
      expect(getComputedStyle(currentFileProbe).width).toBe(
        getComputedStyle(currentHunkProbe).width,
      );
      expect(getComputedStyle(currentFileProbe).width).toBe(baseWidth);
      expect(getComputedStyle(currentFileProbe).height).toBe("3px");
      expect(getComputedStyle(currentHunkProbe).height).toBe("2px");
      expect(getComputedStyle(currentFileProbe).opacity).toBe("1");
      expect(getComputedStyle(currentHunkProbe).opacity).toBe("1");
      const readGeometry = lumine.scrollbars.getGeometry.bind(lumine.scrollbars);
      spyOn(lumine.scrollbars, "getGeometry").and.callFake((element) => ({
        ...readGeometry(element),
        verticalSize: 3,
      }));
      widget.update();
      await paint();
      expect(widget.element.style.width).toBe("3px");
      assertDefaultCenter();
    } finally {
      lease?.dispose();
      if (!scrollmapWasActive) await lumine.packages.deactivatePackage("scrollmap");
      if (!markerWasActive) await lumine.packages.deactivatePackage("marker");
    }
  });
});
