/** @babel */
import path from "path";
import { Range } from "lumine";
import ChangesView from "../lib/views/changes-view";
import { buildMultiFilePatch } from "../lib/models/patch";
import { flushViews } from "./helpers/etch";

describe("shared read-only diff views", () => {
  let view, container, stylesheet;
  const patches = [];

  function patch(value = "new") {
    const model = buildMultiFilePatch([
      {
        oldPath: "example.txt",
        newPath: "example.txt",
        oldMode: "100644",
        newMode: "100755",
        status: "modified",
        hunks: [
          {
            oldStartLine: 10,
            oldLineCount: 3,
            newStartLine: 10,
            newLineCount: 3,
            heading: "",
            lines: [" before", "-old", `+${value}`, " after"],
          },
        ],
      },
    ]);
    patches.push(model);
    return model;
  }

  beforeEach(() => {
    stylesheet = lumine.themes.requireStylesheet(path.join(__dirname, "..", "styles", "main.css"));
    container = document.createElement("div");
    container.style.cssText = "display:flex;width:1000px;height:500px";
    jasmine.attachToDOM(container);
  });

  afterEach(async () => {
    await view?.destroy();
    view = null;
    for (const model of patches.splice(0)) model.dispose();
    container.remove();
    stylesheet.dispose();
  });

  async function mount(source = patch(), initialDiffView = "unified") {
    view = new ChangesView({
      title: "Snapshot",
      multiFilePatch: source,
      readOnly: true,
      initialDiffView,
      workspace: lumine.workspace,
      commands: lumine.commands,
      config: lumine.config,
      keymaps: lumine.keymaps,
      tooltips: lumine.tooltips,
      repository: {
        applyPatchToIndex: jasmine.createSpy("index"),
        stageFiles: jasmine.createSpy("stage"),
        stageFileModeChange: jasmine.createSpy("mode"),
        stageFileSymlinkChange: jasmine.createSpy("symlink"),
        unstageFiles: jasmine.createSpy("unstage"),
      },
      discardLines: jasmine.createSpy("discard"),
      undoLastDiscard: jasmine.createSpy("undo"),
    });
    container.appendChild(view.element);
    await flushViews(() => {});
    return source;
  }

  function controller() {
    return view.refPatchController.get();
  }

  for (const layout of ["unified", "side-by-side"]) {
    it(`owns the complete ${layout} pane layout without a consumer's styles`, async () => {
      await mount(patch(), layout);
      const root = view.element.getBoundingClientRect();
      const bounds = container.getBoundingClientRect();
      expect(root.width).toBeCloseTo(bounds.width, 0);
      expect(root.height).toBeCloseTo(bounds.height, 0);
      const header = view.element.querySelector(".git-panel-ChangesView-header");
      const patchArea = view.element.querySelector(".git-panel-FilePatchView-container");
      expect(patchArea.getBoundingClientRect().top).toBeCloseTo(
        header.getBoundingClientRect().bottom,
        0,
      );
      expect(patchArea.getBoundingClientRect().bottom).toBeCloseTo(bounds.bottom, 0);
      const nodes = Array.from(view.element.querySelectorAll("lumine-text-editor"));
      const minimumWidth = layout === "unified" ? 800 : 350;
      for (const node of nodes) {
        expect(node.getComponent().getScrollContainerClientWidth()).toBeGreaterThan(minimumWidth);
        expect(node.getBoundingClientRect().bottom).toBeLessThanOrEqual(bounds.bottom + 1);
      }
      container.style.width = "800px";
      await flushViews(() => {});
      expect(view.element.getBoundingClientRect().width).toBeCloseTo(800, 0);
    });
  }

  it("clones the caller's patch and releases its own data after the source is disposed", async () => {
    const source = await mount();
    const sourceBuffer = source.getBuffer();
    const owned = controller().props.multiFilePatch;
    const ownBuffer = owned.getBuffer();
    expect(owned).not.toBe(source);
    expect(ownBuffer).not.toBe(sourceBuffer);
    await flushViews(() =>
      view.element.querySelector(".git-panel-FilePatchView-collapseButton").click(),
    );
    expect(owned.getFilePatches()[0].getRenderStatus().isVisible()).toBe(false);
    expect(source.getFilePatches()[0].getRenderStatus().isVisible()).toBe(true);
    source.dispose();
    expect(sourceBuffer.isDestroyed()).toBe(true);
    expect(ownBuffer.isDestroyed()).toBe(false);
    await view.destroy();
    expect(owned.isDisposed()).toBe(true);
    expect(ownBuffer.isDestroyed()).toBe(true);
  });

  it("opens Side by Side without activating the first hunk and keeps mutation controls disabled", async () => {
    await mount(patch(), "side-by-side");
    expect(view.getDiffView()).toBe("side-by-side");
    expect(view.element.querySelectorAll("lumine-text-editor").length).toBe(2);
    expect(Array.from(controller().state.selectedRows)).toEqual([]);
    expect(controller().refView.get().getCanonicalSelectionRanges()).toEqual([]);
    expect(view.element.querySelector(".git-panel-HunkHeaderView--isSelected")).toBeNull();
    for (const node of view.element.querySelectorAll("lumine-text-editor")) {
      expect(
        node
          .getModel()
          .getSelectedBufferRanges()
          .every((range) => range.isEmpty()),
      ).toBe(true);
      expect(node.getScrollTop()).toBe(0);
    }
    expect(view.element.querySelector(".git-panel-HunkHeaderView-stageButton")).toBeNull();
    expect(view.element.querySelector(".git-panel-FilePatchView-metaButton")).toBeNull();
    expect(view.element.querySelector('button[title="Unstage File"]')).toBeNull();
    const file = controller().props.multiFilePatch.getFilePatches()[0];
    await controller().toggleRows(new Set([1]), "line");
    await controller().toggleFile(file);
    await controller().toggleModeChange(file);
    await controller().toggleSymlinkChange(file);
    await controller().discardRows(new Set([1]), "line");
    await controller().undoLastDiscard(file);
    for (const callback of Object.values(view.props.repository))
      expect(callback).not.toHaveBeenCalled();
    expect(view.props.discardLines).not.toHaveBeenCalled();
    expect(view.props.undoLastDiscard).not.toHaveBeenCalled();
  });

  it("keeps a fresh Side by Side view unselected after a snapshot refresh", async () => {
    await mount(patch(), "side-by-side");
    await flushViews(() => view.update({ ...view.props, multiFilePatch: patch("refreshed") }));
    expect(Array.from(controller().state.selectedRows)).toEqual([]);
    expect(controller().refView.get().getCanonicalSelectionRanges()).toEqual([]);
    expect(view.element.querySelector(".git-panel-HunkHeaderView--isSelected")).toBeNull();
    await flushViews(() => controller().refView.get().selectNextHunk());
    expect(Array.from(controller().state.selectedRows)).toEqual([1, 2]);
  });

  it("adopts refreshed snapshots inside the view while preserving layout and source ownership", async () => {
    const source = await mount();
    await flushViews(() => view.setDiffView("side-by-side"));
    const native = Array.from(view.element.querySelectorAll("lumine-text-editor"), (node) =>
      node.getModel(),
    );
    const owned = controller().props.multiFilePatch;
    const next = patch("latest");
    await flushViews(() => view.update({ ...view.props, multiFilePatch: next }));
    expect(owned.isDisposed()).toBe(true);
    expect(source.getBuffer().getText()).toContain("new");
    expect(source.getBuffer().getText()).not.toContain("latest");
    expect(view.getDiffView()).toBe("side-by-side");
    expect(
      Array.from(view.element.querySelectorAll("lumine-text-editor"), (node) => node.getModel()),
    ).toEqual(native);
    expect(native[1].getText()).toContain("latest");
    next.dispose();
    expect(controller().props.multiFilePatch.getBuffer().isDestroyed()).toBe(false);
  });

  it("notifies layout changes and preserves a disjoint selected source line", async () => {
    await mount();
    const callback = jasmine.createSpy("layout changed");
    await flushViews(() =>
      view.update({ ...view.props, multiFilePatch: view.sourcePatch, onDiffViewChange: callback }),
    );
    controller()
      .refView.get()
      .setCanonicalSelectionRanges([new Range([2, 0], [2, Infinity])], { autoscroll: false });
    await flushViews(() => view.setDiffView("side-by-side"));
    expect(callback).toHaveBeenCalledWith("side-by-side");
    expect(Array.from(controller().state.selectedRows)).toEqual([2]);
  });
});
