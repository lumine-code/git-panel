/** @babel */
import path from "path";
import { Disposable, Emitter } from "lumine";
import MultiFilePatchView from "../lib/views/multi-file-patch-view";
import CommitDetailItem from "../lib/items/commit-detail-item";
import { buildMultiFilePatch } from "../lib/models/patch";
import { flushViews } from "./helpers/etch";

function diff(name, count = 1) {
  return {
    oldPath: name,
    newPath: name,
    oldMode: "100644",
    newMode: "100644",
    status: "modified",
    hunks: [
      {
        oldStartLine: 1,
        oldLineCount: count + 1,
        newStartLine: 1,
        newLineCount: count + 1,
        heading: name,
        lines: [
          `-${name} before`,
          `+${name} after`,
          ...Array.from({ length: count }, (_, row) => ` ${name} context ${row}`),
        ],
      },
    ],
  };
}

describe("loading initially collapsed side-by-side files", () => {
  let view;
  let container;
  let stylesheet;
  let publication;
  const patches = [];

  beforeEach(() => {
    publication = new Emitter();
    stylesheet = lumine.themes.requireStylesheet(path.join(__dirname, "..", "styles", "main.css"));
    container = document.createElement("div");
    container.style.cssText = "display: flex; width: 700px; height: 400px;";
    jasmine.attachToDOM(container);
  });

  afterEach(async () => {
    await view?.destroy();
    view = null;
    while (patches.length) patches.pop().dispose();
    publication.dispose();
    container.remove();
    stylesheet.dispose();
  });

  function build(diffs, options = {}) {
    const patch = buildMultiFilePatch(diffs, { largeDiffThreshold: 6, ...options });
    patches.push(patch);
    return patch;
  }

  async function paint() {
    await flushViews(async () => {});
    const elements = Array.from(view.element.querySelectorAll("lumine-text-editor"));
    const pending = elements.map((element) => element.getNextUpdatePromise());
    for (const element of elements) element.getComponent().scheduleUpdate();
    await Promise.all(pending);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await globalThis.flushMicrotasks();
  }

  async function mount() {
    const patch = build([diff("large.txt", 10), diff("small.txt")]);
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
    return patch;
  }

  function pair() {
    return view.refSideBySide.get();
  }

  function fileHeader(file) {
    return pair().sharedHeaderRecords.get(file).element;
  }

  async function click(element) {
    await flushViews(() => element.click());
    await paint();
    await paint();
  }

  function expectHeaderOwnership() {
    const records = pair().sharedHeaders;
    expect(new Set(records.map((record) => record.key)).size).toBe(records.length);
    expect(new Set(records.map((record) => record.element)).size).toBe(records.length);
    for (const record of records) {
      expect(record.element.isConnected).toBe(true);
      for (const side of ["old", "new"]) {
        expect(record.spacers[side]).toBeDefined();
        const decoration = record.decorations[side].decorationHolder.get();
        expect(decoration.isDestroyed()).toBe(false);
        expect(decoration.getMarker().getStartBufferPosition().row).toBe(record.row);
        expect(decoration.getProperties().item.getElement().contains(record.spacers[side])).toBe(
          true,
        );
      }
    }
  }

  it("loads the first large file when a later file already has a hunk header", async () => {
    const patch = await mount();
    const [large, small] = patch.getFilePatches();
    expect(large.getRenderStatus().isVisible()).toBe(false);
    expect(small.getRenderStatus().isVisible()).toBe(true);
    expect(pair().sharedHeaders.filter((record) => record.kind === "hunk").length).toBe(1);
    expect(pair().editors.new.get().getText()).not.toContain("large.txt after");

    await click(fileHeader(large).querySelector(".git-panel-FilePatchView-showDiffButton"));

    expect(large.getRenderStatus().isVisible()).toBe(true);
    expect(fileHeader(large).querySelector(".git-panel-FilePatchView-message")).toBeNull();
    expect(fileHeader(large).querySelector(".icon-chevron-down")).not.toBeNull();
    expect(view.element.querySelectorAll(".git-panel-HunkHeaderView").length).toBe(2);
    expect(pair().editors.old.get().getText()).toContain("large.txt before");
    expect(pair().editors.new.get().getText()).toContain("large.txt after");
    expect(pair().editors.new.get().getText()).toContain("small.txt after");
    expectHeaderOwnership();
  });

  it("preserves each header's controls and spacers through repeated load and collapse", async () => {
    const patch = await mount();
    const [large, small] = patch.getFilePatches();
    const smallHunk = small.getHunks()[0];
    const smallRecord = pair().sharedHeaderRecords.get(smallHunk);
    const smallElement = smallRecord.element;
    for (let iteration = 0; iteration < 2; iteration++) {
      await click(fileHeader(large).querySelector(".git-panel-FilePatchView-showDiffButton"));
      expect(fileHeader(large).querySelector(".git-panel-FilePatchView-message")).toBeNull();
      expect(pair().sharedHeaderRecords.get(smallHunk)).toBe(smallRecord);
      expect(smallRecord.element).toBe(smallElement);
      expectHeaderOwnership();
      await click(fileHeader(large).querySelector(".git-panel-FilePatchView-collapseButton"));
      expect(large.getRenderStatus().isVisible()).toBe(false);
      expect(
        fileHeader(large).querySelector(".git-panel-FilePatchView-showDiffButton"),
      ).not.toBeNull();
      expect(pair().sharedHeaderRecords.get(smallHunk)).toBe(smallRecord);
      expect(smallRecord.element).toBe(smallElement);
      expectHeaderOwnership();
    }
    await click(fileHeader(small).querySelector(".git-panel-FilePatchView-collapseButton"));
    expect(small.getRenderStatus().isVisible()).toBe(false);
    expect(large.getRenderStatus().isVisible()).toBe(false);
    await click(fileHeader(large).querySelector(".git-panel-FilePatchView-showDiffButton"));
    expect(large.getRenderStatus().isVisible()).toBe(true);
    expect(small.getRenderStatus().isVisible()).toBe(false);
    expectHeaderOwnership();
  });

  it("replaces retired header generations when a refresh changes file identities and indices", async () => {
    const previous = await mount();
    const oldRecords = pair().sharedHeaders.slice();
    const oldKeys = new Set(oldRecords.map((record) => record.key));
    const next = build([diff("inserted.txt"), diff("large.txt", 10), diff("small.txt")]);
    publication.emit("will-update");
    next.adoptBuffer(previous.getPatchBuffer());
    publication.emit("did-update", next);
    await flushViews(() => view.update({ ...view.props, multiFilePatch: next }));
    previous.dispose();
    await paint();
    await paint();
    expectHeaderOwnership();
    for (const record of oldRecords) {
      expect(record.element?.isConnected || false).toBe(false);
      for (const side of ["old", "new"]) {
        expect(record.decorations[side]?.decorationHolder.getOr(null) || null).toBeNull();
      }
    }
    for (const record of pair().sharedHeaders) expect(oldKeys.has(record.key)).toBe(false);
    const [inserted, large, small] = next.getFilePatches();
    await click(fileHeader(large).querySelector(".git-panel-FilePatchView-showDiffButton"));
    expect(large.getRenderStatus().isVisible()).toBe(true);
    expect(fileHeader(large).querySelector(".git-panel-FilePatchView-message")).toBeNull();
    expect(view.element.querySelectorAll(".git-panel-HunkHeaderView").length).toBe(3);
    await click(fileHeader(inserted).querySelector(".git-panel-FilePatchView-collapseButton"));
    expect(inserted.getRenderStatus().isVisible()).toBe(false);
    expect(large.getRenderStatus().isVisible()).toBe(true);
    expect(small.getRenderStatus().isVisible()).toBe(true);
    expectHeaderOwnership();
  });
});
