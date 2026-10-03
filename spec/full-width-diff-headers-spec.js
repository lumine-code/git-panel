/** @babel */
import path from "path";
import { Disposable } from "lumine";
import MultiFilePatchView from "../lib/views/multi-file-patch-view";
import CommitDetailItem from "../lib/items/commit-detail-item";
import ChangedFileItem from "../lib/items/changed-file-item";
import { buildMultiFilePatch } from "../lib/models/patch";
import { flushViews } from "./helpers/etch";

function file(name, count = 90, mode = "100644") {
  const hunk = (start, amount) => ({
    oldStartLine: start,
    newStartLine: start,
    oldLineCount: amount + 2,
    newLineCount: amount + 2,
    heading: `section ${start}`,
    lines: [
      " before",
      "-removed",
      "+inserted",
      ...Array.from({ length: amount }, (_, i) => ` context ${i} ${"wide words ".repeat(30)}`),
    ],
  });
  return {
    oldPath: name,
    newPath: name,
    oldMode: "100644",
    newMode: mode,
    status: "modified",
    hunks: [hunk(1, count), hunk(500, 20)],
  };
}

describe("full-width diff controls", () => {
  let view;
  let patch;
  let container;
  let stylesheet;

  beforeEach(() => {
    stylesheet = lumine.themes.requireStylesheet(path.join(__dirname, "..", "styles", "main.css"));
    container = document.createElement("div");
    container.style.cssText = "display: flex; width: 920px; height: 360px;";
    jasmine.attachToDOM(container);
  });

  afterEach(async () => {
    await view?.destroy();
    patch?.dispose();
    container.remove();
    stylesheet.dispose();
  });

  async function paint() {
    for (let pass = 0; pass < 4; pass++) {
      await flushViews(async () => {});
      const elements = Array.from(view.element.querySelectorAll("lumine-text-editor"));
      const promises = elements.map((element) => element.getNextUpdatePromise());
      for (const element of elements) element.getComponent().scheduleUpdate();
      await Promise.all(promises);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await globalThis.flushMicrotasks();
    }
  }

  async function mount(
    mode,
    {
      readOnly = false,
      itemType = CommitDetailItem,
      diffs = [file("first.txt"), file("second.txt", 50)],
      options = {},
    } = {},
  ) {
    patch = buildMultiFilePatch(diffs, { largeDiffThreshold: Infinity, ...options });
    view = new MultiFilePatchView({
      multiFilePatch: patch,
      itemType,
      readOnly,
      stagingStatus: "unstaged",
      initialDiffView: mode,
      workspace: lumine.workspace,
      config: lumine.config,
      commands: lumine.commands,
      keymaps: lumine.keymaps,
      tooltips: { add: () => new Disposable(), addComposite: () => new Disposable() },
      selectedRows: new Set(),
      selectionMode: "hunk",
      selectedRowsChanged: () => {},
      toggleRows: jasmine.createSpy("stage hunk").and.resolveTo(),
      toggleFile: jasmine.createSpy("stage file").and.resolveTo(),
      discardRows: jasmine.createSpy("discard hunk").and.resolveTo(),
      openFile: () => {},
      diveIntoMirrorPatch: () => {},
      undoLastDiscard: () => {},
      surface: () => {},
    });
    container.appendChild(view.element);
    await paint();
  }

  function editors() {
    return Array.from(view.element.querySelectorAll("lumine-text-editor"));
  }

  function records() {
    return view.state.diffView === "unified"
      ? Array.from(view.fullWidthHeaders.records, (record) => ({
          ...record,
          element: record.content,
          nativeSpacer: record.spacer,
        }))
      : view.refSideBySide
          .get()
          .sharedHeaders.map((record) => ({ ...record, nativeSpacer: record.spacers.old }));
  }

  function assertEdges() {
    const elements = editors();
    const left = elements[0].getBoundingClientRect().left;
    const right =
      elements.at(-1).getBoundingClientRect().right - elements.at(-1).getVerticalScrollbarWidth();
    for (const header of view.element.querySelectorAll(
      ".git-panel-FilePatchView-header, .git-panel-HunkHeaderView",
    )) {
      const style = getComputedStyle(header);
      const rect = header.getBoundingClientRect();
      expect(style.marginLeft).toBe(style.marginRight);
      expect(parseFloat(style.marginLeft)).toBeGreaterThan(0);
      expect(rect.left - parseFloat(style.marginLeft)).toBeCloseTo(left, 0);
      expect(rect.right + parseFloat(style.marginRight)).toBeCloseTo(right, 0);
    }
    for (const record of records()) {
      expect(record.height).toBeGreaterThan(0);
      if (record.nativeSpacer?.isConnected)
        expect(record.nativeSpacer.getBoundingClientRect().height).toBeCloseTo(record.height, 0);
      if (record.element.style.visibility === "visible")
        expect(record.element.getBoundingClientRect().top).toBeCloseTo(
          record.nativeSpacer.getBoundingClientRect().top,
          0,
        );
    }
  }

  for (const mode of ["unified", "side-by-side"]) {
    it(`renders each ${mode} file and hunk control once over the gutters and keeps reserved heights`, async () => {
      await mount(mode);
      expect(view.element.querySelectorAll(".git-panel-FilePatchView-header").length).toBe(2);
      expect(view.element.querySelectorAll(".git-panel-HunkHeaderView").length).toBe(4);
      for (const element of editors()) {
        expect(element.querySelector(".git-panel-FilePatchView-header")).toBeNull();
        expect(element.querySelector(".git-panel-HunkHeaderView")).toBeNull();
      }
      assertEdges();
      const secondHunk = patch.getFilePatches()[0].getHunks()[1];
      const control = view.element.querySelectorAll(".git-panel-HunkHeaderView")[1];
      const event = new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true });
      control.querySelector(".git-panel-HunkHeaderView-title").dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(
        view
          .getCanonicalSelectionRanges()
          .some((range) => range.intersectsWith(secondHunk.getRange())),
      ).toBe(true);
    });

    it(`keeps ${mode} controls fixed horizontally and follows virtualized files on scroll and resize`, async () => {
      await mount(mode);
      for (const element of editors()) element.getModel().setSoftWrapped(false);
      await paint();
      const first = records()[0];
      const beforeLeft = first.element.getBoundingClientRect().left;
      editors().at(-1).setScrollLeft(180);
      await paint();
      expect(first.element.getBoundingClientRect().left).toBeCloseTo(beforeLeft, 0);
      assertEdges();
      const secondFile = records().find((record) =>
        record.element
          .querySelector(".git-panel-FilePatchView-title")
          ?.textContent.includes("second.txt"),
      );
      editors().at(-1).setScrollTop(1600);
      await paint();
      expect(first.element.style.visibility).toBe("hidden");
      const nativePosition = secondFile.nativeSpacer.getBoundingClientRect().top;
      expect(Number.isFinite(nativePosition)).toBe(true);
      container.style.width = "640px";
      await paint();
      assertEdges();
      editors().at(-1).setScrollTop(0);
      await paint();
      expect(first.element.style.visibility).toBe("visible");
    });

    it(`keeps ${mode} collapsed gates and executable metadata full-width through loading`, async () => {
      const metadata = file("mode.txt", 0, "100755");
      metadata.hunks = [];
      await mount(mode, {
        diffs: [file("large.txt", 20), metadata],
        options: { largeDiffThreshold: 10 },
      });
      expect(view.element.querySelectorAll(".git-panel-FilePatchView-showDiffButton").length).toBe(
        1,
      );
      assertEdges();
      const load = view.element.querySelector(".git-panel-FilePatchView-showDiffButton");
      await flushViews(() => load.click());
      await paint();
      expect(view.element.querySelector(".git-panel-FilePatchView-showDiffButton")).toBeNull();
      expect(view.element.querySelector(".git-panel-FilePatchView-meta").textContent).toContain(
        "File changed mode",
      );
      assertEdges();
      const collapse = view.element.querySelector(".git-panel-FilePatchView-collapseButton");
      await flushViews(() => collapse.click());
      await paint();
      expect(view.element.querySelector(".git-panel-FilePatchView-showDiffButton")).not.toBeNull();
      assertEdges();
    });
  }

  it("releases all portal controls and observers when the viewer or layout closes", async () => {
    await mount("unified", { readOnly: true });
    const overlay = view.fullWidthHeaders;
    const previous = Array.from(overlay.records);
    await flushViews(() => view.didChangeDiffView("side-by-side"));
    await paint();
    expect(overlay.records.size).toBe(0);
    for (const record of previous) expect(record.content.isConnected).toBe(false);
    await flushViews(() => view.didChangeDiffView("unified"));
    await paint();
    const current = Array.from(overlay.records);
    await view.destroy();
    expect(overlay.disposed).toBe(true);
    expect(overlay.records.size).toBe(0);
    for (const record of current) expect(record.content.isConnected).toBe(false);
  });

  function appearance(selector) {
    const properties = [
      "fontFamily",
      "fontSize",
      "fontWeight",
      "lineHeight",
      "color",
      "backgroundColor",
      "borderTopWidth",
      "borderTopColor",
      "borderRadius",
      "boxSizing",
      "marginTop",
      "marginRight",
      "marginBottom",
      "marginLeft",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "display",
      "alignItems",
      "flexWrap",
      "flexShrink",
      "minHeight",
      "whiteSpace",
      "overflow",
      "textOverflow",
    ];
    return Array.from(view.element.querySelectorAll(selector), (element) => {
      const style = getComputedStyle(element);
      return {
        ...Object.fromEntries(properties.map((property) => [property, style[property]])),
        height: element.getBoundingClientRect().height,
      };
    });
  }

  for (const [name, options] of [
    ["read-only", { readOnly: true }],
    ["editable", { itemType: ChangedFileItem }],
  ]) {
    it(`uses identical ${name} header typography, dimensions, insets and controls in both layouts`, async () => {
      await mount("unified", {
        ...options,
        diffs: [file(`long-directory/${"long-name-".repeat(18)}.txt`, 30)],
      });
      const selectors = [
        ".git-panel-FilePatchView-header",
        ".git-panel-FilePatchView-title",
        ".git-panel-FilePatchView-header .btn-group",
        ".git-panel-FilePatchView-header .btn",
        ".git-panel-HunkHeaderView",
        ".git-panel-HunkHeaderView-title",
        ".git-panel-HunkHeaderView-stageButton",
        ".git-panel-HunkHeaderView-discardButton",
      ];
      for (const width of [920, 460]) {
        container.style.width = `${width}px`;
        await paint();
        const unified = selectors.map(appearance);
        await flushViews(() => view.didChangeDiffView("side-by-side"));
        await paint();
        assertEdges();
        expect(selectors.map(appearance)).toEqual(unified);
        if (name === "editable") {
          const stage = view.element.querySelector(".git-panel-HunkHeaderView-stageButton");
          await flushViews(() => stage.click());
          expect(view.props.toggleRows).toHaveBeenCalledTimes(width === 920 ? 1 : 2);
        }
        await flushViews(() => view.didChangeDiffView("unified"));
        await paint();
        assertEdges();
      }
    });
  }

  it("uses the same metadata and collapsed-gate typography even when native editor fonts differ", async () => {
    const metadata = file("mode.txt", 0, "100755");
    metadata.hunks = [];
    await mount("unified", {
      diffs: [file("large.txt", 30), metadata],
      options: { largeDiffThreshold: 10 },
    });
    const selectors = [
      ".git-panel-FilePatchView-header",
      ".git-panel-FilePatchView-message",
      ".git-panel-FilePatchView-showDiffButton",
      ".git-panel-FilePatchView-meta",
      ".git-panel-FilePatchView-metaContainer",
      ".git-panel-FilePatchView-metaHeader",
    ];
    editors()[0].style.fontFamily = "serif";
    editors()[0].style.fontSize = "28px";
    editors()[0].style.lineHeight = "2";
    await paint();
    const unified = selectors.map(appearance);
    await flushViews(() => view.didChangeDiffView("side-by-side"));
    await paint();
    expect(selectors.map(appearance)).toEqual(unified);
    assertEdges();
  });
});
