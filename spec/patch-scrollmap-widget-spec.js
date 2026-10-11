/** @babel */
import path from "path";
import { CompositeDisposable, Disposable } from "lumine";
import MultiFilePatchView from "../lib/views/multi-file-patch-view";
import PaneItemHost from "../lib/items/pane-item-host";
import { buildMultiFilePatch } from "../lib/models/patch";
import { consumeScrollmapWidget } from "../lib/scrollmap-widget";
import { flushViews } from "./helpers/etch";

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
    stylesheet = lumine.themes.requireStylesheet(path.join(__dirname, "..", "styles", "main.css"));
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

  async function mount(patch, layout, parent = container) {
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
      if (marker.end !== undefined) {
        expect(widget.items[index].end).toBeGreaterThanOrEqual(widget.items[index].prc);
      }
    }
    expect(widget.element.style.width).toBe(
      `${component.getVerticalScrollbarWidth() || lumine.config.get("scrollmap.overlayWidth") || 0}px`,
    );
    expect(widget.element.style.height).toBe(`${component.getScrollContainerClientHeight()}px`);
  }

  for (const layout of ["unified", "side-by-side"]) {
    it(`attaches a late widget to the native scrollbar and uses wrapped/header pixels in ${layout}`, async () => {
      const patch = build([diff("first.txt"), diff("second.txt")]);
      await mount(patch, layout);
      expect(widgets.length).toBe(0);
      subscriptions.add(consumeScrollmapWidget(Widget));
      await paint();
      const widget = widgets[0];
      const state = view.getScrollmapState();
      expect(widget.element.parentElement).toBe(state.editor.getElement());
      expect(widget.items.filter((item) => item.cls.includes("marker-git-file")).length).toBe(2);
      expect(widget.items.filter((item) => item.cls.includes("marker-git-hunk")).length).toBe(4);
      expect(widget.items.every((item) => item.position === undefined)).toBe(true);
      expect(state.editor.getScreenLineCount()).toBeGreaterThan(state.editor.getLineCount());
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
    expect(widget.element.parentElement).toBe(pair.editors.new.get().getElement());
    expect(view.element.querySelectorAll(".git-panel-patch-scrollmap").length).toBe(1);
    pair.editors.old.get().getElement().focus();
    expect(pair.activeSide).toBe("old");
    pair.setCanonicalSelectionRanges([patch.getFilePatches()[0].getHunks()[1].getRange()]);
    await paint();
    expect(widget.items.filter((item) => item.cls.includes("marker-git-hunk current")).length).toBe(
      1,
    );
    expect(widget.element.parentElement).toBe(pair.editors.new.get().getElement());
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
      const fileProbe = maps[0].querySelector(".marker-git-file.scrollmap-style-probe");
      const hunkProbe = maps[0].querySelector(".marker-git-hunk.scrollmap-style-probe");
      const fileColor = getComputedStyle(fileProbe).backgroundColor;
      const hunkColor = getComputedStyle(hunkProbe).backgroundColor;
      expect(fileColor).not.toBe(hunkColor);
      expect(getComputedStyle(fileProbe).opacity).toBe("0.7");
      expect(getComputedStyle(hunkProbe).opacity).toBe("0.7");
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
      expect(getComputedStyle(currentFileProbe).opacity).toBe("1");
      expect(getComputedStyle(currentHunkProbe).opacity).toBe("1");
    } finally {
      lease?.dispose();
      if (!scrollmapWasActive) await lumine.packages.deactivatePackage("scrollmap");
      if (!markerWasActive) await lumine.packages.deactivatePackage("marker");
    }
  });
});
