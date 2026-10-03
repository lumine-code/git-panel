/** @babel */
import path from "path";
import { Disposable, Emitter } from "lumine";
import MultiFilePatchView from "../lib/views/multi-file-patch-view";
import CommitDetailItem from "../lib/items/commit-detail-item";
import { buildMultiFilePatch } from "../lib/models/patch";
import { COLLAPSED } from "../lib/models/patch/patch";
import { flushViews } from "./helpers/etch";

function diff(name, count = 4, mode = "100644") {
  return {
    oldPath: name,
    newPath: name,
    oldMode: "100644",
    newMode: mode,
    status: "modified",
    hunks: [
      {
        oldStartLine: 1,
        oldLineCount: count + 1,
        newStartLine: 1,
        newLineCount: count + 1,
        heading: "",
        lines: [
          "-before",
          "+after",
          ...Array.from({ length: count }, (_, row) => ` context ${row}`),
        ],
      },
    ],
  };
}

describe("shared side-by-side diff headers", () => {
  let view;
  let patch;
  let container;
  let stylesheet;
  let publication;

  beforeEach(() => {
    publication = new Emitter();
    stylesheet = lumine.themes.requireStylesheet(path.join(__dirname, "..", "styles", "main.css"));
    container = document.createElement("div");
    container.style.cssText = "display: flex; width: 700px; height: 400px;";
    jasmine.attachToDOM(container);
  });

  afterEach(async () => {
    await view?.destroy();
    patch?.dispose();
    publication.dispose();
    container.remove();
    stylesheet.dispose();
  });

  async function paint() {
    await flushViews(async () => {});
    const elements = Array.from(view.element.querySelectorAll("lumine-text-editor"));
    const pending = elements.map((element) => element.getNextUpdatePromise());
    for (const element of elements) element.getComponent().scheduleUpdate();
    await Promise.all(pending);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await globalThis.flushMicrotasks();
  }

  async function mount(diffs, options = {}) {
    patch = buildMultiFilePatch(diffs, { largeDiffThreshold: Infinity, ...options });
    view = new MultiFilePatchView({
      multiFilePatch: patch,
      itemType: CommitDetailItem,
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
      onWillUpdatePatch: (callback) => publication.on("will-update", callback),
      onDidUpdatePatch: (callback) => publication.on("did-update", callback),
    });
    container.appendChild(view.element);
    await flushViews(() => view.didChangeDiffView("side-by-side"));
    await paint();
    await paint();
    return view.refSideBySide.get();
  }

  function expectAligned(pair) {
    const oldElement = pair.editors.old.get().getElement();
    const newElement = pair.editors.new.get().getElement();
    for (let row = 0; row < pair.projection.rows.length; row++) {
      expect(oldElement.pixelPositionForBufferPosition([row, 0]).top).toBeCloseTo(
        newElement.pixelPositionForBufferPosition([row, 0]).top,
        0,
      );
    }
    for (const record of pair.sharedHeaders) {
      expect(record.height).toBeGreaterThan(0);
      for (const side of ["old", "new"]) {
        expect(parseFloat(record.spacers[side].style.height)).toBeCloseTo(record.height, 2);
        if (record.spacers[side].isConnected)
          expect(record.spacers[side].getBoundingClientRect().height).toBeCloseTo(record.height, 0);
      }
      if (record.element.style.visibility === "visible") {
        expect(record.element.getBoundingClientRect().top).toBeCloseTo(
          record.spacers.old.getBoundingClientRect().top,
          0,
        );
      }
    }
  }

  it("renders one full-width file and hunk header with no controls inside either editor", async () => {
    const pair = await mount([diff("first.txt"), diff("second.txt")]);
    const fileHeaders = view.element.querySelectorAll(".git-panel-FilePatchView-header");
    const hunkHeaders = view.element.querySelectorAll(".git-panel-HunkHeaderView");
    expect(fileHeaders.length).toBe(2);
    expect(hunkHeaders.length).toBe(2);
    expect(view.element.querySelectorAll(".git-panel-FilePatchView-collapseButton").length).toBe(2);
    for (const side of ["old", "new"]) {
      const element = pair.editors[side].get().getElement();
      expect(element.querySelector(".git-panel-FilePatchView-header")).toBeNull();
      expect(element.querySelector(".git-panel-HunkHeaderView")).toBeNull();
    }
    const area = pair.refs.editorArea.getBoundingClientRect();
    for (const header of fileHeaders) {
      expect(header.getBoundingClientRect().width).toBeGreaterThan(area.width * 0.85);
    }
    expectAligned(pair);
    const selectHunk = new MouseEvent("mousedown", {
      button: 0,
      bubbles: true,
      cancelable: true,
    });
    hunkHeaders[0].querySelector(".git-panel-HunkHeaderView-title").dispatchEvent(selectHunk);
    expect(selectHunk.defaultPrevented).toBe(true);
    expect(pair.editors[pair.activeSide].get().getElement().contains(document.activeElement)).toBe(
      true,
    );
    container.style.width = "480px";
    await paint();
    await paint();
    expectAligned(pair);
    expect(fileHeaders[0].getBoundingClientRect().width).toBeLessThan(480);
  });

  it("keeps shared headers aligned and clipped while scrolling long virtualized patches", async () => {
    const pair = await mount([diff("first.txt", 100), diff("second.txt", 100)]);
    const element = pair.editors.new.get().getElement();
    element.setScrollTop(500);
    await paint();
    expect(pair.sharedHeaders[0].element.style.visibility).toBe("hidden");
    expectAligned(pair);
    const secondFile = pair.sharedHeaders.find(
      (record) => record.model === patch.getFilePatches()[1],
    );
    element.setScrollTop(element.pixelPositionForBufferPosition([secondFile.row, 0]).top - 100);
    await paint();
    expect(secondFile.element.style.visibility).toBe("visible");
    expectAligned(pair);
    element.setScrollTop(0);
    await paint();
    expect(pair.sharedHeaders[0].element.style.visibility).toBe("visible");
    expectAligned(pair);
  });

  it("collapses and reloads a file through its only full-width control", async () => {
    const pair = await mount([diff("first.txt"), diff("second.txt")]);
    const first = patch.getFilePatches()[0];
    const collapse = view.element.querySelector(".git-panel-FilePatchView-collapseButton");
    await flushViews(() => collapse.click());
    await paint();
    await paint();
    expect(first.getRenderStatus().isVisible()).toBe(false);
    expect(view.element.querySelectorAll(".git-panel-FilePatchView-showDiffButton").length).toBe(1);
    expect(view.element.querySelectorAll(".git-panel-HunkHeaderView").length).toBe(1);
    expectAligned(pair);
    const load = view.element.querySelector(".git-panel-FilePatchView-showDiffButton");
    await flushViews(() => load.click());
    await paint();
    await paint();
    expect(first.getRenderStatus().isVisible()).toBe(true);
    expect(view.element.querySelectorAll(".git-panel-HunkHeaderView").length).toBe(2);
    expectAligned(pair);
  });

  it("leaves synthetic header anchors neutral while retaining real missing-line padding", async () => {
    const modeOnly = diff("mode-only.sh", 0, "100755");
    modeOnly.hunks = [];
    const uneven = diff("uneven.txt");
    uneven.hunks[0].lines = ["-old one", "-old two", "+new", " same"];
    uneven.hunks[0].oldLineCount = 3;
    uneven.hunks[0].newLineCount = 2;
    const pair = await mount([diff("collapsed.txt"), modeOnly, uneven], {
      renderStatusOverrides: { "collapsed.txt": COLLAPSED },
    });
    const neutralRows = pair.projection.rows.flatMap((entry, row) =>
      entry.oldRow === null && entry.newRow === null ? [row] : [],
    );
    expect(neutralRows.length).toBe(2);
    const paddingFor = (side, row) =>
      pair.editors[side]
        .get()
        .getDecorations()
        .filter(
          (decoration) =>
            decoration
              .getProperties()
              .class?.includes("git-panel-SideBySidePatchView-placeholder") &&
            decoration.getMarker().getBufferRange().intersectsRow(row),
        );
    for (const side of ["old", "new"]) {
      for (const row of neutralRows) expect(paddingFor(side, row).length).toBe(0);
    }
    const missingNewRow = pair.projection.rows.findIndex(
      (entry) => entry.oldRow !== null && entry.newRow === null,
    );
    expect(missingNewRow).toBeGreaterThan(-1);
    expect(paddingFor("new", missingNewRow).length).toBeGreaterThan(0);
    expect(paddingFor("old", missingNewRow).length).toBe(0);
    container.style.width = "480px";
    await paint();
    await paint();
    expectAligned(pair);
    const load = view.element.querySelector(".git-panel-FilePatchView-showDiffButton");
    await flushViews(() => load.click());
    await paint();
    await paint();
    expect(patch.getFilePatches()[0].getRenderStatus().isVisible()).toBe(true);
    expectAligned(pair);
  });

  it("shares file metadata and forwards wheel gestures over the header to both columns", async () => {
    const pair = await mount([diff("executable.sh", 100, "100755")]);
    expect(view.element.querySelectorAll(".git-panel-FilePatchView-meta").length).toBe(1);
    expectAligned(pair);
    for (const side of ["old", "new"]) pair.editors[side].get().update({ smoothScrolling: false });
    const event = new WheelEvent("wheel", { deltaY: 150, bubbles: true, cancelable: true });
    view.element.querySelector(".git-panel-FilePatchView-header").dispatchEvent(event);
    await paint();
    expect(event.defaultPrevented).toBe(true);
    expect(pair.editors.new.get().getElement().getScrollTop()).toBeGreaterThan(0);
    expect(pair.editors.new.get().getElement().getScrollTop()).toBe(
      pair.editors.old.get().getElement().getScrollTop(),
    );
    expectAligned(pair);
  });

  it("moves a visible shared header in the same smooth-scroll frame as both native columns", async () => {
    const raw = diff("example.txt", 100);
    raw.hunks[0].lines[0] = `-${"x".repeat(1000)}`;
    const pair = await mount([raw]);
    for (const side of ["old", "new"]) pair.editors[side].get().setSoftWrapped(false);
    const oldComponent = pair.editors.old.get().getElement().getComponent();
    const newComponent = pair.editors.new.get().getElement().getComponent();
    for (const side of ["old", "new"]) {
      const editor = pair.editors[side].get();
      editor.update({ smoothScrolling: true, wheelSmoothness: 8, scrollSensitivity: 100 });
    }
    await paint();
    for (const component of [oldComponent, newComponent]) {
      component.element.setUpdatedSynchronously(false);
      component.scrollAnimator.raf = () => 0;
      component.scrollAnimator.caf = () => {};
    }
    const record = pair.sharedHeaders[0];
    for (const [side, deltaY] of [
      ["old", 35],
      ["new", -20],
      ["old", 30],
      ["new", -35],
    ]) {
      const element = pair.editors[side].get().getElement();
      element
        .getComponent()
        .refs.scrollContainer.dispatchEvent(
          new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }),
        );
      for (let frame = 0; frame < 3; frame++) {
        oldComponent.scrollAnimator.advance(1000 / 60);
        expect(record.element.style.visibility).toBe("visible");
        expect(record.element.getBoundingClientRect().top).toBeCloseTo(
          record.spacers.old.getBoundingClientRect().top,
          0,
        );
        expect(record.element.getBoundingClientRect().top).toBeCloseTo(
          record.spacers.new.getBoundingClientRect().top,
          0,
        );
      }
    }
  });
});
