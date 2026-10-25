/** @babel */
import path from "path";
import { Disposable } from "lumine";

import Hunk from "../lib/models/patch/hunk.js";
import Patch from "../lib/models/patch/patch.js";
import MultiFilePatchView from "../lib/views/multi-file-patch-view.js";
import { buildMultiFilePatch } from "../lib/models/patch/index.js";
import { flushViews } from "./helpers/etch.js";

function renderPatchRoot(maxLineNumberWidth) {
  const view = Object.create(MultiFilePatchView.prototype);
  view.props = {
    multiFilePatch: {
      anyPresent: () => false,
      getMaxLineNumberWidth: () => maxLineNumberWidth,
    },
    selectionMode: "line",
  };
  view.mounted = false;
  view.state = { diffView: "unified" };
  view.refRoot = { setter() {} };
  view.refFullWidthHeaders = { setter() {} };
  view.renderCommands = () => null;
  view.renderEmptyPatch = () => null;
  view.renderPatchEditor = () => null;

  return view.render();
}

describe("file patch line-number gutters", () => {
  afterEach(() => performance.clearMarks());

  it("sizes gutters for the widest source line number with the native two-digit minimum", () => {
    expect(renderPatchRoot(1).props.style).toBe("--git-panel-line-number-content-width: 2ch;");
    expect(renderPatchRoot(5).props.style).toBe("--git-panel-line-number-content-width: 5ch;");
    expect(renderPatchRoot(6).props.style).toBe("--git-panel-line-number-content-width: 6ch;");
  });

  it("applies the calculated width instead of a fixed minimum", () => {
    const stylesheet = lumine.themes.requireStylesheet(
      path.join(import.meta.dirname, "..", "styles", "main.css"),
    );
    const roots = [];
    const buildLineNumber = (contentWidth, side, text) => {
      const root = document.createElement("div");
      root.classList.add("git-panel-FilePatchView");
      root.style.fontFamily = "monospace";
      root.style.fontSize = "16px";
      root.style.setProperty("--git-panel-line-number-content-width", contentWidth);

      const gutter = document.createElement("div");
      gutter.classList.add("gutter", "line-numbers", side);
      const lineNumber = document.createElement("div");
      lineNumber.classList.add("line-number");
      lineNumber.style.display = "inline-block";
      lineNumber.textContent = text;

      gutter.appendChild(lineNumber);
      root.appendChild(gutter);
      jasmine.attachToDOM(root);
      roots.push(root);
      return { lineNumber, root };
    };

    try {
      for (const side of ["old", "new"]) {
        const narrow = buildLineNumber("2ch", side, "00");
        const wide = buildLineNumber("5ch", side, "00000");
        const style = getComputedStyle(wide.lineNumber);
        const paddingLeft = parseFloat(style.paddingLeft);
        const paddingRight = parseFloat(style.paddingRight);
        const borderWidth = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
        const contentBoxWidth =
          wide.lineNumber.getBoundingClientRect().width - paddingLeft - paddingRight - borderWidth;
        const textRange = document.createRange();
        textRange.selectNodeContents(wide.lineNumber);

        expect(wide.lineNumber.offsetWidth).toBeGreaterThan(narrow.lineNumber.offsetWidth);
        expect(style.boxSizing).toBe("border-box");
        expect(paddingLeft).toBeCloseTo(parseFloat(style.fontSize) / 2, 1);
        expect(contentBoxWidth + 0.5).toBeGreaterThanOrEqual(
          textRange.getBoundingClientRect().width,
        );
      }
    } finally {
      for (const root of roots) root.remove();
      stylesheet.dispose();
    }
  });

  it("measures the last displayed row without crossing a digit boundary", () => {
    const hunk = new Hunk({
      oldStartRow: 99,
      oldRowCount: 1,
      newStartRow: 9,
      newRowCount: 1,
      sectionHeading: "",
      marker: null,
      regions: [],
    });

    expect(hunk.getMaxLineNumberWidth()).toBe(2);

    hunk.oldRowCount = 2;
    expect(hunk.getMaxLineNumberWidth()).toBe(3);
  });

  it("ignores an empty side when measuring source line numbers", () => {
    const hunk = new Hunk({
      oldStartRow: 999,
      oldRowCount: 0,
      newStartRow: 99,
      newRowCount: 1,
      sectionHeading: "",
      marker: null,
      regions: [],
    });

    expect(hunk.getMaxLineNumberWidth()).toBe(2);
  });

  it("keeps the widest line number from an earlier hunk", () => {
    const earlierHunk = new Hunk({
      oldStartRow: 9999,
      oldRowCount: 1,
      newStartRow: 99,
      newRowCount: 1,
      sectionHeading: "",
      marker: null,
      regions: [],
    });
    const finalHunk = new Hunk({
      oldStartRow: 10000,
      oldRowCount: 0,
      newStartRow: 100,
      newRowCount: 1,
      sectionHeading: "",
      marker: null,
      regions: [],
    });
    const patch = new Patch({ status: null, hunks: [earlierHunk, finalHunk], marker: null });

    expect(patch.getMaxLineNumberWidth()).toBe(4);
  });
});

describe("rendered file patch line-number gutters", () => {
  let view;
  let patch;
  let container;
  let stylesheet;

  beforeEach(() => {
    stylesheet = lumine.themes.requireStylesheet(
      path.join(import.meta.dirname, "..", "styles", "main.css"),
    );
    container = document.createElement("div");
    container.style.cssText = "display: flex; width: 520px; height: 340px;";
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
    }
  }

  function buildPatch(line) {
    return buildMultiFilePatch([
      {
        oldPath: "large.txt",
        newPath: "large.txt",
        oldMode: "100644",
        newMode: "100644",
        status: "modified",
        hunks: [
          {
            oldStartLine: line - 1,
            newStartLine: line - 1,
            oldLineCount: 2,
            newLineCount: 2,
            heading: "",
            lines: [" context", "-removed", "+lc 2966 ics1 9994 fact -1"],
          },
        ],
      },
    ]);
  }

  function assertGutterSpacing(line) {
    const digits = Math.max(2, String(line).length);
    expect(view.element.style.getPropertyValue("--git-panel-line-number-content-width")).toBe(
      `${digits}ch`,
    );
    for (const side of ["old", "new"]) {
      const gutter = view.element.querySelector(`.gutter.${side}`);
      const number = Array.from(gutter.querySelectorAll(".line-number[data-buffer-row]")).find(
        (element) => element.textContent.trim() === String(line),
      );
      expect(number).toBeDefined();
      const range = document.createRange();
      range.selectNodeContents(number);
      const text = range.getBoundingClientRect();
      const style = getComputedStyle(number);
      const bounds = gutter.getBoundingClientRect();
      expect(text.left + 0.5).toBeGreaterThanOrEqual(bounds.left + parseFloat(style.paddingLeft));
      expect(bounds.right - text.right + 0.5).toBeGreaterThanOrEqual(
        parseFloat(style.paddingRight),
      );
    }
  }

  for (const layout of ["unified", "side-by-side"]) {
    it(`preserves spacing when source line numbers and font size change (${layout})`, async () => {
      patch = buildPatch(334895);
      view = new MultiFilePatchView({
        multiFilePatch: patch,
        stagingStatus: "unstaged",
        initialDiffView: layout,
        workspace: lumine.workspace,
        config: lumine.config,
        commands: lumine.commands,
        keymaps: lumine.keymaps,
        tooltips: { add: () => new Disposable(), addComposite: () => new Disposable() },
        selectedRows: new Set(),
        selectionMode: "line",
        selectedRowsChanged: () => {},
        toggleRows: () => {},
        toggleFile: () => {},
        discardRows: () => {},
        openFile: () => {},
        diveIntoMirrorPatch: () => {},
        undoLastDiscard: () => {},
        surface: () => {},
      });
      container.appendChild(view.element);
      await paint();
      assertGutterSpacing(334895);

      lumine.config.set("editor.fontSize", 22);
      await paint();
      assertGutterSpacing(334895);

      for (const line of [12345678, 9]) {
        const previousPatch = patch;
        patch = buildPatch(line);
        await flushViews(() => view.update({ ...view.props, multiFilePatch: patch }));
        previousPatch.dispose();
        await paint();
        assertGutterSpacing(line);
      }
    });
  }
});
