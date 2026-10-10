/** @babel */
import path from "path";

import Hunk from "../lib/models/patch/hunk";
import Patch from "../lib/models/patch/patch";
import MultiFilePatchView from "../lib/views/multi-file-patch-view";

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

  return view.render();
}

describe("file patch line-number gutters", () => {
  afterEach(() => performance.clearMarks());

  it("sizes gutters for the widest source line number with the native two-digit minimum", () => {
    expect(renderPatchRoot(1).props.style["--git-panel-line-number-content-width"]).toBe("2ch");
    expect(renderPatchRoot(5).props.style["--git-panel-line-number-content-width"]).toBe("5ch");
    expect(renderPatchRoot(6).props.style["--git-panel-line-number-content-width"]).toBe("6ch");
  });

  it("applies the calculated width instead of a fixed minimum", () => {
    const stylesheet = lumine.themes.requireStylesheet(
      path.join(__dirname, "..", "styles", "main.css"),
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
