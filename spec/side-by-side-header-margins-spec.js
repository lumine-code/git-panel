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

  async function mount(longLines = false, diffs) {
    patch = buildMultiFilePatch(
      diffs || [
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

  function file(name, lines, status = "modified") {
    return {
      oldPath: status === "added" ? null : name,
      newPath: status === "deleted" ? null : name,
      oldMode: status === "added" ? null : "100644",
      newMode: status === "deleted" ? null : "100644",
      status,
      hunks: [
        {
          oldStartLine: status === "added" ? 0 : 1,
          newStartLine: status === "deleted" ? 0 : 1,
          oldLineCount: lines.filter((line) => line[0] !== "+").length,
          newLineCount: lines.filter((line) => line[0] !== "-").length,
          heading: "",
          lines,
        },
      ],
    };
  }

  function expectGuttersAligned() {
    const pair = view.refSideBySide.get();
    for (const side of ["old", "new"]) {
      const element = pair.editors[side].get().getElement();
      const lineHeight = element.getComponent().getLineHeight();
      for (let row = 0; row < pair.projection.rows.length; row++) {
        const line = element
          .getComponent()
          .refs.lineTiles.querySelector(`.line[data-screen-row="${row}"]`);
        const gutter = element.querySelector(
          `.gutter.${side} .line-number[data-screen-row="${row}"]`,
        );
        const entry = pair.projection.rows[row];
        expect(gutter.textContent.trim()).toBe(String(entry[`${side}LineNumber`] ?? ""));
        expect(gutter.getBoundingClientRect().height)
          .withContext(`${side} gutter row ${row} height`)
          .toBeCloseTo(lineHeight, 0);
        expect(gutter.getBoundingClientRect().top)
          .withContext(`${side} gutter row ${row} top`)
          .toBeCloseTo(line.getBoundingClientRect().top, 0);
        if (side === "old") {
          const afterLine = pair.editors.new
            .get()
            .getElement()
            .getComponent()
            .refs.lineTiles.querySelector(`.line[data-screen-row="${row}"]`);
          expect(line.getBoundingClientRect().top)
            .withContext(`aligned display row ${row}`)
            .toBeCloseTo(afterLine.getBoundingClientRect().top, 0);
        }
        const icon = element.querySelector(`.gutter.icons .line-number[data-screen-row="${row}"]`);
        if (icon) {
          expect(icon.getBoundingClientRect().height)
            .withContext(`${side} icon row ${row} height`)
            .toBeCloseTo(lineHeight, 0);
          expect(icon.getBoundingClientRect().top)
            .withContext(`${side} icon row ${row} top`)
            .toBeCloseTo(line.getBoundingClientRect().top, 0);
        }
      }
    }
  }

  for (const [status, count] of [
    ["added", 2],
    ["added", 37],
    ["deleted", 1],
  ]) {
    it(`aligns the first source line and gutter of a ${count}-line ${status} file`, async () => {
      const sign = status === "added" ? "+" : "-";
      await mount(false, [
        file(
          "sofistik.def",
          Array.from({ length: count }, (_, row) => `${sign}line ${row + 1}`),
          status,
        ),
      ]);
      await flushViews(() => view.didChangeDiffView("side-by-side"));
      await paint();
      await paint();
      expectGuttersAligned();
    });
  }

  it("aligns rendered gutter rows with added, deleted, and blank text below shared headers", async () => {
    const icons = lumine.config.get("git-panel.showDiffIconGutter");
    lumine.config.set("git-panel.showDiffIconGutter", true);
    try {
      await mount(false, [
        file("new.def", ["+SOF_VERSION=2026", "+SOFISTIK_A=1,1,-1"], "added"),
        file("old.def", ["-SOF_VERSION=2025"], "deleted"),
        file("main.py", [" before", " ", "-old", "+new", "+extra", " ", " after"]),
      ]);
      await flushViews(() => view.didChangeDiffView("side-by-side"));
      await paint();
      await paint();
      expectGuttersAligned();
    } finally {
      lumine.config.set("git-panel.showDiffIconGutter", icons);
    }
  });

  function expectViewportEdges(pair) {
    const before = pair.editors.old.get().getElement();
    const after = pair.editors.new.get().getElement();
    const viewportLeft = before.getBoundingClientRect().left;
    const viewportRight = after.getBoundingClientRect().right - after.getVerticalScrollbarWidth();
    for (const record of pair.sharedHeaders) {
      const header = record.element.querySelector(
        record.kind === "file" ? ".git-panel-FilePatchView-header" : ".git-panel-HunkHeaderView",
      );
      const headerRect = header.getBoundingClientRect();
      expect(headerRect.left - parseFloat(getComputedStyle(header).marginLeft)).toBeCloseTo(
        viewportLeft,
        0,
      );
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
