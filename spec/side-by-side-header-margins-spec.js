/** @babel */
import path from "path";
import { Disposable, Emitter } from "lumine";
import MultiFilePatchView from "../lib/views/multi-file-patch-view";
import CommitDetailItem from "../lib/items/commit-detail-item";
import { buildMultiFilePatch } from "../lib/models/patch";
import { flushViews } from "./helpers/etch";

describe("shared side-by-side header margins", () => {
  let view;
  let patch;
  let container;
  let stylesheet;
  let publication;

  beforeEach(() => {
    publication = new Emitter();
    stylesheet = lumine.themes.requireStylesheet(path.join(__dirname, "..", "styles", "main.css"));
    container = document.createElement("div");
    container.style.cssText = "display: flex; width: 700px; height: 800px;";
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

  async function mount(longLines = false) {
    patch = buildMultiFilePatch(
      [
        {
          oldPath: "example.txt",
          newPath: "example.txt",
          oldMode: "100644",
          newMode: "100644",
          status: "modified",
          hunks: [1, 100, 500].map((start) => ({
            oldStartLine: start,
            oldLineCount: 7,
            newStartLine: start,
            newLineCount: 7,
            heading: "",
            lines: [
              `-${"before ".repeat(longLines ? 100 : 1)}`,
              `+${"after ".repeat(longLines ? 100 : 1)}`,
              ...Array.from({ length: 6 }, (_, row) => ` context ${row}`),
            ],
          })),
        },
      ],
      { largeDiffThreshold: Infinity },
    );
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
    await paint();
    await paint();
  }

  function margins(element) {
    const style = getComputedStyle(element);
    return [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft];
  }

  function expectViewportEdges(pair) {
    const before = pair.editors.old.get().getElement();
    const after = pair.editors.new.get().getElement();
    const viewportLeft = before.getComponent().refs.scrollContainer.getBoundingClientRect().left;
    const viewportRight = after.getBoundingClientRect().right - after.getVerticalScrollbarWidth();
    for (const record of pair.sharedHeaders) {
      const header = record.element.querySelector(
        record.kind === "file" ? ".git-panel-FilePatchView-header" : ".git-panel-HunkHeaderView",
      );
      const headerRect = header.getBoundingClientRect();
      expect(headerRect.left).toBeCloseTo(viewportLeft, 0);
      expect(headerRect.right + parseFloat(getComputedStyle(header).marginRight)).toBeCloseTo(
        viewportRight,
        0,
      );
    }
  }

  it("matches unified spacing for the first adjacent hunk and later separated hunks", async () => {
    await mount();
    const unifiedFile = margins(view.element.querySelector(".git-panel-FilePatchView-header"));
    const unifiedHunks = Array.from(
      view.element.querySelectorAll(".git-panel-HunkHeaderView"),
      margins,
    );
    expect(unifiedHunks.length).toBe(3);
    expect(parseFloat(unifiedHunks[0][0])).toBe(0);
    expect(parseFloat(unifiedHunks[1][0])).toBeGreaterThan(0);
    await flushViews(() => view.didChangeDiffView("side-by-side"));
    await paint();
    await paint();
    const pair = view.refSideBySide.get();
    expect(margins(view.element.querySelector(".git-panel-FilePatchView-header"))).toEqual(
      unifiedFile,
    );
    expect(Array.from(view.element.querySelectorAll(".git-panel-HunkHeaderView"), margins)).toEqual(
      unifiedHunks,
    );
    expectViewportEdges(pair);

    for (const record of pair.sharedHeaders.filter((header) => header.kind === "hunk")) {
      const header = record.element.querySelector(".git-panel-HunkHeaderView");
      const blockRect = record.element.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
      expect(headerRect.top - blockRect.top).toBeCloseTo(
        parseFloat(getComputedStyle(header).marginTop),
        0,
      );
      expect(blockRect.bottom - headerRect.bottom).toBeCloseTo(
        parseFloat(getComputedStyle(header).marginBottom),
        0,
      );
    }
  });

  it("keeps header insets at the native viewport edges after resize and scrolling", async () => {
    await mount(true);
    await flushViews(() => view.didChangeDiffView("side-by-side"));
    await paint();
    await paint();
    const pair = view.refSideBySide.get();
    pair.editors.new.get().setSoftWrapped(false);
    pair.editors.old.get().setSoftWrapped(false);
    await paint();
    await paint();
    expectViewportEdges(pair);
    container.style.width = "480px";
    container.style.height = "300px";
    await paint();
    await paint();
    expectViewportEdges(pair);
    const before = pair.editors.old.get().getElement();
    const after = pair.editors.new.get().getElement();
    const left = pair.sharedHeaders[0].element.getBoundingClientRect().left;
    after.setScrollLeft(100);
    after.setScrollTop(100);
    await paint();
    await paint();
    expect(before.getScrollTop()).toBe(after.getScrollTop());
    expect(after.getScrollLeft()).toBeGreaterThan(0);
    expect(before.getScrollLeft()).toBe(after.getScrollLeft());
    expect(pair.sharedHeaders[0].element.getBoundingClientRect().left).toBeCloseTo(left, 0);
    expectViewportEdges(pair);
  });
});
